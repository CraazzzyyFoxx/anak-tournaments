"""The result flows over the encounter layer (D14, D50, D54, D57, D58, D59).

A claim and a report are both "what a participation says happened", and both
are reconciled by unanimity among the LIVE seats -- a duel's two and a lobby's
N alike. These cases run against the real Postgres because the rules they pin
live in constraints as much as in Python: one journal row per ``result_version``
(``uq_result_audit_version``), one active participation per slot, and the
partial unique index that frees a cancelled position.
"""

from __future__ import annotations

import itertools
import os

import sqlalchemy as sa

from shared.core import enums
from shared.core.errors import BaseAPIException
from shared.models.encounter import Encounter, EncounterGame, EncounterTeam, ScoringRule
from shared.models.identity.auth_user import AuthUser
from shared.models.identity.rbac import Permission, Role, role_permissions, user_roles
from shared.models.identity.user import User
from shared.models.platform.notification import Notification
from shared.models.tenancy.workspace import WorkspaceMember
from shared.models.tournament.encounter_link import EncounterLink
from shared.models.tournament.team import Team
from shared.services.bracket import advancement
from shared.services.encounter import participants
from shared.tests.encounter_writer_case import EncounterWriterCase
from src import schemas
from src.services.encounter.captain import ReportResultIn, captain_service
from src.services.encounter.ffa import ffa_encounter_service
from src.services.encounter.flows import flows_service, to_summary
from src.services.encounter.game_correction import game_correction_service
from src.services.encounter.games import GameResultIn, encounter_game_service
from src.services.encounter.map_report import ClaimResultIn, map_report_service
from src.services.encounter.service import encounter_service

#: ``players.user.name`` is globally unique, so the extra players a second
#: encounter needs are tagged per test.
_TAG = itertools.count()


def _codes(exc: BaseAPIException) -> list[str]:
    """The machine-readable codes of an ``ApiExc`` detail list."""
    detail = exc.detail
    if isinstance(detail, str):
        return [detail]
    return [getattr(item, "code", None) or item.get("code") for item in detail]


class ResultFlowCase(EncounterWriterCase):
    """The writer case with its seats already filled."""

    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        async with self.Session() as s:
            encounter = await self.encounter(s)
            for slot in range(1, self.slot_count + 1):
                await participants.place_team(
                    s,
                    encounter,
                    slot=slot,
                    team_id=self.ids[f"team{slot - 1}"],
                    name=f"T{slot - 1}",
                    seed=slot,
                    members=[
                        participants.MemberSnapshot(
                            workspace_member_id=self.ids[f"m{slot - 1}"],
                            display_name=f"m{slot - 1}",
                            rank=2500,
                            is_substitute=False,
                            roles=(("player_role", "tank"),),
                        )
                    ],
                )
            await s.commit()

    async def seats(self, session) -> list[EncounterTeam]:
        return await participants.active_teams(session, self.ids["e"])

    async def open_game(self, session, position: int) -> EncounterGame:
        encounter = await self.encounter(session)
        game = await encounter_game_service.open_game(session, encounter, position=position)
        await session.commit()
        return game

    @staticmethod
    def win(winner_id: int, loser_id: int) -> list[GameResultIn]:
        """One game of the ``wins`` preset: a map score, no entered place."""
        return [
            GameResultIn(encounter_team_id=winner_id, score=3),
            GameResultIn(encounter_team_id=loser_id, score=1),
        ]

    @staticmethod
    def claim(winner_id: int, loser_id: int, winner_score: int = 3) -> list[ClaimResultIn]:
        return [
            ClaimResultIn(encounter_team_id=winner_id, score=winner_score),
            ClaimResultIn(encounter_team_id=loser_id, score=1),
        ]

    async def play(self, session, position: int, winner_id: int, loser_id: int) -> EncounterGame:
        """Confirm one position as an admin, the short way the setup needs."""
        encounter = await self.encounter(session)
        game = await encounter_game_service.open_game(session, encounter, position=position)
        await encounter_game_service.record_result(
            session,
            encounter,
            game,
            results=self.win(winner_id, loser_id),
            source=enums.EncounterGameResultSource.ADMIN,
            actor_user_id=None,
        )
        await session.commit()
        return game


class GameClaimTests(ResultFlowCase):
    """``submit_game_claim``: unanimity among the game's live participations."""

    async def test_a_game_confirms_when_every_participation_claims_the_same(self) -> None:
        async with self.Session() as s:
            game = await self.open_game(s, 1)
            first, second = await self.seats(s)

        async with self.Session() as s:
            answer = await map_report_service.submit_game_claim(
                s,
                game.id,
                claimant_team_id=first.id,
                reporter_user_id=self.users[0],
                results=self.claim(first.id, second.id),
                basis_version=0,
            )
        self.assertEqual({"disputed": False, "resolved": False}, {k: answer[k] for k in ("disputed", "resolved")})

        async with self.Session() as s:
            answer = await map_report_service.submit_game_claim(
                s,
                game.id,
                claimant_team_id=second.id,
                reporter_user_id=self.users[1],
                results=self.claim(first.id, second.id),
                basis_version=0,
            )
        self.assertTrue(answer["resolved"])

        async with self.Session() as s:
            stored = await s.get_one(EncounterGame, game.id)
            self.assertEqual(enums.EncounterGameState.CONFIRMED, stored.state)
            self.assertEqual(enums.EncounterGameResultSource.CAPTAIN_AGREEMENT, stored.result_source)
            self.assertEqual(1, stored.result_version)
            standing = {seat.id: seat.score for seat in await self.seats(s)}
            self.assertEqual({first.id: 1.0, second.id: 0.0}, standing)
            # One confirmed game of a Bo3 ends nothing.
            encounter = await self.encounter(s)
            self.assertEqual(enums.EncounterResultStatus.NONE, encounter.result_status)

    async def test_claims_that_disagree_dispute_the_game(self) -> None:
        async with self.Session() as s:
            game = await self.open_game(s, 1)
            first, second = await self.seats(s)

        async with self.Session() as s:
            await map_report_service.submit_game_claim(
                s,
                game.id,
                claimant_team_id=first.id,
                reporter_user_id=self.users[0],
                results=self.claim(first.id, second.id),
                basis_version=0,
            )
        async with self.Session() as s:
            answer = await map_report_service.submit_game_claim(
                s,
                game.id,
                claimant_team_id=second.id,
                reporter_user_id=self.users[1],
                results=self.claim(second.id, first.id),
                basis_version=0,
            )
        self.assertEqual({"disputed": True, "resolved": False}, {k: answer[k] for k in ("disputed", "resolved")})

        async with self.Session() as s:
            stored = await s.get_one(EncounterGame, game.id)
            self.assertEqual(enums.EncounterGameState.DISPUTED, stored.state)
            self.assertIsNone(stored.result_source)
            self.assertEqual(0, stored.result_version)
            self.assertEqual({0.0}, {seat.score for seat in await self.seats(s)})

    async def test_a_claim_against_a_superseded_result_is_stale(self) -> None:
        async with self.Session() as s:
            first, second = await self.seats(s)
            game = await self.play(s, 1, first.id, second.id)

        with self.assertRaises(BaseAPIException) as caught:
            async with self.Session() as s:
                await map_report_service.submit_game_claim(
                    s,
                    game.id,
                    claimant_team_id=first.id,
                    reporter_user_id=self.users[0],
                    results=self.claim(first.id, second.id),
                    basis_version=0,
                )
        # A confirmed game is locked before its version is even compared: the
        # claim is answered with what it has to do about it, not with "reload".
        self.assertEqual(409, caught.exception.status_code)
        self.assertEqual(["result_locked"], _codes(caught.exception))

    async def test_a_claim_on_a_game_that_moved_on_is_refused_as_stale(self) -> None:
        async with self.Session() as s:
            game = await self.open_game(s, 1)
            first, second = await self.seats(s)

        with self.assertRaises(BaseAPIException) as caught:
            async with self.Session() as s:
                await map_report_service.submit_game_claim(
                    s,
                    game.id,
                    claimant_team_id=first.id,
                    reporter_user_id=self.users[0],
                    results=self.claim(first.id, second.id),
                    basis_version=7,
                )
        self.assertEqual(409, caught.exception.status_code)
        self.assertEqual(["stale_state"], _codes(caught.exception))


class SeriesReportTests(ResultFlowCase):
    """``submit_team_report``: the whole encounter, checked by the rule."""

    async def test_a_bo3_cannot_be_reported_three_nil(self) -> None:
        async with self.Session() as s:
            first, second = await self.seats(s)

        with self.assertRaises(BaseAPIException) as caught:
            async with self.Session() as s:
                await captain_service.submit_team_report(
                    s,
                    self.ids["e"],
                    encounter_team_id=first.id,
                    reporter_user_id=self.users[0],
                    games_played=3,
                    results=[
                        ReportResultIn(encounter_team_id=first.id, score=3.0, placement=1, wins=3),
                        ReportResultIn(encounter_team_id=second.id, score=0.0, placement=2, wins=0),
                    ],
                    basis_version=0,
                )
        self.assertEqual(400, caught.exception.status_code)
        # The series would have been over after the second map, so a third was
        # never played: the claim is unreachable, not merely wrong.
        self.assertIn("series_claim_unreachable", _codes(caught.exception))

        async with self.Session() as s:
            reports = await captain_service.get_encounter_reports(s, self.ids["e"])
            self.assertEqual([], reports)

    async def test_unanimous_reports_confirm_the_series_and_cancel_the_rest(self) -> None:
        # Only the first map was entered as a game; the rest of the series is
        # what the two reports agree on, which is the whole point of D54.
        async with self.Session() as s:
            first, second = await self.seats(s)
            await self.play(s, 1, first.id, second.id)
            await self.open_game(s, 2)
            third = await self.open_game(s, 3)

        standing = [
            ReportResultIn(encounter_team_id=first.id, score=2.0, placement=1, wins=2),
            ReportResultIn(encounter_team_id=second.id, score=1.0, placement=2, wins=1),
        ]
        async with self.Session() as s:
            encounter = await self.encounter(s)
            version = encounter.result_version
            await captain_service.submit_team_report(
                s,
                self.ids["e"],
                encounter_team_id=first.id,
                reporter_user_id=self.users[0],
                games_played=3,
                results=standing,
                basis_version=version,
                closeness=8,
            )
        async with self.Session() as s:
            encounter = await self.encounter(s)
            self.assertEqual(enums.EncounterResultStatus.PENDING_CONFIRMATION, encounter.result_status)
            await captain_service.submit_team_report(
                s,
                self.ids["e"],
                encounter_team_id=second.id,
                reporter_user_id=self.users[1],
                games_played=3,
                results=standing,
                basis_version=encounter.result_version,
                closeness=6,
            )

        async with self.Session() as s:
            encounter = await self.encounter(s)
            self.assertEqual(enums.EncounterResultStatus.CONFIRMED, encounter.result_status)
            self.assertEqual(enums.EncounterResultSource.SERIES_CLAIM.value, encounter.result_source)
            self.assertEqual(enums.EncounterStatus.COMPLETED, encounter.status)
            self.assertAlmostEqual(0.7, encounter.closeness)
            places = {seat.id: (seat.score, seat.placement) for seat in await self.seats(s)}
            self.assertEqual({first.id: (2.0, 1), second.id: (1.0, 2)}, places)
            # The position nobody played is gone, not left open for a game the
            # report says never happened.
            cancelled = await s.get_one(EncounterGame, third.id)
            self.assertEqual(enums.EncounterGameState.CANCELLED, cancelled.state)

    async def test_reports_that_disagree_dispute_the_encounter(self) -> None:
        async with self.Session() as s:
            first, second = await self.seats(s)
            await self.play(s, 1, first.id, second.id)
            await self.open_game(s, 2)

        async with self.Session() as s:
            encounter = await self.encounter(s)
            await captain_service.submit_team_report(
                s,
                self.ids["e"],
                encounter_team_id=first.id,
                reporter_user_id=self.users[0],
                games_played=3,
                results=[
                    ReportResultIn(encounter_team_id=first.id, score=2.0, placement=1, wins=2),
                    ReportResultIn(encounter_team_id=second.id, score=1.0, placement=2, wins=1),
                ],
                closeness=9,
                basis_version=encounter.result_version,
            )
        async with self.Session() as s:
            encounter = await self.encounter(s)
            await captain_service.submit_team_report(
                s,
                self.ids["e"],
                encounter_team_id=second.id,
                reporter_user_id=self.users[1],
                games_played=3,
                results=[
                    ReportResultIn(encounter_team_id=first.id, score=1.0, placement=2, wins=1),
                    ReportResultIn(encounter_team_id=second.id, score=2.0, placement=1, wins=2),
                ],
                closeness=4,
                basis_version=encounter.result_version,
            )

        async with self.Session() as s:
            encounter = await self.encounter(s)
            self.assertEqual(enums.EncounterResultStatus.DISPUTED, encounter.result_status)
            self.assertIsNone(encounter.result_source)
            self.assertEqual(enums.EncounterStatus.OPEN, encounter.status)
            audit = await captain_service.get_result_audit(s, self.ids["e"])
            self.assertEqual(enums.EncounterResultAuditAction.AUTO_DISPUTE, audit[0]["action"])

    async def test_a_game_claim_after_the_series_is_confirmed_is_refused(self) -> None:
        async with self.Session() as s:
            first, second = await self.seats(s)
            await self.play(s, 1, first.id, second.id)
            await self.open_game(s, 2)
            await self.open_game(s, 3)

        standing = [
            ReportResultIn(encounter_team_id=first.id, score=2.0, placement=1, wins=2),
            ReportResultIn(encounter_team_id=second.id, score=1.0, placement=2, wins=1),
        ]
        for index, seat in enumerate((first, second)):
            async with self.Session() as s:
                encounter = await self.encounter(s)
                await captain_service.submit_team_report(
                    s,
                    self.ids["e"],
                    encounter_team_id=seat.id,
                    reporter_user_id=self.users[index],
                    games_played=3,
                    results=standing,
                    closeness=5,
                    basis_version=encounter.result_version,
                )

        # The confirmed series cancelled the unplayed positions, so the claim
        # lands on a position the organizer re-opened afterwards.
        async with self.Session() as s:
            encounter = await self.encounter(s)
            reopened = await encounter_game_service.open_game(s, encounter, position=3)
            await s.commit()

        with self.assertRaises(BaseAPIException) as caught:
            async with self.Session() as s:
                await map_report_service.submit_game_claim(
                    s,
                    reopened.id,
                    claimant_team_id=second.id,
                    reporter_user_id=self.users[1],
                    results=self.claim(second.id, first.id),
                    basis_version=0,
                )
        self.assertEqual(409, caught.exception.status_code)
        self.assertEqual(["result_locked"], _codes(caught.exception))


class DisputeNotificationTests(ResultFlowCase):
    """A real disagreement through the public flow reaches the inbox.

    The two producers (``map_report._notify_dispute``, ``captain._notify_dispute``)
    validate their payloads against the ``extra="forbid"`` notification schemas,
    so a field the schema does not know is a ValidationError that rolls the
    whole claim back. Driving the claim itself is what proves the wiring.
    """

    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        tag = f"dsp-{os.getpid()}-{next(_TAG)}"
        self.auth_user_ids: list[int] = []
        async with self.Session() as s:
            accounts = [
                AuthUser(email=f"{who}-{tag}@example.test", username=f"{who}-{tag}", is_active=True)
                for who in ("cap0", "cap1", "ref")
            ]
            s.add_all(accounts)
            await s.flush()
            self.auth_user_ids = [account.id for account in accounts]
            self.captain_auth = self.auth_user_ids[:2]
            self.organizer_auth = self.auth_user_ids[2]
            for index in (0, 1):
                (await s.get_one(User, self.users[index])).auth_user_id = self.captain_auth[index]
                (await s.get_one(Team, self.ids[f"team{index}"])).captain_id = self.users[index]
            # An organizer: ``match.result`` through a role scoped to this workspace.
            role = Role(name=f"referee-{tag}", workspace_id=self.ids["ws"])
            permission = Permission(name=f"match:result:{tag}", resource="match", action="result")
            s.add_all([role, permission])
            await s.flush()
            self.permission_id = permission.id
            await s.execute(sa.insert(role_permissions).values(role_id=role.id, permission_id=permission.id))
            await s.execute(sa.insert(user_roles).values(user_id=self.organizer_auth, role_id=role.id))
            await s.commit()

    async def asyncTearDown(self) -> None:
        await super().asyncTearDown()
        async with self.Session() as s:
            await s.execute(sa.delete(Permission).where(Permission.id == self.permission_id))
            await s.execute(sa.delete(AuthUser).where(AuthUser.id.in_(self.auth_user_ids)))
            await s.commit()

    async def notifications(self, kind: str) -> list[Notification]:
        async with self.Session() as s:
            rows = await s.scalars(
                sa.select(Notification)
                .where(Notification.kind == kind, Notification.recipient_auth_user_id.in_(self.auth_user_ids))
                .order_by(Notification.id)
            )
            return list(rows)

    async def test_disagreeing_game_claims_tell_both_captains_and_page_the_organizer(self) -> None:
        async with self.Session() as s:
            game = await self.open_game(s, 1)
            first, second = await self.seats(s)
        for claimant, other, user in ((first, second, 0), (second, first, 1)):
            async with self.Session() as s:
                await map_report_service.submit_game_claim(
                    s,
                    game.id,
                    claimant_team_id=claimant.id,
                    reporter_user_id=self.users[user],
                    results=self.claim(claimant.id, other.id),
                    basis_version=0,
                    actor_auth_user_id=self.captain_auth[user],
                )

        disputed = await self.notifications("encounter.report_disputed")
        self.assertEqual(sorted(self.captain_auth), sorted(row.recipient_auth_user_id for row in disputed))
        self.assertEqual(
            {"encounter_id": self.ids["e"], "tournament_id": self.ids["t"], "game_id": game.id, "position": 1},
            # The game has no map picked, so the row carries none.
            disputed[0].payload_json,
        )
        review = await self.notifications("encounter.dispute_review")
        self.assertEqual([self.organizer_auth], [row.recipient_auth_user_id for row in review])
        self.assertEqual(f"game:{game.id}", review[0].dedupe_key)
        self.assertEqual(
            {
                "encounter_id": self.ids["e"],
                "tournament_id": self.ids["t"],
                "game_id": game.id,
                "position": 1,
                "team_names": ["T0", "T1"],
                "home_team_name": "T0",
                "away_team_name": "T1",
            },
            review[0].payload_json,
        )

    async def test_disagreeing_series_reports_page_the_organizer(self) -> None:
        async with self.Session() as s:
            first, second = await self.seats(s)
            await self.play(s, 1, first.id, second.id)
            await self.open_game(s, 2)
        for reporter, user, wins in ((first, 0, (2.0, 1.0)), (second, 1, (1.0, 2.0))):
            async with self.Session() as s:
                encounter = await self.encounter(s)
                await captain_service.submit_team_report(
                    s,
                    self.ids["e"],
                    encounter_team_id=reporter.id,
                    reporter_user_id=self.users[user],
                    games_played=3,
                    results=[
                        ReportResultIn(
                            encounter_team_id=first.id,
                            score=wins[0],
                            placement=1 if wins[0] > wins[1] else 2,
                            wins=int(wins[0]),
                        ),
                        ReportResultIn(
                            encounter_team_id=second.id,
                            score=wins[1],
                            placement=2 if wins[0] > wins[1] else 1,
                            wins=int(wins[1]),
                        ),
                    ],
                    closeness=5,
                    basis_version=encounter.result_version,
                    actor_auth_user_id=self.captain_auth[user],
                )

        review = await self.notifications("encounter.dispute_review")
        self.assertEqual([self.organizer_auth], [row.recipient_auth_user_id for row in review])
        self.assertEqual(f"series:{self.ids['e']}", review[0].dedupe_key)
        self.assertEqual(
            {
                "encounter_id": self.ids["e"],
                "tournament_id": self.ids["t"],
                "position": 0,
                "team_names": ["T0", "T1"],
                "home_team_name": "T0",
                "away_team_name": "T1",
            },
            review[0].payload_json,
        )


class AdminResultTests(ResultFlowCase):
    """``set_encounter_result``: source ``admin``, reason required."""

    async def test_an_admin_result_needs_a_reason(self) -> None:
        async with self.Session() as s:
            first, second = await self.seats(s)

        with self.assertRaises(BaseAPIException) as caught:
            async with self.Session() as s:
                await captain_service.set_encounter_result(
                    s,
                    self.ids["e"],
                    results=[
                        ReportResultIn(encounter_team_id=first.id, score=2.0, placement=1),
                        ReportResultIn(encounter_team_id=second.id, score=1.0, placement=2),
                    ],
                    reason="  ",
                    actor_user_id=self.users[0],
                )
        self.assertEqual(422, caught.exception.status_code)
        self.assertEqual(["reason_required"], _codes(caught.exception))

    async def test_an_admin_result_stands_as_source_admin(self) -> None:
        async with self.Session() as s:
            first, second = await self.seats(s)

        async with self.Session() as s:
            await captain_service.set_encounter_result(
                s,
                self.ids["e"],
                results=[
                    ReportResultIn(encounter_team_id=first.id, score=2.0, placement=1),
                    ReportResultIn(encounter_team_id=second.id, score=1.0, placement=2),
                ],
                reason="forfeit on the second map",
                actor_user_id=self.users[0],
            )

        async with self.Session() as s:
            encounter = await self.encounter(s)
            self.assertEqual(enums.EncounterResultSource.ADMIN.value, encounter.result_source)
            self.assertEqual(enums.EncounterStatus.COMPLETED, encounter.status)
            audit = await captain_service.get_result_audit(s, self.ids["e"])
            self.assertEqual("admin", audit[0]["source"])
            self.assertEqual("forfeit on the second map", audit[0]["reason"])


class LobbyResultTests(ResultFlowCase):
    """``record_lobby_game``: an N-seat encounter scored by points."""

    slot_count = 3
    best_of = 2
    preset = "points"
    game_formula = "place_pts"
    end_formula = "games >= best_of"

    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        async with self.Session() as s:
            rule = await s.get_one(ScoringRule, self.ids["rule"])
            rule.placement_points = [10.0, 6.0, 3.0]
            await s.commit()

    async def test_a_lobby_completes_once_it_has_played_its_card(self) -> None:
        seats = []
        async with self.Session() as s:
            seats = await self.seats(s)
        order = [seat.id for seat in seats]

        async with self.Session() as s:
            await ffa_encounter_service.record_lobby_game(
                s,
                self.ids["e"],
                1,
                [
                    GameResultIn(encounter_team_id=order[0], placement=1),
                    GameResultIn(encounter_team_id=order[1], placement=2),
                    GameResultIn(encounter_team_id=order[2], placement=3),
                ],
                actor_user_id=self.users[0],
                reason=None,
            )
        async with self.Session() as s:
            encounter = await self.encounter(s)
            self.assertEqual(enums.EncounterStatus.OPEN, encounter.status)
            self.assertEqual(enums.EncounterResultStatus.NONE, encounter.result_status)

        async with self.Session() as s:
            await ffa_encounter_service.record_lobby_game(
                s,
                self.ids["e"],
                2,
                [
                    GameResultIn(encounter_team_id=order[2], placement=1),
                    GameResultIn(encounter_team_id=order[1], placement=2),
                    GameResultIn(encounter_team_id=order[0], placement=3),
                ],
                actor_user_id=self.users[0],
                reason=None,
            )

        async with self.Session() as s:
            encounter = await self.encounter(s)
            self.assertEqual(enums.EncounterStatus.COMPLETED, encounter.status)
            self.assertEqual(enums.EncounterResultSource.GAMES.value, encounter.result_source)
            totals = {seat.id: seat.score for seat in await self.seats(s)}
            self.assertEqual({order[0]: 13.0, order[1]: 12.0, order[2]: 13.0}, totals)
            # The placement rows are what a lobby's table is drawn from.
            rows = (
                await s.execute(
                    sa.text(
                        "SELECT encounter_team_id, placement, column_values FROM encounter.game_team "
                        "WHERE encounter_id = :e ORDER BY game_id, encounter_team_id"
                    ).bindparams(e=self.ids["e"])
                )
            ).all()
            self.assertEqual(6, len(rows))
            self.assertEqual({1, 2, 3}, {row[1] for row in rows})
            self.assertEqual([{}] * 6, [row[2] for row in rows])


class CascadeTests(ResultFlowCase):
    """An admin correction unwinds the bracket below it (Task 5)."""

    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        tag = f"flow-{os.getpid()}-{next(_TAG)}"
        async with self.Session() as s:
            user = User(name=tag)
            s.add(user)
            await s.flush()
            self.users.append(user.id)
            member = WorkspaceMember(workspace_id=self.ids["ws"], player_id=user.id)
            bye = Team(tournament_id=self.ids["t"], name="T9", balancer_name=f"{tag}-T9")
            s.add_all([member, bye])
            await s.flush()
            final = Encounter(
                workspace_id=self.ids["ws"],
                discipline="overwatch",
                tournament_id=self.ids["t"],
                scoring_rule_id=self.ids["rule"],
                name="Final",
                slot_count=2,
                best_of=self.best_of,
                status=enums.EncounterStatus.OPEN,
            )
            s.add(final)
            await s.flush()
            await participants.place_team(s, final, slot=2, team_id=bye.id, name="T9", seed=3, members=[])
            s.add(
                EncounterLink(
                    tournament_id=self.ids["t"],
                    source_encounter_id=self.ids["e"],
                    source_position=1,
                    target_encounter_id=final.id,
                    target_slot=1,
                )
            )
            await s.commit()
            self.ids["final"] = final.id

    async def test_an_admin_correction_reseats_the_next_round(self) -> None:
        async with self.Session() as s:
            first, second = await self.seats(s)
            await self.play(s, 1, first.id, second.id)
            game = await self.play(s, 2, first.id, second.id)
            encounter = await self.encounter(s)
            self.assertEqual(enums.EncounterResultStatus.CONFIRMED, encounter.result_status)
            await advancement.advance_after_result(s, encounter)
            await s.commit()

        async with self.Session() as s:
            seated = await participants.active_teams(s, self.ids["final"])
            self.assertEqual([("T0", 1), ("T9", 2)], [(seat.name, seat.slot) for seat in seated])

        # The organizer corrects the SECOND map: the other team won it, so the
        # series is 1:1 and nobody has advanced any more.
        async with self.Session() as s:
            await game_correction_service.correct_game(
                s,
                self.ids["e"],
                game_id=game.id,
                results=self.win(second.id, first.id),
                actor_user_id=self.users[0],
                reason="the second map was scored backwards",
            )

        async with self.Session() as s:
            encounter = await self.encounter(s)
            self.assertEqual(enums.EncounterResultStatus.NONE, encounter.result_status)
            self.assertEqual(enums.EncounterStatus.OPEN, encounter.status)
            standing = {seat.id: seat.score for seat in await self.seats(s)}
            self.assertEqual({first.id: 1.0, second.id: 1.0}, standing)
            # The downstream seat the old first place held is retired, and the
            # slot reads as open again.
            seated = await participants.active_teams(s, self.ids["final"])
            self.assertEqual([("T9", 2)], [(seat.name, seat.slot) for seat in seated])
            retired = (
                await s.execute(
                    sa.select(EncounterTeam.name, EncounterTeam.active).where(
                        EncounterTeam.encounter_id == self.ids["final"],
                        EncounterTeam.slot == 1,
                    )
                )
            ).all()
            self.assertEqual([("T0", False)], list(retired))
            audit = await captain_service.get_result_audit(s, self.ids["e"])
            self.assertIn("the second map was scored backwards", [row["reason"] for row in audit])


class ReadPathTests(ResultFlowCase):
    """The public encounter reads, off participations and the bracket row.

    These exist because the read path has no seats-shaped assertion anywhere
    else: every attribute it used to take off the encounter row (both teams,
    the score, the stage coordinate) is now a join, and the failure mode of
    getting that wrong is an ``AttributeError`` at request time, not a wrong
    number.
    """

    async def test_the_overview_counts_the_two_seats_by_slot(self) -> None:
        async with self.Session() as s:
            first, second = await self.seats(s)
            await self.play(s, 1, first.id, second.id)
            await self.play(s, 2, first.id, second.id)

        async with self.Session() as s:
            data = await encounter_service.get_overview_data(
                s,
                schemas.EncounterSearchParams(page=1, per_page=50, tournament_id=self.ids["t"]),
            )
        self.assertEqual(1, data["total"])
        self.assertEqual(1, data["completed_series_count"])
        # Slot 1 took both maps: a 2:0 is a sweep, and the win belongs to the
        # first seat. Nothing here reads a side column.
        self.assertEqual(1, data["sweep_count"])
        self.assertEqual(1, data["slot_one_wins"])
        self.assertEqual(0, data["slot_two_wins"])
        self.assertEqual([(2, 0, 1)], [tuple(row) for row in data["score_rows"]])

    async def test_a_lobby_is_left_out_of_the_two_seat_metrics(self) -> None:
        async with self.Session() as s:
            lobby = Encounter(
                workspace_id=self.ids["ws"],
                discipline="overwatch",
                tournament_id=self.ids["t"],
                scoring_rule_id=self.ids["rule"],
                name="Lobby",
                slot_count=3,
                best_of=1,
                status=enums.EncounterStatus.COMPLETED,
                result_status=enums.EncounterResultStatus.CONFIRMED,
                result_source=enums.EncounterResultSource.GAMES.value,
            )
            s.add(lobby)
            await s.commit()

        async with self.Session() as s:
            data = await encounter_service.get_overview_data(
                s,
                schemas.EncounterSearchParams(page=1, per_page=50, tournament_id=self.ids["t"], slot_count=3),
            )
        # The lobby is in scope, but it contributes to neither win column: a
        # three-seat encounter has no first-versus-second to balance.
        self.assertEqual(1, data["total"])
        self.assertEqual(0, data["slot_one_wins"])
        self.assertEqual(0, data["slot_two_wins"])
        self.assertEqual([], [tuple(row) for row in data["score_rows"]])

    async def test_an_entity_less_read_serializes_from_the_seats(self) -> None:
        async with self.Session() as s:
            first, second = await self.seats(s)
            await self.play(s, 1, first.id, second.id)

        async with self.Session() as s:
            encounter = await encounter_service.get_encounter(s, self.ids["e"], [])
            read = await flows_service.to_pydantic(s, encounter, [])
            summary = to_summary(encounter)
        self.assertEqual([self.ids["team0"], self.ids["team1"]], [seat.team_id for seat in read.teams])
        self.assertEqual([1, 2], [seat.slot for seat in read.teams])
        self.assertEqual((1.0, 0.0), tuple(seat.score for seat in read.teams))
        self.assertEqual(0, read.round)
        self.assertIsNone(read.stage_id)
        self.assertEqual([self.ids["team0"], self.ids["team1"]], [seat.team_id for seat in summary.teams])

    async def test_a_read_with_teams_eager_loads_their_nested_entities(self) -> None:
        async with self.Session() as s:
            encounter = await encounter_service.get_encounter(s, self.ids["e"], ["teams", "teams.players"])
            read = await flows_service.to_pydantic(s, encounter, ["teams", "teams.players"])
        self.assertEqual(["T0", "T1"], [seat.team.name for seat in read.teams])
        # ``players`` is a to-many on the team: reaching it at all proves the
        # seat's team was loaded with its nested entities, not bare.
        self.assertEqual([], read.teams[0].team.players)

    async def test_a_team_already_in_the_identity_map_is_reloaded_with_its_entities(self) -> None:
        """``session.get`` hands back an identity-mapped row as it was FIRST
        loaded and ignores the options, so a read that reached the same team
        through a shallower path earlier would otherwise get a bare instance and
        lazy-load its collections -- ``MissingGreenlet`` under async."""
        async with self.Session() as s:
            # The shallower path, reproduced: the team enters the identity map
            # with no team options on it at all.
            bare = await s.get(Team, self.ids["team0"])
            self.assertIn("players", sa.inspect(bare).unloaded)
            encounter = await encounter_service.get_encounter(s, self.ids["e"], ["teams", "teams.players"])
            read = await flows_service.to_pydantic(s, encounter, ["teams", "teams.players"])
            # The SAME instance, now carrying its roster: without
            # ``populate_existing`` the read hands back the bare one and the
            # next consumer of it lazy-loads.
            self.assertNotIn("players", sa.inspect(bare).unloaded)
        self.assertEqual("T0", read.teams[0].team.name)
        self.assertEqual([], read.teams[0].team.players)
