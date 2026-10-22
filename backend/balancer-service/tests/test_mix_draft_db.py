"""A mix lobby's captain draft against a real Postgres (spec §9): the session's owner, its seats and ranks, its
lifecycle and the lineup it leaves behind."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
for candidate in (str(REPO_BACKEND_ROOT), str(REPO_BACKEND_ROOT / "balancer-service")):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

import sqlalchemy as sa  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402

from shared import models  # noqa: E402
from shared.core.enums import DraftStatus  # noqa: E402
from shared.core.errors import ApiHTTPException  # noqa: E402
from shared.domain.team_format import FormatDimension, FormatRule, TeamFormat  # noqa: E402
from shared.models.platform.realtime import WorkspaceEvent  # noqa: E402
from shared.repository import CatalogRoleRepository  # noqa: E402
from shared.services import team_format  # noqa: E402
from shared.services.member_rank import member_rank_service  # noqa: E402
from shared.tests.encounter_writer_case import EncounterWriterCase  # noqa: E402
from src.domain.draft.entities import PoolSeat  # noqa: E402
from src.domain.mix_ranker import HiddenRating, Ranker  # noqa: E402
from src.services.draft import lifecycle  # noqa: E402
from src.services.draft.board import board_service  # noqa: E402
from src.services.draft.rosters import draft_rosters  # noqa: E402

#: A 2v2: one tank and one damage seat a team, so a draft is one round of two picks.
_TWO_SEATS = TeamFormat(
    discipline="overwatch",
    name="Two seats",
    starter_min=2,
    starter_max=2,
    dimensions=(FormatDimension("player_role", "enforced"),),
    rules=(FormatRule("player_role", "tank", 1, 1), FormatRule("player_role", "damage", 1, 1)),
)

#: The workspace canon a host-less mix reads (``MIX_ORDER``): m0 and m2 tank, m1 and m3 damage.
_RANKS = (("m0", "tank", 3000), ("m1", "damage", 2800), ("m2", "tank", 2500), ("m3", "damage", 2400))


class MixDraftTests(EncounterWriterCase):
    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        self.draft_ids: list[int] = []
        self.auth_user_ids: list[int] = []
        async with self.Session() as s:
            mix = await self.mix_encounter(s)
            self.cg_id = mix.custom_game_id
            await s.execute(sa.delete(models.Encounter).where(models.Encounter.id == mix.id))
            s.add(models.CustomGameLobby(custom_game_id=self.cg_id, lobby_index=0))
            await team_format._save(s, _TWO_SEATS, workspace_id=self.ids["ws"], custom_game_id=self.cg_id)
            for order, (member, role, rank) in enumerate(_RANKS):
                s.add(
                    models.CustomGamePlayer(
                        custom_game_id=self.cg_id, workspace_member_id=self.ids[member], sort_order=order
                    )
                )
                await member_rank_service.set_ranks(
                    s,
                    workspace_id=self.ids["ws"],
                    discipline="overwatch",
                    workspace_member_id=self.ids[member],
                    ranks={role: rank},
                )
            await s.commit()

    async def asyncTearDown(self) -> None:
        # Board events of a draft scope carry no workspace or tournament id, and the outbox keeps the mix's
        # pickup-mix events: the workspace cascade misses both.
        async with self.Session() as s:
            await s.execute(
                sa.delete(WorkspaceEvent).where(
                    WorkspaceEvent.topic.in_([f"draft:{draft_id}:board" for draft_id in self.draft_ids])
                )
            )
            await s.execute(
                sa.text("DELETE FROM event_outbox WHERE payload_json->>'custom_game_id' = :id"), {"id": str(self.cg_id)}
            )
            await s.execute(sa.delete(models.AuthUser).where(models.AuthUser.id.in_(self.auth_user_ids)))
            await s.commit()
        await super().asyncTearDown()

    async def _session(self, s) -> models.DraftSession:
        game = await s.get_one(models.CustomGame, self.cg_id)
        draft = await lifecycle.lifecycle_service.create_session(
            s,
            custom_game_id=self.cg_id,
            lobby_index=0,
            workspace_id=self.ids["ws"],
            shape=await team_format.custom_game_slot_shape(s, game),
        )
        self.draft_ids.append(draft.id)
        return draft

    async def _seeded(self) -> int:
        """Lobby A seeded by hand: m1 captains team 1 (the weaker picks first), m0 team 2; m2 and m3 in the pool."""
        async with self.Session() as s:
            draft = await self._session(s)
            await lifecycle.lifecycle_service.seed(
                s,
                draft,
                seats=[
                    PoolSeat(None, draft_position=1, workspace_member_id=self.ids["m1"]),
                    PoolSeat(None, draft_position=2, workspace_member_id=self.ids["m0"]),
                    PoolSeat(None, workspace_member_id=self.ids["m2"]),
                    PoolSeat(None, workspace_member_id=self.ids["m3"]),
                ],
            )
            await s.commit()
            return draft.id

    async def _seat_ranks(self, draft_id: int) -> dict[int, int | None]:
        async with self.Session() as s:
            draft = await s.get_one(models.DraftSession, draft_id)
            seats = (
                (await s.scalars(sa.select(models.DraftPlayer).where(models.DraftPlayer.session_id == draft_id)))
                .unique()
                .all()
            )
            rosters = await draft_rosters.load(s, draft, seats)
        return {seat.workspace_member_id: rosters[seat.id].best_rank for seat in seats}

    async def test_a_lobby_draft_seats_members_and_reads_their_ranks_from_the_mix(self) -> None:
        draft_id = await self._seeded()
        async with self.Session() as s:
            draft = await s.get_one(models.DraftSession, draft_id)
            seats = (
                (await s.scalars(sa.select(models.DraftPlayer).where(models.DraftPlayer.session_id == draft_id)))
                .unique()
                .all()
            )
            rosters = await draft_rosters.load(s, draft, seats)
            read = await board_service.session_read(s, draft)

        self.assertEqual({None}, {seat.registration_id for seat in seats})
        self.assertEqual(
            {self.ids["m0"]: 3000, self.ids["m1"]: 2800, self.ids["m2"]: 2500, self.ids["m3"]: 2400},
            {seat.workspace_member_id: rosters[seat.id].best_rank for seat in seats},
        )
        self.assertEqual(
            ("overwatch", None, self.cg_id, 0),
            (read.discipline, read.tournament_id, read.custom_game_id, read.lobby_index),
        )

    async def test_a_ranker_host_drafts_on_the_effective_rating_the_balance_uses(self) -> None:
        """U3: a ranker-mode host's draft shows the open rank corrected by the hidden one, like the mix balance."""
        hidden = HiddenRating(Ranker().initial(3500).mu, 3.0)
        async with self.Session() as s:
            host = models.AuthUser(
                email=f"mixdraft-host-{self.cg_id}@example.test",
                username=f"mixdraft-host-{self.cg_id}",
                is_active=True,
                is_verified=True,
            )
            s.add(host)
            await s.flush()
            self.auth_user_ids.append(host.id)
            (await s.get_one(models.CustomGame, self.cg_id)).host_user_id = host.id
            s.add(models.UserBalancerConfig(user_id=host.id, rating_mode="ranker"))
            tank = (await CatalogRoleRepository().rated_rows(s, discipline="overwatch", workspace_id=None))["tank"]
            s.add(
                models.MemberHiddenRating(
                    workspace_id=self.ids["ws"],
                    workspace_member_id=self.ids["m0"],
                    catalog_role=tank,
                    dimension_id=tank.dimension_id,
                    mu=hidden.mu,
                    sigma=hidden.sigma,
                )
            )
            await s.commit()

        ranks = await self._seat_ranks(await self._seeded())

        corrected = round(Ranker().effective(3000, hidden))
        self.assertNotEqual(3000, corrected)
        self.assertEqual(
            {self.ids["m0"]: corrected, self.ids["m1"]: 2800, self.ids["m2"]: 2500, self.ids["m3"]: 2400}, ranks
        )

    async def test_a_lobby_runs_one_active_draft_at_a_time(self) -> None:
        await self._seeded()
        async with self.Session() as s:
            with self.assertRaises(IntegrityError):
                await self._session(s)

    async def test_a_draft_session_has_exactly_one_owner(self) -> None:
        async with self.Session() as s:
            s.add(
                models.DraftSession(
                    tournament_id=self.ids["t"],
                    custom_game_id=self.cg_id,
                    lobby_index=0,
                    workspace_id=self.ids["ws"],
                    discipline="overwatch",
                )
            )
            with self.assertRaises(IntegrityError):
                await s.flush()

    async def test_a_mix_seat_is_a_member_never_a_registration(self) -> None:
        """R-ID: the CHECK accepts either id; the seed refuses a mix seat that names a registration instead."""
        async with self.Session() as s:
            draft = await self._session(s)
            with self.assertRaises(ApiHTTPException) as caught:
                await lifecycle.lifecycle_service.seed(
                    s,
                    draft,
                    seats=[
                        PoolSeat(None, draft_position=1, workspace_member_id=self.ids["m1"]),
                        PoolSeat(424242),
                    ],
                )

        self.assertEqual(
            (422, "seat_identity_invalid"), (caught.exception.status_code, caught.exception.detail[0]["code"])
        )

    async def test_a_tournament_seat_is_a_registration_never_a_bare_member(self) -> None:
        """R-ID: the seed refuses a tournament seat that names only a workspace member."""
        async with self.Session() as s:
            game = await s.get_one(models.CustomGame, self.cg_id)
            draft = await lifecycle.lifecycle_service.create_session(
                s,
                tournament_id=self.ids["t"],
                workspace_id=self.ids["ws"],
                shape=await team_format.custom_game_slot_shape(s, game),
            )
            self.draft_ids.append(draft.id)
            with self.assertRaises(ApiHTTPException) as caught:
                await lifecycle.lifecycle_service.seed(
                    s, draft, seats=[PoolSeat(None, draft_position=1, workspace_member_id=self.ids["m0"])]
                )

        self.assertEqual("overwatch", draft.discipline)
        self.assertEqual(
            (422, "seat_identity_invalid"), (caught.exception.status_code, caught.exception.detail[0]["code"])
        )

    async def test_a_mix_draft_starts_without_any_tournament_phase(self) -> None:
        draft_id = await self._seeded()
        async with self.Session() as s:
            draft = await s.get_one(models.DraftSession, draft_id)
            await lifecycle.lifecycle_service.start(s, draft)
            await s.commit()
            on_clock = await s.get_one(models.DraftPick, draft.current_pick_id)

        self.assertEqual(DraftStatus.LIVE.value, draft.status)
        self.assertEqual(1, on_clock.overall_no)

    async def test_deleting_the_workspace_takes_a_mix_draft_with_it(self) -> None:
        """The seat's member FK is the anchor rule (NO ACTION, deferred): the workspace cascade removes member, session
        and seats in one statement, and by commit nothing is left pointing anywhere. A SET NULL there would strip a mix
        seat of its only identity and trip ``ck_draft_player_identity`` instead."""
        draft_id = await self._seeded()
        async with self.Session() as s:
            await s.execute(sa.delete(models.Workspace).where(models.Workspace.id == self.ids["ws"]))
            await s.commit()
            sessions = await s.scalar(
                sa.select(sa.func.count()).select_from(models.DraftSession).where(models.DraftSession.id == draft_id)
            )
            seats = await s.scalar(
                sa.select(sa.func.count())
                .select_from(models.DraftPlayer)
                .where(models.DraftPlayer.session_id == draft_id)
            )

        self.assertEqual((0, 0), (sessions, seats))
