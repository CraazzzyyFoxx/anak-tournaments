"""Achievements read surface: rules plus the effective per-user results.

Reads ``AchievementRule`` + ``AchievementEvaluationResult``, which the rules
engine writes; the SQL behind it lives on ``AchievementQueries`` in ``queries.py``.
"""

import typing

from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import errors, pagination
from shared.models.achievements.achievement import AchievementRule
from src import schemas
from src.services.user.service import users as user_service

from . import _mappers
from .queries import AchievementQueries
from .queries import queries as achievement_queries

__all__ = ("AchievementService", "achievements")


class AchievementService:
    def __init__(self, *, queries: AchievementQueries = achievement_queries) -> None:
        self.queries = queries

    async def bulk_to_achievement_read(
        self,
        session: AsyncSession,
        rules: typing.Sequence[tuple[AchievementRule, float]],
        entities: list[str],
        *,
        merge_slugs: bool = False,
    ) -> list[schemas.AchievementRead]:
        output: list[schemas.AchievementRead] = []
        count = None

        if "count" in entities:
            if merge_slugs:
                by_key = await self.queries.get_count_users_by_slug(
                    session, [(rule.discipline, rule.slug) for rule, _ in rules]
                )
                count = {rule.id: by_key.get((rule.discipline, rule.slug), 0) for rule, _ in rules}
            else:
                rule_ids = [rule.id for rule, _ in rules]
                count = await self.queries.get_count_users(session, rule_ids)

        for rule, rarity in rules:
            entity = None
            if "entity" in entities and rule.entity:
                entity = _mappers.to_entity_read(rule.entity)

            output.append(
                schemas.AchievementRead(
                    **rule.to_dict(),
                    rarity=rarity or 0.0,
                    entity=entity,
                    count=count.get(rule.id) if count else None,
                )
            )

        return output

    async def get(
        self,
        session: AsyncSession,
        achievement_id: int,
        entities: list[str],
        workspace_id: int | None = None,
        *,
        merge_slugs: bool = False,
    ) -> schemas.AchievementRead:
        result = await self.queries.get(
            session, achievement_id, entities, workspace_id=workspace_id, merge_slugs=merge_slugs
        )

        if not result:
            raise errors.ApiHTTPException(
                status_code=404,
                detail=[
                    errors.ApiExc(
                        code="not_found",
                        msg=f"Achievement not found with id={achievement_id}",
                    )
                ],
            )

        return (await self.bulk_to_achievement_read(session, [result], entities, merge_slugs=merge_slugs))[0]

    async def get_all(
        self,
        session: AsyncSession,
        params: pagination.PaginationSortParams,
        workspace_id: int | None = None,
        discipline: str | None = None,
    ) -> pagination.Paginated[schemas.AchievementRead]:
        rules, total = await self.queries.get_all(session, params, workspace_id=workspace_id, discipline=discipline)
        return pagination.Paginated(
            total=total,
            per_page=params.per_page,
            page=params.page,
            results=await self.bulk_to_achievement_read(session, rules, params.entities, merge_slugs=not workspace_id),
        )

    async def get_user_achievements(
        self,
        session: AsyncSession,
        user_id: int,
        entities: list[str],
        tournament_id: int | None = None,
        without_tournament: bool = False,
        workspace_id: int | None = None,
        include_locked: bool = False,
        discipline: str | None = None,
    ) -> list[schemas.UserAchievementRead]:
        user = await user_service.get(session, user_id, [])
        results = await self.queries.get_user_results(
            session,
            user,
            workspace_id=workspace_id,
            tournament_id=tournament_id,
            without_tournament=without_tournament,
            discipline=discipline,
        )

        # Keyed by (discipline, slug): slug is unique within a workspace but a game's copy
        # in another workspace shares it, so the cross-workspace view
        # (``workspace_id=None``) folds one game's copies of a rule into one — never
        # another game's rule that happens to reuse the slug.
        cache: dict[tuple[str, str], schemas.UserAchievementRead] = {}
        # Where each was earned: read only to expand the requested ``tournaments`` / ``matches``.
        tournament_ids: dict[tuple[str, str], set[int]] = {}
        match_ids: dict[tuple[str, str], set[int]] = {}

        for result_row in results:
            rule = result_row.rule
            key = (rule.discipline, rule.slug)

            if key not in cache:
                cache[key] = schemas.UserAchievementRead(
                    **rule.to_dict(),
                    rarity=result_row.rarity or 0.0,
                    count=0,
                    tournaments=[],
                    matches=[],
                    entity=None,
                )
            cache[key].count += 1
            if result_row.tournament_id:
                tournament_ids.setdefault(key, set()).add(result_row.tournament_id)
            if result_row.match_id:
                match_ids.setdefault(key, set()).add(result_row.match_id)

        # Append not-yet-earned rules as locked entries (count=0). Only meaningful for
        # the global view — a per-tournament filter scopes to what was earned there.
        if include_locked and tournament_id is None and not without_tournament:
            all_rules = await self.queries.get_all_rules_with_rarity(
                session, workspace_id=workspace_id, discipline=discipline
            )
            for rule, rarity in all_rules:
                key = (rule.discipline, rule.slug)
                if key in cache:
                    continue
                cache[key] = schemas.UserAchievementRead(
                    **rule.to_dict(),
                    rarity=rarity or 0.0,
                    count=0,
                    tournaments=[],
                    matches=[],
                    entity=None,
                )

        # Bulk-fetch tournaments and matches in one DB hit each, then map back to
        # achievements: a round trip per (achievement, tid) is O(N*M) on the hot
        # user-achievements endpoint.
        if "tournaments" in entities and tournament_ids:
            tournaments = await self.queries.get_tournaments_bulk(
                session, sorted(set().union(*tournament_ids.values()))
            )
            tournaments_map = {t.id: _mappers.to_tournament_link(t) for t in tournaments}
            for key, ids in tournament_ids.items():
                cache[key].tournaments = [tournaments_map[tid] for tid in sorted(ids) if tid in tournaments_map]

        if "matches" in entities and match_ids:
            matches = await self.queries.get_matches_bulk(session, sorted(set().union(*match_ids.values())))
            matches_map = {m.match.id: _mappers.to_match_link(m) for m in matches}
            for key, ids in match_ids.items():
                cache[key].matches = [matches_map[mid] for mid in sorted(ids) if mid in matches_map]

        return list(cache.values())

    async def get_achievement_users(
        self,
        session: AsyncSession,
        rule_id: int,
        params: pagination.PaginationParams,
        *,
        merge_slugs: bool = False,
    ) -> pagination.Paginated[schemas.AchievementEarned]:
        users, total = await self.queries.get_users_for_rule(session, rule_id, params, merge_slugs=merge_slugs)
        results: list[schemas.AchievementEarned] = []
        tournament_to_fetch: list[int] = []
        matches_to_fetch: list[int] = []

        for _, _, last_tournament_id, last_match_id in users:
            if last_tournament_id:
                tournament_to_fetch.append(last_tournament_id)
            if last_match_id:
                matches_to_fetch.append(last_match_id)

        tournaments = await self.queries.get_tournaments_bulk(session, tournament_to_fetch)
        matches = await self.queries.get_matches_bulk(session, matches_to_fetch)

        tournaments_map = {t.id: t for t in tournaments}
        matches_map = {m.match.id: m for m in matches}

        for user, count, last_tournament_id, last_match_id in users:
            last_tournament = tournaments_map.get(last_tournament_id) if last_tournament_id else None
            last_match = matches_map.get(last_match_id) if last_match_id else None

            results.append(
                schemas.AchievementEarned(
                    user=user_service.to_read(user, []),
                    count=count,
                    last_tournament=_mappers.to_tournament_link(last_tournament) if last_tournament else None,
                    last_match=_mappers.to_match_link(last_match) if last_match else None,
                )
            )

        return pagination.Paginated(
            total=total,
            per_page=params.per_page,
            page=params.page,
            results=results,
        )


achievements = AchievementService()
