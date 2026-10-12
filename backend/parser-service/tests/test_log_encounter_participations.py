"""A log reaches its encounter through the participations, and a substitute joins them (D19).

Needs the test Postgres: the partial unique indexes behind "one active occupant
per slot" and the roster snapshot are what the log flow leans on, so an
in-memory double would not fail the way the database does.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import sqlalchemy as sa

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "parser-service"))
os.environ["DEBUG"] = "true"

from shared.core.enums import HeroClass  # noqa: E402
from shared.models.identity.user import User  # noqa: E402
from shared.services.encounter import participants  # noqa: E402
from shared.tests.encounter_writer_case import EncounterWriterCase  # noqa: E402

models = importlib.import_module("src.models")
encounter_flows = importlib.import_module("src.services.encounter.flows")
encounter_service = importlib.import_module("src.services.encounter.service")
match_logs_flows = importlib.import_module("src.services.match_logs.flows")
match_logs_service = importlib.import_module("src.services.match_logs.service")
roster = importlib.import_module("src.services.match_logs.roster")


class ParticipationCase(EncounterWriterCase):
    async def seat(self, session, slot: int, team_key: str, *member_keys: str) -> models.EncounterTeam:
        encounter = await self.encounter(session)
        return await participants.place_team(
            session,
            encounter,
            slot=slot,
            team_id=self.ids[team_key],
            name=team_key.upper(),
            seed=None,
            members=[
                participants.MemberSnapshot(
                    workspace_member_id=self.ids[key],
                    display_name=key,
                    rank=3000,
                    is_substitute=False,
                    roles=(("player_role", "damage"),),
                )
                for key in member_keys
            ],
        )


class ResolutionThroughParticipationsTests(ParticipationCase):
    async def _replace_second_occupant(self) -> None:
        async with self.Session() as s:
            await self.seat(s, 1, "team0")
            await self.seat(s, 2, "team1")
            await s.commit()
        async with self.Session() as s:
            encounter = await self.encounter(s)
            await participants.vacate_slot(s, encounter, slot=2)
            await self.seat(s, 2, "team2")
            await s.commit()

    async def test_a_replaced_occupant_no_longer_resolves_to_the_encounter(self) -> None:
        await self._replace_second_occupant()
        encounter_id, original, replaced, replacement = (self.ids[k] for k in ("e", "team0", "team1", "team2"))

        async with self.Session() as s:
            self.assertEqual(
                [encounter_id], [e.id for e in await encounter_service.list_by_teams(s, original, replacement)]
            )
            self.assertEqual([], list(await encounter_service.list_by_teams(s, original, replaced)))
            self.assertEqual({original, replacement}, await encounter_service.active_team_ids(s, encounter_id))

    async def test_the_log_of_the_replacement_resolves_and_the_log_of_the_replaced_team_does_not(self) -> None:
        await self._replace_second_occupant()
        encounter_id, original, replaced, replacement = (self.ids[k] for k in ("e", "team0", "team1", "team2"))
        resolve = encounter_flows.resolve_for_log

        async with self.Session() as s:
            found = await resolve(s, (original, replacement), log_name="m.txt", map_id=1, map_pools=[])
            self.assertEqual(encounter_id, found.id)

            with self.assertRaises(encounter_flows.errors.ApiHTTPException) as missing:
                await resolve(s, (original, replaced), log_name="m.txt", map_id=1, map_pools=[])
            self.assertEqual(404, missing.exception.status_code)

            # An uploader's attachment is held to the same rule: the retired team is not seated.
            with self.assertRaises(encounter_flows.errors.ApiHTTPException) as mismatch:
                await resolve(
                    s,
                    (original, replaced),
                    log_name="m.txt",
                    map_id=1,
                    map_pools=[],
                    attached_encounter_id=encounter_id,
                )
            self.assertEqual("attached_encounter_mismatch", mismatch.exception.detail[0]["code"])
            attached = await resolve(
                s,
                (replacement, original),
                log_name="m.txt",
                map_id=1,
                map_pools=[],
                attached_encounter_id=encounter_id,
            )
            self.assertEqual(encounter_id, attached.id)


class SubstituteTests(ParticipationCase):
    def _processor(self):
        processor = match_logs_flows.MatchLogProcessor.__new__(match_logs_flows.MatchLogProcessor)
        processor.tournament = SimpleNamespace(workspace_id=self.ids["ws"])
        return processor

    async def _players_in_tournament(self, session) -> int:
        return await session.scalar(
            sa.select(sa.func.count()).select_from(models.Player).where(models.Player.tournament_id == self.ids["t"])
        )

    async def test_a_player_outside_the_roster_is_seated_as_a_substitute_not_inserted_as_a_roster_row(self) -> None:
        async with self.Session() as s:
            participation = await self.seat(s, 1, "team0", "m0", "m1")
            await self.seat(s, 2, "team1", "m3")
            await s.commit()
            team_id, participation_id = participation.team_id, participation.id

        # m0 is in the log, m1 is not: user 2 played in his place.
        missing = roster.LogPlayer(user_id=self.users[1], team_id=team_id, name="u1", role=HeroClass.damage, rank=2800)
        present = roster.LogPlayer(user_id=self.users[0], team_id=team_id, name="u0", role=HeroClass.damage, rank=3000)
        roster_rows = [
            SimpleNamespace(
                is_substitution=False,
                workspace_member=SimpleNamespace(player_id=player.user_id),
                team_id=player.team_id,
                name=player.name,
                role=player.role,
                rank=player.rank,
            )
            for player in (present, missing)
        ]

        for _ in range(2):  # the second parse of the same log must not seat the substitute twice
            async with self.Session() as s:
                participation = await s.get_one(models.EncounterTeam, participation_id)
                sub_user = await s.get_one(User, self.users[2])
                team = SimpleNamespace(id=team_id, name="T0", players=roster_rows)
                _, players = await self._processor().fix_team_players_collision(
                    s,
                    team,
                    participation,
                    {"u0": present},
                    [("u0", await s.get_one(User, self.users[0])), ("u2", sub_user)],
                )
                await s.commit()

            self.assertEqual({"u0", "u2"}, set(players))
            self.assertEqual(
                roster.LogPlayer(
                    user_id=self.users[2],
                    team_id=team_id,
                    name=sub_user.name,
                    role=HeroClass.damage,
                    rank=2800,
                ),
                players["u2"],
            )

        async with self.Session() as s:
            substitutes = (
                await s.scalars(
                    sa.select(models.EncounterTeamMember).where(
                        models.EncounterTeamMember.encounter_team_id == participation_id,
                        models.EncounterTeamMember.is_substitute.is_(True),
                    )
                )
            ).all()
            self.assertEqual([self.ids["m2"]], [row.workspace_member_id for row in substitutes])
            self.assertEqual(2800, substitutes[0].rank)
            roles = (
                await s.scalars(
                    sa.select(models.EncounterTeamMemberRole.role).where(
                        models.EncounterTeamMemberRole.team_member_id == substitutes[0].id
                    )
                )
            ).all()
            self.assertEqual(["damage"], list(roles))
            self.assertEqual(0, await self._players_in_tournament(s))
            self.assertIsNotNone(await match_logs_service.get_substitute(s, participation_id, self.users[2]))
            self.assertIsNone(await match_logs_service.get_substitute(s, participation_id, self.users[0]))
