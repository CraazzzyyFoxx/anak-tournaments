"""Postgres fixture shared by the participation- and result-writer tests.

Both suites need the same floor -- a workspace, four members, a tournament with
teams, a scoring rule and one encounter -- and both exercise writers that only
mean anything against the real constraints (the partial unique index on an
active slot, ``uq_result_audit_version``, ``SELECT … FOR UPDATE``). So the seed
lives here once instead of in two test modules.

Not a ``test_*`` module: pytest imports it, it collects nothing.
"""

from __future__ import annotations

import asyncio
import itertools
import os
import sys
from unittest import IsolatedAsyncioTestCase

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from shared.core import enums
from shared.models.custom_game import CustomGame
from shared.models.encounter import Encounter, ScoringRule
from shared.models.identity.user import User
from shared.models.tenancy.workspace import Workspace, WorkspaceMember
from shared.models.tournament.team import Team
from shared.models.tournament.tournament import Tournament
from shared.services.encounter.participants import place_team
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres

__all__ = ("WINS_END", "EncounterWriterCase")

#: The ``wins`` preset's end rule, as ``enclayer01`` writes it into every row.
WINS_END = "games >= best_of or max_wins * 2 > best_of"

#: ``players.user.name`` is globally unique and outlives its workspace, so the
#: tag has to be unique per TEST -- CPython reuses ``id(self)``.
_TAG = itertools.count()


class EncounterWriterCase(IsolatedAsyncioTestCase):
    """One empty encounter of ``slot_count`` seats, with teams to put in them."""

    slot_count = 2
    best_of = 3
    preset = "wins"
    game_formula = "win"
    end_formula = WINS_END

    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop  # psycopg async cannot run on the Proactor loop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        self.workspaces: list[int] = []
        self.users: list[int] = []
        self.ids = await self._seed()

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            # Workspaces first: a member row anchors the roster snapshots, and
            # the player behind it cannot go while the member is still there.
            await s.execute(sa.delete(Workspace).where(Workspace.id.in_(self.workspaces)))
            await s.execute(sa.delete(User).where(User.id.in_(self.users)))
            await s.commit()
        await self.engine.dispose()

    async def _seed(self) -> dict[str, int]:
        tag = f"encw-{os.getpid()}-{next(_TAG)}"
        async with self.Session() as s:
            ws = Workspace(slug=tag, name=tag)
            s.add(ws)
            await s.flush()
            self.workspaces.append(ws.id)
            users = [User(name=f"{tag}-{i}") for i in range(4)]
            s.add_all(users)
            await s.flush()
            self.users.extend(u.id for u in users)
            members = [WorkspaceMember(workspace_id=ws.id, player_id=u.id) for u in users]
            s.add_all(members)
            await s.flush()
            tournament = Tournament(
                workspace_id=ws.id, discipline="overwatch", name=tag, slug=tag, status=enums.TournamentStatus.LIVE
            )
            s.add(tournament)
            await s.flush()
            teams = [Team(tournament_id=tournament.id, name=f"T{i}", balancer_name=f"T{i}") for i in range(4)]
            rule = ScoringRule(
                workspace_id=ws.id,
                preset=self.preset,
                game_formula=self.game_formula,
                end_formula=self.end_formula,
            )
            s.add_all([*teams, rule])
            await s.flush()
            encounter = Encounter(
                workspace_id=ws.id,
                discipline="overwatch",
                tournament_id=tournament.id,
                scoring_rule_id=rule.id,
                name="E",
                slot_count=self.slot_count,
                best_of=self.best_of,
                status=enums.EncounterStatus.OPEN,
            )
            s.add(encounter)
            await s.commit()
            return {
                "ws": ws.id,
                "t": tournament.id,
                "rule": rule.id,
                "e": encounter.id,
                **{f"team{i}": team.id for i, team in enumerate(teams)},
                **{f"m{i}": member.id for i, member in enumerate(members)},
            }

    async def encounter(self, session: AsyncSession) -> Encounter:
        """The seeded encounter, loaded into ``session``."""
        return await session.get_one(Encounter, self.ids["e"])

    async def mix_encounter(self, session: AsyncSession) -> Encounter:
        """A two-seat encounter owned by a pickup mix of the seeded workspace (D71).

        No tournament and no source teams -- the shape every recorded mix round has. Flushed, not committed.
        """
        rule = ScoringRule(workspace_id=self.ids["ws"], preset="wins", game_formula="win", end_formula=WINS_END)
        session.add(rule)
        await session.flush()
        mix = CustomGame(workspace_id=self.ids["ws"], name="Mix", scoring_rule_id=rule.id)
        session.add(mix)
        await session.flush()
        encounter = Encounter(
            workspace_id=self.ids["ws"],
            discipline="overwatch",
            custom_game_id=mix.id,
            scoring_rule_id=rule.id,
            name="A vs B",
            slot_count=2,
            best_of=1,
            status=enums.EncounterStatus.OPEN,
        )
        session.add(encounter)
        await session.flush()
        for slot, name in ((1, "A"), (2, "B")):
            await place_team(session, encounter, slot=slot, team_id=None, name=name, seed=None, members=())
        return encounter
