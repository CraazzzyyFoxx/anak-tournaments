"""User reads bound to one game never mix another game's rows (P7 8b review, findings 2, 3, 5).

Real PostgreSQL, one rolled-back transaction. Users a, b, c in one workspace that runs both games:

- Overwatch: T1 (a+b beat c 2-1), T2 (a+b beat c 3-0) — a and b share two tournaments; everyone played two.
- League: L1 (a+b lose to c 0-2), L2 (c alone) — c played two, a and b one.
- Achievements: an Overwatch rule earned by b, a League rule earned by c.

A read that mixes games shows a's all-workspaces maps as 5-3 (not 5-1), b as a teammate across three tournaments,
c's League award in the Overwatch count, or the cached Overwatch tournaments order on the League board.
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from datetime import UTC, datetime
from unittest import IsolatedAsyncioTestCase

from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import enums
from shared.division_grid import DEFAULT_GRID
from shared.models.achievements.achievement import AchievementEvaluationResult, AchievementRule
from shared.testing import create_test_async_engine, ensure_test_postgres
from src import schemas
from src.core import pagination
from src.services.achievements.service import achievements as achievement_service
from src.services.user.queries.overview import UserOverviewQueries
from src.services.user.queries.profile import UserProfileQueries
from src.services.user.service import UserService
from tests.encounter_seed import seed_encounter, seed_scoring_rule

OW, LOL = "overwatch", "lol"


class UserReadsOneGameTest(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop  # psycopg async cannot run on the Proactor loop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.connection = await self.engine.connect()
        self.transaction = await self.connection.begin()
        self.session = AsyncSession(self.connection, expire_on_commit=False, join_transaction_mode="create_savepoint")
        self.tag = uuid.uuid4().hex[:10]
        self.ws = models.Workspace(slug=f"one-{self.tag}", name=f"one-{self.tag}", disciplines_enabled=[OW, LOL])
        self.session.add(self.ws)
        await self.session.flush()
        self.users: dict[str, models.User] = {}
        self.members: dict[str, models.WorkspaceMember] = {}
        for key in ("a", "b", "c"):
            user = models.User(name=f"zz{self.tag}-{key}")
            self.session.add(user)
            await self.session.flush()
            member = models.WorkspaceMember(workspace_id=self.ws.id, player_id=user.id)
            self.session.add(member)
            await self.session.flush()
            self.users[key], self.members[key] = user, member
        self.rule_id = await seed_scoring_rule(self.session, self.ws.id)
        self.tournaments: dict[str, models.Tournament] = {}

        await self._tournament(OW, "t1", [("a", "b")], ("c",), (2, 1))
        await self._tournament(OW, "t2", [("a", "b")], ("c",), (3, 0))
        await self._tournament(LOL, "l1", [("a", "b")], ("c",), (0, 2))
        await self._tournament(LOL, "l2", [], ("c",), None)
        await self._award(OW, "b")
        await self._award(LOL, "c")

    async def asyncTearDown(self) -> None:
        await self.session.close()
        await self.transaction.rollback()
        await self.connection.close()
        await self.engine.dispose()

    async def _tournament(
        self,
        discipline: str,
        label: str,
        home: list[tuple[str, ...]],
        away: tuple[str, ...],
        score: tuple[int, int] | None,
    ) -> None:
        day = datetime(2026, 1, 10, tzinfo=UTC)
        tournament = models.Tournament(
            workspace_id=self.ws.id,
            discipline=discipline,
            name=f"{label} {self.tag}",
            slug=f"{label}-{self.tag}",
            status=enums.TournamentStatus.COMPLETED,
            is_finished=True,
            is_league=False,
            start_date=day,
            end_date=day,
        )
        self.session.add(tournament)
        await self.session.flush()
        self.tournaments[label] = tournament
        teams = []
        for index, keys in enumerate([*home, away]):
            team = models.Team(
                tournament_id=tournament.id, name=f"{label}{index} {self.tag}", balancer_name=f"{label}{index}"
            )
            self.session.add(team)
            await self.session.flush()
            for key in keys:
                self.session.add(
                    models.Player(
                        tournament_id=tournament.id,
                        team_id=team.id,
                        workspace_member_id=self.members[key].id,
                        name=f"{key}{self.tag}",
                        rank=1000,
                        is_substitution=False,
                        is_newcomer=False,
                        is_newcomer_role=False,
                    )
                )
            teams.append(team)
        await self.session.flush()
        if score is not None:
            await seed_encounter(
                self.session, tournament, self.rule_id, list(zip(teams, score, strict=True)), name=f"{label} {self.tag}"
            )

    async def _award(self, discipline: str, key: str) -> None:
        rule = AchievementRule(
            workspace_id=self.ws.id,
            slug=f"r-{discipline}-{self.tag}",
            name=f"r-{discipline}",
            description_ru="ru",
            description_en="en",
            discipline=discipline,
            category="overall",
            scope="global",
            grain="user",
            condition_tree={},
            depends_on=[],
            enabled=True,
            rule_version=1,
        )
        self.session.add(rule)
        await self.session.flush()
        self.session.add(
            AchievementEvaluationResult(
                achievement_rule_id=rule.id,
                workspace_member_id=self.members[key].id,
                qualified_at=datetime.now(UTC),
                rule_version=1,
            )
        )
        await self.session.flush()

    def _ids(self, *keys: str) -> list[int]:
        return [self.users[key].id for key in keys]

    async def _board(self, discipline: str, sort: str) -> list[int]:
        params = schemas.UserOverviewParams(per_page=50, sort=sort, order="desc")
        users, _total = await UserOverviewQueries.of(discipline).get_overview_users(
            self.session, params, DEFAULT_GRID, workspace_id=self.ws.id
        )
        return [user.id for user in users]

    async def test_all_workspaces_profile_totals_and_teammates_are_one_games(self) -> None:
        profile = UserProfileQueries.of(OW)
        won, lost, _closeness = await profile.get_overall_statistics(self.session, self.users["a"].id, None)
        self.assertEqual((won, lost), (5, 1))

        rows, total = await profile.get_best_teammates(
            self.session, self.users["a"].id, pagination.PaginationSortParams(per_page=10, sort="id"), None
        )
        self.assertEqual(total, 1)
        teammate, winrate, tournaments, *_rest = rows[0]
        self.assertEqual(teammate.id, self.users["b"].id)
        self.assertEqual(tournaments, 2)
        self.assertAlmostEqual(float(winrate), 5 / 6)

    async def test_overview_achievement_counts_are_the_games_rules(self) -> None:
        ids = self._ids("a", "b", "c")
        self.assertEqual(
            await UserOverviewQueries.of(OW).get_overview_achievements_count(self.session, ids, self.ws.id),
            {self.users["b"].id: 1},
        )
        self.assertEqual(
            await UserOverviewQueries.of(LOL).get_overview_achievements_count(self.session, ids, self.ws.id),
            {self.users["c"].id: 1},
        )
        # The unfiltered sort reads the same one-game aggregate.
        self.assertEqual(await self._board(OW, "achievements_count"), self._ids("b", "a", "c"))
        self.assertEqual(await self._board(LOL, "achievements_count"), self._ids("c", "a", "b"))

    async def test_cached_overview_order_is_per_game(self) -> None:
        # Same workspace, sort and direction: the League board is its own cached order, not Overwatch's.
        self.assertEqual(await self._board(OW, "tournaments_count"), self._ids("a", "b", "c"))
        self.assertEqual(await self._board(LOL, "tournaments_count"), self._ids("c", "a", "b"))

    async def test_tournament_stats_carry_the_tournaments_owner_scope(self) -> None:
        read = await UserService.of(LOL).get_tournament_with_stats(
            self.session, self.users["a"].id, self.tournaments["l1"].id, grid=DEFAULT_GRID
        )
        self.assertEqual((read.workspace_id, read.discipline), (self.ws.id, LOL))

    async def test_profile_achievements_list_only_the_games_rules_earned_and_locked(self) -> None:
        async def slugs(key: str, discipline: str | None) -> dict[str, int]:
            rows = await achievement_service.get_user_achievements(
                self.session,
                self.users[key].id,
                [],
                workspace_id=self.ws.id,
                include_locked=True,
                discipline=discipline,
            )
            return {row.slug: row.count for row in rows}

        ow_rule, lol_rule = f"r-{OW}-{self.tag}", f"r-{LOL}-{self.tag}"
        # b earned the Overwatch rule: its League profile shows only League's (locked) rule, never the OW one.
        self.assertEqual(await slugs("b", LOL), {lol_rule: 0})
        self.assertEqual(await slugs("b", OW), {ow_rule: 1})
        # c earned the League rule; its Overwatch profile lists Overwatch's rule locked.
        self.assertEqual(await slugs("c", OW), {ow_rule: 0})
        self.assertEqual(await slugs("c", LOL), {lol_rule: 1})
        # Without a game (the admin person hub) every game's rules are listed, as before.
        self.assertEqual(await slugs("b", None), {ow_rule: 1, lol_rule: 0})
