"""Public achievement readers pool by ``(discipline, slug)`` and divide by their own game's players (P6 Task 3).

Real PostgreSQL, one rolled-back transaction per test. Two workspaces both enable Overwatch and League and carry a rule
under the *same slug* in each game, so a reader that pools by slug alone (or divides by every player) gives a visibly
wrong number. The shared test database may hold other data, so cross-workspace denominators are measured with an
independent plain count taken before the seed rather than assumed.
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from datetime import UTC, datetime
from unittest import IsolatedAsyncioTestCase

import sqlalchemy as sa
from cashews import cache
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import pagination
from shared.models.achievements.achievement import AchievementRule
from shared.repository.support import AchievementEvaluationResultRepository, AchievementRuleRepository
from shared.testing import create_test_async_engine, ensure_test_postgres
from src.schemas import AchievementRead
from src.services.achievements.service import achievements

_rules = AchievementRuleRepository()
_results = AchievementEvaluationResultRepository()
OW, LOL = "overwatch", "lol"


class _DbCase(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop  # psycopg async cannot run on the Proactor loop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        await cache.delete_match("backend:achievement_rarity_map:*")
        self.engine = create_test_async_engine()
        self.connection = await self.engine.connect()
        self.transaction = await self.connection.begin()
        self.session = AsyncSession(self.connection, expire_on_commit=False, join_transaction_mode="create_savepoint")
        self.tag = uuid.uuid4().hex[:12]
        self.slug = f"veteran-{self.tag}"
        self.baseline = {d: await self._players_of(d) for d in (OW, LOL)}
        self.catalogue_total = (await self._catalogue()).total
        # (workspace, slug) is unique, so one slug overlapping across games lives in different workspaces
        self.wo1, self.wo2 = await self._workspace("ow-one"), await self._workspace("ow-two")
        self.wl1, self.wl2 = await self._workspace("lol-one"), await self._workspace("lol-two")

    async def asyncTearDown(self) -> None:
        await self.session.close()
        await self.transaction.rollback()
        await self.connection.close()
        await self.engine.dispose()

    async def _players_of(self, discipline: str) -> int:
        """Plain distinct-player count of one game across the whole database (independent of the reader)."""
        return await self.session.scalar(
            sa.select(sa.func.count(models.WorkspaceMember.player_id.distinct()))
            .select_from(models.Player)
            .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
            .join(models.WorkspaceMember, models.WorkspaceMember.id == models.Player.workspace_member_id)
            .where(models.Tournament.discipline == discipline)
        )

    async def _workspace(self, label: str) -> models.Workspace:
        ws = models.Workspace(
            slug=f"{self.tag}-{label}",
            name=f"{self.tag}-{label}",
            disciplines_enabled=[OW, LOL],
            verification_status="verified",
        )
        self.session.add(ws)
        await self.session.flush()
        return ws

    async def member(self, ws: models.Workspace, user: models.User | None = None) -> models.WorkspaceMember:
        if user is None:
            user = models.User(name=f"{self.tag}-u{uuid.uuid4().hex[:8]}")
            self.session.add(user)
            await self.session.flush()
        member = models.WorkspaceMember(workspace_id=ws.id, player_id=user.id)
        self.session.add(member)
        await self.session.flush()
        return member

    async def roster(self, ws: models.Workspace, discipline: str, members: list[models.WorkspaceMember]) -> None:
        tournament = models.Tournament(
            workspace_id=ws.id,
            name=f"{self.tag}-{discipline}-{ws.id}-{uuid.uuid4().hex[:6]}",
            slug=f"{self.tag}-{discipline}-{ws.id}-{uuid.uuid4().hex[:6]}",
            discipline=discipline,
            start_date=datetime(2026, 1, 1, tzinfo=UTC),
        )
        self.session.add(tournament)
        await self.session.flush()
        team = models.Team(tournament_id=tournament.id, name="t", balancer_name="t")
        self.session.add(team)
        await self.session.flush()
        for member in members:
            self.session.add(
                models.Player(
                    tournament_id=tournament.id,
                    team_id=team.id,
                    workspace_member_id=member.id,
                    name=f"p{member.id}",
                    rank=1000,
                    is_substitution=False,
                    is_newcomer=False,
                    is_newcomer_role=False,
                )
            )
        await self.session.flush()

    async def character(self, discipline: str) -> models.CatalogEntity:
        entity = models.CatalogEntity(
            discipline=discipline,
            kind="character",
            slug=f"{self.tag}-{discipline}",
            name=f"{self.tag}-{discipline}",
            attrs={"class": "damage"} if discipline == OW else {},
        )
        self.session.add(entity)
        await self.session.flush()
        return entity

    async def rule(
        self, ws: models.Workspace, discipline: str, entity: models.CatalogEntity | None = None
    ) -> AchievementRule:
        rule = AchievementRule(
            workspace_id=ws.id,
            slug=self.slug,
            name=f"{self.slug}-{discipline}",
            description_ru="ru",
            description_en="en",
            discipline=discipline,
            entity_id=entity.id if entity else None,
            category="overall",
            scope="global",
            grain="user",
            condition_tree={},
            depends_on=[],
            enabled=True,
            rule_version=1,
        )
        await _rules.create(self.session, rule)
        return rule

    async def award(self, rule: AchievementRule, member: models.WorkspaceMember) -> None:
        await _results.bulk_upsert_ignore_conflicts(
            self.session,
            [
                {
                    "achievement_rule_id": rule.id,
                    "workspace_member_id": member.id,
                    "tournament_id": None,
                    "encounter_id": None,
                    "match_id": None,
                    "qualified_at": datetime.now(UTC),
                    "rule_version": rule.rule_version,
                    "run_id": None,
                    "evidence_json": {},
                }
            ],
        )

    async def _catalogue(
        self, workspace_id: int | None = None, discipline: str | None = None
    ) -> pagination.Paginated[AchievementRead]:
        params = pagination.PaginationSortParams(per_page=100, sort="id", order="desc", entities=["entity", "count"])
        return await achievements.get_all(self.session, params, workspace_id=workspace_id, discipline=discipline)

    async def mine(self, workspace_id: int | None = None) -> dict[str, AchievementRead]:
        """This test's rules in a catalogue read, by discipline (one per (discipline, slug))."""
        rows = [r for r in (await self._catalogue(workspace_id)).results if r.slug == self.slug]
        by_discipline = {r.discipline: r for r in rows}
        self.assertEqual(len(rows), len(by_discipline), "a (discipline, slug) listed twice")
        return by_discipline


class _TwoGames(_DbCase):
    """Overwatch (workspaces wo1, wo2): a, b in wo1 and c in wo2 (3 players). League (wl1, wl2): d, e, h in wl1 and
    f, g in wl2 (5 players). Every rule has the same slug.

    Overwatch earners: a (wo1 copy), c (wo2 copy). League earners: d (wl1 copy), f and g (wl2 copy).
    """

    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        self.ow_char, self.lol_char = await self.character(OW), await self.character(LOL)
        self.ow1 = await self.rule(self.wo1, OW, self.ow_char)
        self.ow2 = await self.rule(self.wo2, OW, self.ow_char)
        self.lol1 = await self.rule(self.wl1, LOL, self.lol_char)
        self.lol2 = await self.rule(self.wl2, LOL, self.lol_char)
        self.a, self.b, self.c = await self.member(self.wo1), await self.member(self.wo1), await self.member(self.wo2)
        self.d, self.e, self.h = [await self.member(self.wl1) for _ in range(3)]
        self.f, self.g = await self.member(self.wl2), await self.member(self.wl2)
        await self.roster(self.wo1, OW, [self.a, self.b])
        await self.roster(self.wo2, OW, [self.c])
        await self.roster(self.wl1, LOL, [self.d, self.e, self.h])
        await self.roster(self.wl2, LOL, [self.f, self.g])
        for rule, member in (
            (self.ow1, self.a),
            (self.ow2, self.c),
            (self.lol1, self.d),
            (self.lol2, self.f),
            (self.lol2, self.g),
        ):
            await self.award(rule, member)


class PooledCatalogueTests(_TwoGames):
    async def test_cross_workspace_catalogue_lists_one_rule_per_discipline_and_slug(self) -> None:
        listed = await self.mine()
        self.assertEqual({OW, LOL}, set(listed))
        # the oldest copy of each game represents it, and the grand total moved by exactly the two keys
        self.assertEqual((self.ow1.id, self.lol1.id), (listed[OW].id, listed[LOL].id))
        self.assertEqual(self.catalogue_total + 2, (await self._catalogue()).total)

    async def test_pooled_count_and_rarity_stay_inside_the_game(self) -> None:
        listed = await self.mine()
        self.assertEqual((2, 3), (listed[OW].count, listed[LOL].count))
        self.assertAlmostEqual(2 / (self.baseline[OW] + 3), listed[OW].rarity)
        self.assertAlmostEqual(3 / (self.baseline[LOL] + 5), listed[LOL].rarity)

    async def test_workspace_scope_divides_by_that_workspaces_players_of_the_game(self) -> None:
        ow, lol = await self.mine(self.wo1.id), await self.mine(self.wl1.id)
        self.assertEqual(
            ({OW: self.ow1.id}, {LOL: self.lol1.id}),
            ({d: r.id for d, r in ow.items()}, {d: r.id for d, r in lol.items()}),
        )
        self.assertEqual((1, 1), (ow[OW].count, lol[LOL].count))
        self.assertAlmostEqual(1 / 2, ow[OW].rarity)
        self.assertAlmostEqual(1 / 3, lol[LOL].rarity)

    async def test_players_of_another_game_do_not_change_a_rarity(self) -> None:
        # Both workspaces enable both games: League players join the Overwatch workspace and vice versa.
        before_ow, before_lol, before_pooled = (
            await self.mine(self.wo1.id),
            await self.mine(self.wl1.id),
            await self.mine(),
        )
        await self.roster(self.wo1, LOL, [await self.member(self.wo1) for _ in range(4)])
        await self.roster(self.wl1, OW, [await self.member(self.wl1) for _ in range(4)])
        after_ow, after_lol, after_pooled = (
            await self.mine(self.wo1.id),
            await self.mine(self.wl1.id),
            await self.mine(),
        )
        self.assertEqual(before_ow[OW].rarity, after_ow[OW].rarity)
        self.assertEqual(before_lol[LOL].rarity, after_lol[LOL].rarity)
        # the pooled view moves only by the players of its own game
        self.assertAlmostEqual(2 / (self.baseline[OW] + 3 + 4), after_pooled[OW].rarity)
        self.assertAlmostEqual(3 / (self.baseline[LOL] + 5 + 4), after_pooled[LOL].rarity)
        self.assertGreater(before_pooled[OW].rarity, after_pooled[OW].rarity)

    async def test_entity_is_the_catalog_character_of_the_rules_own_game(self) -> None:
        listed = await self.mine()
        self.assertEqual((OW, self.ow_char.id), (listed[OW].discipline, listed[OW].entity_id))
        self.assertEqual((OW, self.ow_char.id), (listed[OW].entity.discipline, listed[OW].entity.id))
        self.assertEqual((LOL, self.lol_char.id), (listed[LOL].entity.discipline, listed[LOL].entity.id))
        self.assertEqual("character", listed[LOL].entity.kind)

    async def test_entity_is_expanded_only_on_request(self) -> None:
        params = pagination.PaginationSortParams(per_page=100, sort="id", order="desc", entities=[])
        page = await achievements.get_all(self.session, params, workspace_id=self.wl1.id)
        mine = [r for r in page.results if r.slug == self.slug]
        self.assertEqual([(LOL, self.lol_char.id)], [(r.discipline, r.entity_id) for r in mine])
        self.assertTrue(all(r.entity is None and r.count is None for r in mine))
        self.assertNotIn("hero_id", AchievementRead.model_fields)
        self.assertNotIn("hero", AchievementRead.model_fields)


class DisciplineFilterTests(_TwoGames):
    async def test_the_filter_lists_one_game_with_its_own_pooling(self) -> None:
        for game, rule, count, players in (
            (OW, self.ow1, 2, self.baseline[OW] + 3),
            (LOL, self.lol1, 3, self.baseline[LOL] + 5),
        ):
            with self.subTest(game=game):
                page = await self._catalogue(discipline=game)
                mine = [r for r in page.results if r.slug == self.slug]
                self.assertEqual([(rule.id, game)], [(r.id, r.discipline) for r in mine])
                self.assertEqual({game}, {r.discipline for r in page.results})
                self.assertEqual(count, mine[0].count)
                self.assertAlmostEqual(count / players, mine[0].rarity)
                # the total counts only this game's representatives
                self.assertEqual(len(page.results), page.total)

    async def test_the_filter_narrows_a_workspace_view_and_an_unknown_game_is_empty(self) -> None:
        page = await self._catalogue(self.wo1.id, discipline=LOL)
        self.assertEqual(([], 0), (page.results, page.total))
        own = await self._catalogue(self.wo1.id, discipline=OW)
        self.assertEqual([self.ow1.id], [r.id for r in own.results if r.slug == self.slug])
        nothing = await self._catalogue(discipline="chess")
        self.assertEqual(([], 0), (nothing.results, nothing.total))

    async def test_the_public_list_params_accept_a_discipline(self) -> None:
        from shared.rpc.query import build_query_model
        from src.schemas import AchievementListQueryParams

        qp = build_query_model(AchievementListQueryParams, {"discipline": ["lol"], "sort": ["rarity"]})
        self.assertEqual(("lol", "rarity"), (qp.discipline, qp.sort))
        self.assertIsNone(build_query_model(AchievementListQueryParams, {}).discipline)

    async def test_the_rpc_list_entrypoint_serves_the_filter(self) -> None:
        """The registry handler behind ``GET /api/v1/achievements`` (the page's actual request) with and without a game."""
        from src.services.read_registry import _achievement_list

        query = {"per_page": ["-1"], "sort": ["rarity"], "entities": ["count"]}
        everything = await _achievement_list(self.session, {"query": query})
        one_game = await _achievement_list(self.session, {"query": {**query, "discipline": [LOL]}})
        self.assertEqual({OW, LOL}, {row["discipline"] for row in everything["results"]})
        self.assertEqual({LOL}, {row["discipline"] for row in one_game["results"]})


class RuleDetailTests(_TwoGames):
    async def test_a_rule_id_detail_uses_its_own_discipline_under_aggregate_scope(self) -> None:
        for rule, expected_count, players_in_game, game in (
            (self.ow2, 2, self.baseline[OW] + 3, OW),
            (self.lol2, 3, self.baseline[LOL] + 5, LOL),
        ):
            with self.subTest(game=game):
                detail = await achievements.get(self.session, rule.id, ["entity", "count"], merge_slugs=True)
                self.assertEqual((rule.id, game), (detail.id, detail.discipline))
                self.assertEqual(expected_count, detail.count)
                self.assertAlmostEqual(expected_count / players_in_game, detail.rarity)

    async def test_a_workspace_detail_counts_only_its_own_copy(self) -> None:
        detail = await achievements.get(self.session, self.lol2.id, ["count"], workspace_id=self.wl2.id)
        self.assertEqual(2, detail.count)
        self.assertAlmostEqual(2 / 2, detail.rarity)

    async def test_pooled_earners_are_the_rules_game_only(self) -> None:
        params = pagination.PaginationParams(per_page=100)
        for rule, members in ((self.ow1, (self.a, self.c)), (self.lol2, (self.d, self.f, self.g))):
            with self.subTest(rule=rule.discipline):
                page = await achievements.get_achievement_users(self.session, rule.id, params, merge_slugs=True)
                self.assertEqual({m.player_id for m in members}, {row.user.id for row in page.results})
                self.assertEqual(len(members), page.total)

    async def test_unpooled_earners_are_the_one_workspace_copy(self) -> None:
        page = await achievements.get_achievement_users(
            self.session, self.lol2.id, pagination.PaginationParams(per_page=100)
        )
        self.assertEqual({self.f.player_id, self.g.player_id}, {row.user.id for row in page.results})


class UserAchievementTests(_TwoGames):
    async def test_same_game_copies_pool_into_one_entry_and_the_other_game_stays_out(self) -> None:
        user = await self.session.get(models.User, self.a.player_id)
        in_w2 = await self.member(self.wo2, user)
        await self.roster(self.wo2, OW, [in_w2])
        await self.award(self.ow2, in_w2)  # the same player earned the Overwatch copy in both workspaces

        earned = {
            (row.discipline, row.slug): row
            for row in await achievements.get_user_achievements(self.session, user.id, ["entity"])
            if row.slug == self.slug
        }
        self.assertEqual({(OW, self.slug)}, set(earned))
        self.assertEqual(2, earned[(OW, self.slug)].count)

        # d is a League-only player: the Overwatch copy of the same slug is not hers
        d_user = await achievements.get_user_achievements(self.session, self.d.player_id, [])
        self.assertEqual([(LOL, 1)], [(r.discipline, r.count) for r in d_user if r.slug == self.slug])

    async def test_a_player_of_both_games_gets_one_entry_per_discipline(self) -> None:
        user = await self.session.get(models.User, self.b.player_id)
        in_lol = await self.member(self.wl2, user)
        await self.roster(self.wl2, LOL, [in_lol])
        await self.award(self.ow1, self.b)
        await self.award(self.lol2, in_lol)

        rows = [r for r in await achievements.get_user_achievements(self.session, user.id, []) if r.slug == self.slug]
        self.assertEqual({OW, LOL}, {r.discipline for r in rows})
        self.assertEqual({1}, {r.count for r in rows})
        by_game = {r.discipline: r for r in rows}
        # b joins League in wl2: one more League player and one more League earner; b already counted in Overwatch
        self.assertAlmostEqual(4 / (self.baseline[LOL] + 6), by_game[LOL].rarity)
        self.assertAlmostEqual(3 / (self.baseline[OW] + 3), by_game[OW].rarity)

    async def test_locked_entries_are_per_discipline_and_slug(self) -> None:
        stranger = models.User(name=f"{self.tag}-stranger")
        self.session.add(stranger)
        await self.session.flush()
        in_w1 = await self.member(self.wo1, stranger)
        await self.award(self.ow1, in_w1)

        rows = [
            r
            for r in await achievements.get_user_achievements(self.session, stranger.id, [], include_locked=True)
            if r.slug == self.slug
        ]
        self.assertEqual({OW: 1, LOL: 0}, {r.discipline: r.count for r in rows})
