import typing
from dataclasses import replace

import sqlalchemy as sa
from cashews import cache
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.repository import MapRepository
from src import models, schemas
from src.core import config, errors, pagination
from src.services.hero.queries import HeroQueries
from src.services.hero.queries import queries as hero_queries
from src.services.hero.service import heroes as hero_service
from src.services.user.service import users as user_service

__all__ = ("MapService", "maps")


class MapService:
    def __init__(
        self,
        *,
        repo: MapRepository = MapRepository(),
        hero_queries: HeroQueries = hero_queries,
    ) -> None:
        self.repo = repo
        self.hero_queries = hero_queries

    @staticmethod
    def to_read(game_map: models.Map, entities: list[str]) -> schemas.MapRead:
        """Serialize a Map into ``MapRead``, expanding the requested relations.

        ``entities`` only gates ``gamemode``; the relation must already be loaded by
        the caller's query (`MapRepository.load_options`), so this stays a pure
        in-memory projection.

        The one-line ``GamemodeRead`` construction is duplicated from
        ``read_registry._gamemode_read`` on purpose: reaching for it would add a
        dependency on the generic read engine for one repeated line.
        """
        gamemode: schemas.GamemodeRead | None = None
        if "gamemode" in entities:
            gamemode = schemas.GamemodeRead(**game_map.gamemode.to_dict())
        return schemas.MapRead(
            **game_map.to_dict(),
            gamemode=gamemode,
        )

    async def get(self, session: AsyncSession, id: int, entities: list[str]) -> schemas.MapRead:
        """Retrieve a map by ID and convert to its Pydantic schema."""
        game_map = await self.repo.get_expanded(session, id, entities)
        if not game_map:
            raise errors.ApiHTTPException(
                status_code=404,
                detail=[
                    errors.ApiExc(code="not_found", msg=f"Map with ID {id} not found"),
                ],
            )
        return self.to_read(game_map, entities)

    async def get_all(
        self, session: AsyncSession, params: pagination.PaginationSortParams
    ) -> pagination.Paginated[schemas.MapRead]:
        """Paginated maps — delegates to `MapRepository.all`."""
        game_maps, total = await self.repo.all(session, params, entities=params.entities)
        return pagination.Paginated(
            total=total,
            page=params.page,
            per_page=params.per_page,
            results=[self.to_read(game_map, params.entities) for game_map in game_maps],
        )

    @cache(
        ttl=config.settings.users_cache_ttl,
        key=(
            "backend:user_maps:{id}:{workspace_id}:{params.page}:{params.per_page}:{params.sort}:"
            "{params.order}:{params.query}:{params.fields}:{params.min_count}:"
            "{params.gamemode_id}:{params.tournament_id}:{params.entities}"
        ),
        lock=True,
    )
    async def get_top_user(
        self,
        session: AsyncSession,
        id: int,
        params: schemas.UserMapsSearchParams,
        *,
        workspace_id: int | None = None,
    ) -> pagination.Paginated[schemas.UserMap]:
        """Paginated top maps for a user, with per-map statistics.

        ``workspace_id`` scopes the stats to a single workspace; ``None`` spans all of them.
        """
        user = await user_service.get(session, id, [])
        maps, total = await self.get_top_maps(session, user.id, params, workspace_id=workspace_id)
        results: list[schemas.UserMap] = []

        for map_, count, win, loss, draw, win_rate in maps:
            results.append(
                schemas.UserMap(
                    map=self.to_read(map_, params.entities),
                    count=count,
                    win=win,
                    loss=loss,
                    draw=draw,
                    win_rate=win_rate,
                    heroes=[],
                )
            )

        if "heroes" in params.entities:
            maps_ids = [result.map.id for result in results]
            heroes_data = await self.hero_queries.get_heroes_playtime_by_maps(
                session, maps_ids, user.id, tournament_id=params.tournament_id, workspace_id=workspace_id
            )
            heroes_data_per_map: dict[int, list[schemas.HeroPlaytime]] = {map_id: [] for map_id in maps_ids}
            for hero, map_id, playtime in heroes_data:
                heroes_data_per_map[map_id].append(
                    schemas.HeroPlaytime(
                        hero=hero_service.to_read(hero),
                        playtime=playtime,
                    )
                )

            for result in results:
                result.heroes = heroes_data_per_map[result.map.id][:5]

        if "hero_stats" in params.entities:
            maps_ids = [result.map.id for result in results]
            hero_stats_rows = await self.hero_queries.get_user_hero_stats_by_maps(
                session,
                maps_ids,
                user.id,
                limit_per_map=5,
                tournament_id=params.tournament_id,
                workspace_id=workspace_id,
            )
            hero_stats_per_map: dict[int, list[schemas.UserMapHeroStats]] = {map_id: [] for map_id in maps_ids}
            for hero, map_id, games, win, loss, draw, win_rate, playtime_seconds, playtime_share in hero_stats_rows:
                hero_stats_per_map[map_id].append(
                    schemas.UserMapHeroStats(
                        hero=hero_service.to_read(hero),
                        games=games,
                        win=win,
                        loss=loss,
                        draw=draw,
                        win_rate=win_rate,
                        playtime_seconds=playtime_seconds,
                        playtime_share_on_map=playtime_share,
                    )
                )

            for result in results:
                result.hero_stats = hero_stats_per_map.get(result.map.id, [])

        return pagination.Paginated(
            page=params.page,
            per_page=params.per_page,
            total=total,
            results=results,
        )

    async def get_top_user_summary(
        self,
        session: AsyncSession,
        id: int,
        params: schemas.UserMapsSearchParams,
        *,
        workspace_id: int | None = None,
    ) -> schemas.UserMapsSummary:
        """Build a summary for the user's map performance.

        The summary is computed for the full filtered dataset (not just one page).
        To keep it cheap, this endpoint ignores heavy entities like hero stats.
        """

        user = await user_service.get(session, id, [])

        safe_entities = [e for e in params.entities if e in {"gamemode"}]
        all_params = replace(
            params,
            page=1,
            per_page=-1,
            sort="count",
            order="desc",
            entities=safe_entities,
        )

        rows, total = await self.get_top_maps(session, user.id, all_params, workspace_id=workspace_id)

        if not rows:
            return schemas.UserMapsSummary(
                overall=schemas.UserMapsOverall(
                    total_maps=0,
                    total_games=0,
                    win=0,
                    loss=0,
                    draw=0,
                    win_rate=0,
                ),
                most_played=None,
                best=None,
                worst=None,
            )

        total_games = 0
        total_win = 0
        total_loss = 0
        total_draw = 0

        highlights: list[schemas.UserMapHighlight] = []
        for map_, count, win, loss, draw, win_rate in rows:
            count_i = int(count)
            win_i = int(win)
            loss_i = int(loss)
            draw_i = int(draw)
            win_rate_f = float(win_rate)

            total_games += count_i
            total_win += win_i
            total_loss += loss_i
            total_draw += draw_i

            highlights.append(
                schemas.UserMapHighlight(
                    map=self.to_read(map_, all_params.entities),
                    count=count_i,
                    win=win_i,
                    loss=loss_i,
                    draw=draw_i,
                    win_rate=win_rate_f,
                )
            )

        overall_winrate = (total_win / total_games) if total_games else 0

        most_played = max(highlights, key=lambda item: (item.count, item.map.id))
        best = max(highlights, key=lambda item: (item.win_rate, item.count, item.map.id))
        worst = min(highlights, key=lambda item: (item.win_rate, -item.count, item.map.id))

        return schemas.UserMapsSummary(
            overall=schemas.UserMapsOverall(
                total_maps=total,
                total_games=total_games,
                win=total_win,
                loss=total_loss,
                draw=total_draw,
                win_rate=overall_winrate,
            ),
            most_played=most_played,
            best=best,
            worst=worst,
        )

    async def lookup(self, session: AsyncSession) -> list[schemas.LookupItem]:
        """``(id, name)`` pairs for the admin/filter pickers, name-ordered.

        Was inlined in `rpc/maps.py`; the projection itself now lives on
        `MapRepository.list_lookup`, so this only shapes the DTO.
        """
        rows = await self.repo.list_lookup(session)
        return [schemas.LookupItem(id=row.id, name=row.name) for row in rows]

    async def get_top_maps(
        self,
        session: AsyncSession,
        user_id: int,
        params: schemas.UserMapsSearchParams,
        *,
        workspace_id: int | None = None,
    ) -> tuple[typing.Sequence[tuple[models.Map, int, int, int, int, float]], int]:
        """Paginated top maps for a user as ``(map, matches, wins, losses, draws, win_rate)``
        rows plus the total map count.

        ``workspace_id`` scopes the stats to a single workspace; ``None`` spans all of them.
        """
        # Pre-resolve the user's team_id for each match via a CTE — this avoids
        # fan-out from the Player table when a user has multiple Player records
        # for the same team (e.g. starter + substitution role for different periods).
        user_match_teams = (
            sa.select(
                models.Match.id.label("match_id"),
                models.Match.map_id.label("map_id"),
                models.Match.encounter_id.label("encounter_id"),
                models.Match.home_team_id.label("home_team_id"),
                models.Match.home_score.label("home_score"),
                models.Match.away_score.label("away_score"),
                models.Team.id.label("user_team_id"),
            )
            .select_from(models.Match)
            .join(
                models.Team,
                sa.or_(
                    models.Team.id == models.Match.home_team_id,
                    models.Team.id == models.Match.away_team_id,
                ),
            )
            .join(models.Player, models.Player.team_id == models.Team.id)
            .join(models.WorkspaceMember, models.WorkspaceMember.id == models.Player.workspace_member_id)
            .where(
                sa.and_(
                    models.WorkspaceMember.player_id == user_id,
                    models.Player.is_substitution.is_(False),
                )
            )
            .distinct()
            .cte("user_match_teams")
        )

        user_home_score = sa.case(
            (user_match_teams.c.home_team_id == user_match_teams.c.user_team_id, user_match_teams.c.home_score),
            else_=user_match_teams.c.away_score,
        )
        user_away_score = sa.case(
            (user_match_teams.c.home_team_id == user_match_teams.c.user_team_id, user_match_teams.c.away_score),
            else_=user_match_teams.c.home_score,
        )
        user_win = sa.case((user_home_score > user_away_score, 1), else_=0)
        user_loss = sa.case((user_home_score < user_away_score, 1), else_=0)
        user_draw = sa.case((user_home_score == user_away_score, 1), else_=0)

        subquery_query = (
            sa.select(
                models.Map.id.label("map_id"),
                sa.func.count(user_match_teams.c.match_id).label("count"),
                sa.func.sum(user_win).label("win"),
                sa.func.sum(user_loss).label("loss"),
                sa.func.sum(user_draw).label("draw"),
                (sa.func.sum(user_win) / sa.func.count(user_match_teams.c.match_id))
                .cast(sa.Numeric(10, 2))
                .label("winrate"),
            )
            .select_from(user_match_teams)
            .join(models.Map, models.Map.id == user_match_teams.c.map_id)
            .group_by(models.Map.id)
        )

        if params.tournament_id or workspace_id:
            subquery_query = subquery_query.join(
                models.Encounter, models.Encounter.id == user_match_teams.c.encounter_id
            )

            if params.tournament_id:
                subquery_query = subquery_query.where(models.Encounter.tournament_id == params.tournament_id)

            if workspace_id:
                subquery_query = subquery_query.join(
                    models.Tournament, models.Tournament.id == models.Encounter.tournament_id
                ).where(models.Tournament.workspace_id == workspace_id)

        if params.gamemode_id:
            subquery_query = subquery_query.where(sa.and_(models.Map.gamemode_id == params.gamemode_id))

        if params.query:
            fields = params.fields if params.fields else ["name"]
            subquery_query = pagination.apply_search(models.Map, subquery_query, params.query, fields)

        if params.min_count:
            subquery_query = subquery_query.having(sa.func.count(user_match_teams.c.match_id) >= params.min_count)

        subquery = subquery_query.subquery("user_map_stats")

        total_query = sa.select(sa.func.count()).select_from(subquery)

        query = sa.select(
            models.Map,
            subquery.c.count,
            subquery.c.win,
            subquery.c.loss,
            subquery.c.draw,
            subquery.c.winrate,
        ).join(subquery, subquery.c.map_id == models.Map.id)
        if "gamemode" in params.entities:
            query = query.options(selectinload(models.Map.gamemode))

        query = params.apply_sort(query)
        if params.sort == "winrate":
            query = query.order_by(subquery.c.count.desc())
        query = query.order_by(models.Map.id.asc())
        query = params.apply_pagination(query)

        result = await session.execute(query)
        result_total = await session.execute(total_query)
        return result.all(), result_total.scalar_one()  # type: ignore


maps = MapService()
