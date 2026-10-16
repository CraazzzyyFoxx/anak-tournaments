"""Profile / dossier read queries for one user."""

import typing

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import aggregate_order_by
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.core.social import SocialProvider, normalize_social_handle
from shared.disciplines import discipline
from shared.division_grid import DivisionGrid, division_case_expr
from shared.models.stats.match import mv_entity_global_stats
from shared.repository.stats_queries import match_context, player_facts
from shared.schemas.role import RoleRef
from shared.services.division_grid.access import tournament_effective_version_id_expr
from src import models
from src.core import enums, pagination
from src.domain.encounter_seats import Seat

from ._scope import (
    _build_eligible_hero_stats_cte,
    _hero_direction_score,
    _team_load_options,
    team_has_played_encounter,
    user_entities,
)

_facts = player_facts(discipline="overwatch")
_matches = match_context(discipline="overwatch")


class UserProfileQueries:
    """Single-user reads: identity lookups, tournaments, roles and hero statistics."""

    async def get(self, session: AsyncSession, user_id: int, entities: list[str]) -> models.User | None:
        """A user by ID, with the related entities named in ``entities`` eager-loaded."""
        query = sa.select(models.User).options(*user_entities(entities)).where(sa.and_(models.User.id == user_id))
        result = await session.execute(query)
        return result.unique().scalar_one_or_none()

    async def get_all(
        self, session: AsyncSession, params: pagination.PaginationSortSearchParams
    ) -> tuple[typing.Sequence[models.User], int]:
        """Paginated users matching ``params``, plus the total match count."""
        query = sa.select(models.User).options(*user_entities(params.entities))
        total_query = sa.select(sa.func.count(sa.distinct(models.User.id)))

        if params.query:
            query = params.apply_search(query, models.User)
            total_query = params.apply_search(total_query, models.User)

        query = params.apply_pagination_sort(query, models.User)

        result = await session.execute(query)
        result_total = await session.execute(total_query)
        return result.unique().scalars().all(), result_total.scalar_one()

    async def search_by_name(
        self, session: AsyncSession, query: str, fields: list[str]
    ) -> typing.Sequence[models.SocialAccount]:
        """Search battlenet ``social_account`` rows by handle (autocomplete).

        ``fields`` is accepted for API compatibility; search is always on the unified
        ``social_account.username`` (battlenet). Returns up to 10 matches ranked by
        exact / prefix / trigram similarity.
        """
        query = query.strip().replace("-", "#")
        if not query or len(query) < 2:
            return []

        column = models.SocialAccount.username
        like_query = f"{query}%" if len(query) < 3 else f"%{query}%"
        query_lower = query.lower()

        exact_score = sa.case((sa.func.lower(column) == query_lower, 0), else_=1)
        prefix_score = sa.case((sa.func.lower(column).like(f"{query_lower}%"), 0), else_=1)
        similarity_score = sa.func.word_similarity(column, query)

        conditions = [column.ilike(like_query)]
        if len(query) >= 3:
            conditions.append(column.op("%")(query))

        stmt = (
            sa.select(models.SocialAccount)
            .where(
                models.SocialAccount.provider == SocialProvider.BATTLENET,
                sa.or_(*conditions),
                # Accounts hidden from the public profile (no global visibility row)
                # must not surface in search either.
                sa.select(models.SocialAccountVisibility.id)
                .where(
                    models.SocialAccountVisibility.account_id == models.SocialAccount.id,
                    models.SocialAccountVisibility.workspace_id.is_(None),
                )
                .exists(),
            )
            .order_by(
                exact_score.asc(),
                prefix_score.asc(),
                similarity_score.desc(),
                column.asc(),
            )
            .limit(10)
        )
        result = await session.scalars(stmt)
        return result.unique().all()

    async def find_by_battle_tag(
        self, session: AsyncSession, battle_tag: str, entities: list[str]
    ) -> models.User | None:
        """A user by battle tag, with ``entities`` eager-loaded.

        Matches on the normalized handle (``-`` folded to ``#``) or on the in-game name
        part before ``#``, case-insensitively.
        """
        normalized_battle_tag = battle_tag.strip().replace("-", "#")
        if not normalized_battle_tag:
            return None

        battle_tag_lower = normalized_battle_tag.lower()
        exact_user_name_match = sa.func.lower(models.User.name) == battle_tag_lower
        # Battlenet identity now lives in players.social_account; match the full
        # normalized handle or the in-game name part (before ``#``), case-insensitive.
        bnet_name_part = sa.func.lower(sa.func.split_part(models.SocialAccount.username, "#", 1))

        query = (
            sa.select(models.User)
            .options(*user_entities(entities))
            .outerjoin(
                models.SocialAccount,
                sa.and_(
                    models.User.id == models.SocialAccount.user_id,
                    models.SocialAccount.provider == SocialProvider.BATTLENET,
                ),
            )
            .where(
                sa.or_(
                    exact_user_name_match,
                    models.SocialAccount.username_normalized
                    == normalize_social_handle(SocialProvider.BATTLENET, normalized_battle_tag),
                    bnet_name_part == battle_tag_lower,
                )
            )
            .order_by(
                sa.case((exact_user_name_match, 0), else_=1),
                models.User.id.asc(),
            )
            .limit(1)
        )
        result = await session.execute(query)
        return result.unique().scalar_one_or_none()

    async def get_by_discord(self, session: AsyncSession, discord: str, entities: list[str]) -> models.User | None:
        """A user by Discord handle, with ``entities`` eager-loaded."""
        query = (
            sa.select(models.User)
            .options(*user_entities(entities))
            .join(models.SocialAccount, models.User.id == models.SocialAccount.user_id)
            .where(
                models.SocialAccount.provider == SocialProvider.DISCORD,
                models.SocialAccount.username_normalized == normalize_social_handle(SocialProvider.DISCORD, discord),
            )
        )
        result = await session.scalars(query)
        return result.unique().first()

    async def get_overall_statistics(
        self, session: AsyncSession, user_id: int, workspace_id: int | None = None
    ) -> tuple[int, int, int]:
        """A user's ``(maps won, maps lost, average encounter closeness)`` across all
        tournaments, or the workspace's tournaments when ``workspace_id`` is given.
        """

        seat = Seat()

        q = (
            sa.select(
                models.WorkspaceMember.player_id.label("user_id"),
                seat.maps_won.label("maps_won"),
                seat.maps_lost.label("maps_lost"),
                models.Encounter.closeness.label("closeness"),
            )
            .select_from(models.Player)
            .join(models.Team, models.Team.id == models.Player.team_id)
            .join(models.WorkspaceMember, models.WorkspaceMember.id == models.Player.workspace_member_id)
            .where(
                models.Player.is_substitution.is_(False),
                models.WorkspaceMember.player_id == user_id,
            )
        )
        q = seat.join(q, models.Team.id)
        if workspace_id is not None:
            q = q.join(models.Tournament, models.Encounter.tournament_id == models.Tournament.id).where(
                models.Tournament.workspace_id == workspace_id
            )
        sides = q.subquery("profile_map_sides")
        query = (
            sa.select(
                sa.func.sum(sides.c.maps_won).label("won_maps"),
                sa.func.sum(sides.c.maps_lost).label("lost_maps"),
                sa.func.avg(sides.c.closeness).label("closeness"),
            )
            .select_from(sides)
            .group_by(sides.c.user_id)
        )
        matches = await session.execute(query)
        return matches.first()

    async def get_teams(
        self,
        session: AsyncSession,
        user_id: int,
        params: pagination.PaginationSortParams,
        workspace_id: int | None = None,
    ) -> tuple[typing.Sequence[models.Team], int]:
        """Paginated teams a user has played for, plus the total count.

        Scoped exactly like ``get_tournaments_with_stats`` (which powers the
        Tournaments tab): a tournament belongs to a user's history as soon as the
        user has played an encounter in it, not once ``is_finished`` flips. Gating on
        ``is_finished`` left the profile of a player whose only event is the live one
        completely empty even though every other read (maps, heroes, roles,
        encounters) already counted it. Hidden tournaments (issue #115) never appear.
        """
        played_encounter = team_has_played_encounter()
        scope = (
            models.WorkspaceMember.player_id == user_id,
            models.Player.is_substitution.is_(False),
            models.Tournament.is_hidden.is_(False),
            played_encounter,
        )

        total_query = (
            sa.select(sa.func.count(sa.distinct(models.Team.id)))
            .join(models.Player, models.Player.team_id == models.Team.id)
            .join(models.Tournament, models.Tournament.id == models.Team.tournament_id)
            .join(models.WorkspaceMember, models.WorkspaceMember.id == models.Player.workspace_member_id)
            .where(sa.and_(*scope))
        )

        query = (
            sa.select(models.Team)
            .options(*_team_load_options(params.entities))
            .join(models.Player, models.Player.team_id == models.Team.id)
            .join(models.Tournament, models.Tournament.id == models.Team.tournament_id)
            .join(models.WorkspaceMember, models.WorkspaceMember.id == models.Player.workspace_member_id)
            .where(sa.and_(*scope))
        )
        if workspace_id is not None:
            total_query = total_query.where(models.Tournament.workspace_id == workspace_id)
            query = query.where(models.Tournament.workspace_id == workspace_id)

        query = params.apply_pagination_sort(query, models.Team)
        result = await session.scalars(query)
        teams = result.unique().all()
        if params.per_page == -1:
            return teams, len(teams)
        result_total = await session.execute(total_query)
        return teams, result_total.scalar_one()

    async def get_roles(
        self, session: AsyncSession, user_id: int, workspace_id: int | None = None
    ) -> typing.Sequence[tuple[RoleRef | None, int, int, list[dict]]]:
        """Per-role ``(role, maps won, maps lost, tournament entries)`` rows for a user.

        Each tournament entry is a dict of ``tournament``, ``rank`` and
        ``division_grid_version_id`` — the tournament's *effective* grid version
        (own pin, else its workspace default, else the system default). The rank
        is raw, so the caller resolves the division against the grid version that
        tournament was actually played on.
        """

        seat = Seat()

        q = (
            sa.select(
                models.Player.role,
                models.Tournament.discipline,
                models.Player.sub_role,
                seat.maps_won.label("maps_won"),
                seat.maps_lost.label("maps_lost"),
                models.Team.tournament_id.label("tournament_id"),
                models.Player.rank.label("rank"),
                tournament_effective_version_id_expr(models.Team.tournament_id).label("division_grid_version_id"),
            )
            .join(models.Team, models.Team.id == models.Player.team_id)
            .join(models.Tournament, models.Tournament.id == models.Team.tournament_id)
            .join(models.WorkspaceMember, models.WorkspaceMember.id == models.Player.workspace_member_id)
            .where(
                models.Player.is_substitution.is_(False),
                models.WorkspaceMember.player_id == user_id,
            )
        )
        q = seat.join(q, models.Team.id)
        if workspace_id is not None:
            q = q.where(models.Tournament.workspace_id == workspace_id)
        sides = q.subquery("profile_role_sides")
        query = (
            sa.select(
                sides.c.role,
                sides.c.discipline,
                sides.c.sub_role,
                sa.func.sum(sides.c.maps_won).label("won_maps"),
                sa.func.sum(sides.c.maps_lost).label("lost_maps"),
                sa.func.jsonb_agg(
                    sa.func.jsonb_build_object(
                        "tournament",
                        sides.c.tournament_id,
                        "rank",
                        sides.c.rank,
                        "division_grid_version_id",
                        sides.c.division_grid_version_id,
                    )
                ),
            )
            .select_from(sides)
            .group_by(sides.c.role, sides.c.discipline, sides.c.sub_role)
        )
        result = await session.execute(query)
        return [
            (RoleRef.of(discipline(code).rated_dimension.code, role, sub_role), won, lost, entries)
            for role, code, sub_role, won, lost, entries in result.all()
        ]

    async def get_tournament_role(
        self, session: AsyncSession, tournament: models.Tournament, user_id: int, *, grid: DivisionGrid
    ) -> tuple[RoleRef | None, int]:
        """A user's ``(role, division)`` in one tournament — the division already resolved
        against ``grid``, not the raw rank.
        """
        query = (
            sa.select(
                models.Player.role, models.Player.sub_role, division_case_expr(models.Player.rank, grid).label("div")
            )
            .select_from(models.Player)
            .join(models.Team, models.Team.id == models.Player.team_id)
            .join(models.WorkspaceMember, models.WorkspaceMember.id == models.Player.workspace_member_id)
            .where(
                sa.and_(
                    models.Team.tournament_id == tournament.id,
                    models.WorkspaceMember.player_id == user_id,
                    models.Player.is_substitution.is_(False),
                )
            )
        )
        result_role = await session.execute(query)
        role, sub_role, division = result_role.one()
        return RoleRef.of(discipline(tournament.discipline).rated_dimension.code, role, sub_role), division

    async def get_tournaments_with_stats(
        self,
        session: AsyncSession,
        user_id: int,
        workspace_id: int | None = None,
    ) -> typing.Sequence[tuple[models.Team, int, int, int]]:
        """A user's tournament history as ``(team, maps won, maps lost, average encounter
        closeness)`` rows.
        """

        seat = Seat()

        q = (
            sa.select(
                models.Team.id.label("team_id"),
                seat.maps_won.label("maps_won"),
                seat.maps_lost.label("maps_lost"),
                models.Encounter.closeness.label("closeness"),
            )
            .select_from(models.Player)
            .join(models.Team, models.Team.id == models.Player.team_id)
            .join(models.Tournament, models.Tournament.id == models.Team.tournament_id)
            .join(models.WorkspaceMember, models.WorkspaceMember.id == models.Player.workspace_member_id)
            .where(
                models.WorkspaceMember.player_id == user_id,
                models.Player.is_substitution.is_(False),
                # Hidden tournaments (issue #115) never appear in a user's public
                # tournament list. This read is cashews-cached without the viewer,
                # so exclude unconditionally; admins/allowlisted view hidden
                # tournaments through the gated tournament pages instead.
                models.Tournament.is_hidden.is_(False),
            )
        )
        q = seat.join(q, models.Team.id)
        if workspace_id is not None:
            q = q.where(models.Tournament.workspace_id == workspace_id)
        sides = q.subquery("profile_tournament_sides")
        agg = (
            sa.select(
                sides.c.team_id,
                sa.func.sum(sides.c.maps_won).label("won_maps"),
                sa.func.sum(sides.c.maps_lost).label("lost_maps"),
                sa.func.avg(sides.c.closeness).label("closeness"),
            )
            .group_by(sides.c.team_id)
            .subquery("profile_tournament_stats")
        )
        query = (
            sa.select(
                models.Team,
                agg.c.won_maps,
                agg.c.lost_maps,
                agg.c.closeness,
            )
            .options(
                selectinload(models.Team.players).selectinload(models.Player.workspace_member),
                selectinload(models.Team.tournament).selectinload(models.Tournament.standings),
                selectinload(models.Team.tournament).selectinload(models.Tournament.division_grid_version),
                selectinload(models.Team.standings).selectinload(models.Standing.stage_item),
            )
            .join(agg, agg.c.team_id == models.Team.id)
            .join(models.Tournament, models.Tournament.id == models.Team.tournament_id)
            # Newest event first; undated (legacy) tournaments last, by id.
            .order_by(models.Tournament.start_date.desc().nulls_last(), models.Tournament.id.desc())
        )

        result = await session.execute(query)
        return result.unique().all()

    async def get_tournament_stats_overall(
        self, session: AsyncSession, tournament: models.Tournament, user_id: int
    ) -> tuple[int, int, int, float]:
        """A user's totals for one tournament: ``(maps won, maps lost, average encounter
        closeness, total playtime in seconds)``.
        """

        seat = Seat(name="playtime_seat")
        playtime_query = (
            sa.select(_facts.c.value, _facts.c.match_id, _facts.c.workspace_member_id)
            .select_from(models.Player)
            .join(models.Team, models.Team.id == models.Player.team_id)
            .join(models.WorkspaceMember, models.WorkspaceMember.id == models.Player.workspace_member_id)
            .where(
                models.WorkspaceMember.player_id == user_id,
                models.Player.is_substitution.is_(False),
                models.Team.tournament_id == tournament.id,
                _facts.c.player_id == models.WorkspaceMember.player_id,
                _facts.c.stat_code == enums.LogStatsName.HeroTimePlayed,
                _facts.c.entity_id.is_(None),
                _facts.c.segment == 0,
            )
        )
        playtime_query = (
            seat.join(playtime_query, models.Team.id, duel=False)
            .join(_matches, _matches.c.encounter_id == models.Encounter.id)
            .join(_facts, _facts.c.match_id == _matches.c.id)
        )
        playtime_rows = playtime_query.subquery("profile_playtime_sides")
        playtime_subquery = sa.select(
            sa.func.sum(
                aggregate_order_by(
                    playtime_rows.c.value,
                    playtime_rows.c.match_id,
                    playtime_rows.c.workspace_member_id,
                )
            )
        ).scalar_subquery()

        maps_seat = Seat(name="maps_seat")
        maps_query = (
            sa.select(
                maps_seat.maps_won.label("maps_won"),
                maps_seat.maps_lost.label("maps_lost"),
                models.Encounter.closeness.label("closeness"),
            )
            .select_from(models.Player)
            .join(models.Team, models.Team.id == models.Player.team_id)
            .join(models.WorkspaceMember, models.WorkspaceMember.id == models.Player.workspace_member_id)
            .where(
                models.WorkspaceMember.player_id == user_id,
                models.Player.is_substitution.is_(False),
                models.Team.tournament_id == tournament.id,
            )
        )
        map_sides = maps_seat.join(maps_query, models.Team.id).subquery("profile_tournament_map_sides")
        query = sa.select(
            sa.func.coalesce(sa.func.sum(map_sides.c.maps_won), 0).label("won_maps"),
            sa.func.coalesce(sa.func.sum(map_sides.c.maps_lost), 0).label("lost_maps"),
            sa.func.coalesce(sa.func.avg(map_sides.c.closeness), 0).label("closeness"),
            sa.func.coalesce(playtime_subquery, 0).label("playtime"),
        ).select_from(map_sides)
        result = await session.execute(query)
        row = result.one_or_none()
        if not row:
            return 0, 0, 0, 0

        won_maps, lost_maps, closeness, playtime = row
        return won_maps, lost_maps, closeness, playtime

    def _statistics_by_heroes_query(
        self,
        *,
        user_id: int,
        stats: list[enums.LogStatsName] | None,
        tournament_id: int | None,
        workspace_id: int | None,
    ) -> sa.Select:
        """Build the per-(hero, stat) totals + best-performance query for one user.

        Rank the slim eligible native facts before hydrating the winning row's
        map and tournament metadata; match duration remains the per-10 denominator.
        """
        eligible_stats = _build_eligible_hero_stats_cte(
            user_id=user_id,
            stats=stats,
            cte_name="eligible_user_hero_stats",
            tournament_id=tournament_id,
            workspace_id=workspace_id,
        )
        direction_score = _hero_direction_score(eligible_stats.c.value, eligible_stats.c.stat_code)

        # One match duration per eligible stat row, not character playtime.
        # Match/member order is the native MV contract; never depend on heap/group-sort ties.
        reduction_order = (eligible_stats.c.match_id, eligible_stats.c.workspace_member_id)
        agg_cte = (
            sa.select(
                eligible_stats.c.entity_id,
                eligible_stats.c.stat_code,
                sa.func.sum(aggregate_order_by(eligible_stats.c.value, *reduction_order)).label("total_value"),
                sa.func.sum(aggregate_order_by(_matches.c.duration_s, *reduction_order)).label("total_time"),
            )
            .select_from(eligible_stats)
            .join(_matches, _matches.c.id == eligible_stats.c.match_id)
            .group_by(eligible_stats.c.entity_id, eligible_stats.c.stat_code)
            .cte("hero_stats_agg")
        )

        # Best-value ties prefer the newer match id.
        ranked_cte = (
            sa.select(
                eligible_stats.c.entity_id,
                eligible_stats.c.stat_code,
                eligible_stats.c.match_id,
                eligible_stats.c.value,
                sa.func.row_number()
                .over(
                    partition_by=[
                        eligible_stats.c.entity_id,
                        eligible_stats.c.stat_code,
                    ],
                    order_by=[direction_score.desc(), eligible_stats.c.match_id.desc()],
                )
                .label("row_num"),
            )
            .select_from(eligible_stats)
            .cte("hero_stats_ranked")
        )

        # Hydrate map/tournament metadata only for the winning row per (hero, stat).
        best_result_cte = (
            sa.select(
                ranked_cte.c.entity_id,
                ranked_cte.c.stat_code,
                ranked_cte.c.value.label("best_value"),
                _matches.c.encounter_id,
                models.CatalogEntity.name.label("map_name"),
                models.CatalogEntity.image_path.label("map_link"),
                models.Tournament.name.label("tournament_name"),
            )
            .select_from(ranked_cte)
            .join(_matches, _matches.c.id == ranked_cte.c.match_id)
            .join(
                models.CatalogEntity,
                sa.and_(
                    models.CatalogEntity.id == _matches.c.map_entity_id,
                    models.CatalogEntity.kind == "map",
                    models.CatalogEntity.discipline == "overwatch",
                ),
            )
            .join(models.Encounter, models.Encounter.id == _matches.c.encounter_id)
            .join(models.Tournament, models.Tournament.id == models.Encounter.tournament_id)
            .where(ranked_cte.c.row_num == 1)
            .cte("best_result_cte")
        )

        return (
            sa.select(
                agg_cte.c.stat_code,
                models.CatalogEntity,
                agg_cte.c.total_value.label("total_value"),
                best_result_cte.c.best_value.label("best_value"),
                (agg_cte.c.total_value / sa.func.nullif(agg_cte.c.total_time, 0) * 600).label("avg_per_10min"),
                sa.func.jsonb_build_object(
                    "encounter_id",
                    best_result_cte.c.encounter_id,
                    "map_name",
                    best_result_cte.c.map_name,
                    "map_image_path",
                    best_result_cte.c.map_link,
                    "tournament_name",
                    best_result_cte.c.tournament_name,
                ).label("best_metadata"),
            )
            .select_from(agg_cte)
            .join(models.CatalogEntity, models.CatalogEntity.id == agg_cte.c.entity_id)
            .join(
                best_result_cte,
                sa.and_(
                    best_result_cte.c.entity_id == agg_cte.c.entity_id,
                    best_result_cte.c.stat_code == agg_cte.c.stat_code,
                ),
            )
            .where(models.CatalogEntity.kind == "character", models.CatalogEntity.discipline == "overwatch")
        )

    async def get_statistics_by_heroes(
        self,
        session: AsyncSession,
        user_id: int,
        stats: list[enums.LogStatsName] | None = None,
        tournament_id: int | None = None,
        workspace_id: int | None = None,
    ) -> typing.Sequence[tuple[enums.LogStatsName, models.CatalogEntity, float, float, float, dict]]:
        """A user's hero statistics as ``(stat name, hero, total, best value, per-10-minute
        average, best-performance metadata)`` rows.

        The metadata dict carries the encounter id, map name, map image path and
        tournament name of the best result.
        """
        query = self._statistics_by_heroes_query(
            user_id=user_id,
            stats=stats,
            tournament_id=tournament_id,
            workspace_id=workspace_id,
        )
        result = await session.execute(query)
        return [(enums.LogStatsName(code), *values) for code, *values in result.all()]

    def _read_hero_global_stats_query(self, stats: list[enums.LogStatsName] | None) -> sa.Select:
        """Global OW records from the native MV; workspace reads use scoped facts."""
        mv = mv_entity_global_stats
        query = (
            sa.select(
                models.StatDef.code,
                mv.c.entity_id,
                mv.c.best_value,
                mv.c["avg"],
                mv.c["metadata"],
            )
            .select_from(mv)
            .join(
                models.StatDef,
                sa.and_(
                    models.StatDef.id == mv.c.stat_id,
                    models.StatDef.discipline == mv.c.discipline,
                ),
            )
            .where(mv.c.discipline == "overwatch")
        )
        if stats:
            query = query.where(models.StatDef.code.in_([stat.value for stat in stats]))
        return query.order_by(mv.c.entity_id)

    async def get_statistics_by_heroes_all_values(
        self,
        session: AsyncSession,
        stats: list[enums.LogStatsName] | None = None,
    ) -> typing.Sequence[tuple[enums.LogStatsName, int, float, float, dict]]:
        """Best value (+ metadata) and global per-10min average for every (hero, stat).

        An unpopulated native MV is an operational error, not an empty result.
        ``stats=None`` reads every OW stat; a non-empty list narrows the view scan.
        """
        result = await session.execute(self._read_hero_global_stats_query(stats))
        return [(enums.LogStatsName(code), *values) for code, *values in result.all()]

    async def get_best_teammates(
        self,
        session: AsyncSession,
        user_id: int,
        params: pagination.PaginationSortParams,
        workspace_id: int | None = None,
    ) -> tuple[typing.Sequence[tuple[models.User, float, int, int, float | None, float | None]], int]:
        """A user's best teammates as ``(teammate, win rate together, tournaments together,
        distinct maps together, average performance, average KDA)`` rows, plus the total count.
        """
        self_player = sa.orm.aliased(models.Player, name="self_player")
        teammate_player = sa.orm.aliased(models.Player, name="teammate_player")
        self_member = sa.orm.aliased(models.WorkspaceMember, name="self_member")
        teammate_member = sa.orm.aliased(models.WorkspaceMember, name="teammate_member")

        shared_teams_select = (
            sa.select(
                teammate_member.player_id.label("teammate_id"),
                teammate_player.team_id.label("team_id"),
                teammate_player.tournament_id.label("tournament_id"),
            )
            .select_from(self_player)
            .join(teammate_player, teammate_player.team_id == self_player.team_id)
            .join(self_member, self_member.id == self_player.workspace_member_id)
            .join(teammate_member, teammate_member.id == teammate_player.workspace_member_id)
            .where(
                self_member.player_id == user_id,
                self_player.is_substitution.is_(False),
                teammate_player.is_substitution.is_(False),
                teammate_member.player_id != user_id,
            )
            .distinct()
        )

        if workspace_id is not None:
            shared_teams_select = shared_teams_select.join(
                models.Tournament, models.Tournament.id == self_player.tournament_id
            ).where(models.Tournament.workspace_id == workspace_id)

        shared_teams = shared_teams_select.cte("shared_teams")

        encounter_seat = Seat(name="teammate_seat")
        teammate_encounters = encounter_seat.join(
            sa.select(
                shared_teams.c.teammate_id.label("teammate_id"),
                models.Encounter.tournament_id.label("tournament_id"),
                encounter_seat.maps_won.label("won_score"),
                encounter_seat.maps_lost.label("lost_score"),
            ).select_from(shared_teams),
            shared_teams.c.team_id,
        ).cte("teammate_encounters")

        teammates_query = (
            sa.select(
                teammate_encounters.c.teammate_id.label("user_id"),
                (
                    sa.func.sum(teammate_encounters.c.won_score)
                    / sa.func.nullif(
                        sa.func.sum(teammate_encounters.c.won_score + teammate_encounters.c.lost_score),
                        0,
                    )
                ).label("winrate"),
                sa.func.count(sa.distinct(teammate_encounters.c.tournament_id)).label("tournaments"),
            )
            .group_by(teammate_encounters.c.teammate_id)
            .having(sa.func.count(sa.distinct(teammate_encounters.c.tournament_id)) > 1)
        ).cte("teammates_query")

        # Teammate "MVP" column spans two LogStatsName columns: ImpactRank when the
        # impact-scoring pipeline computed it for a match, legacy Performance
        # otherwise — same COALESCE(ImpactRank, Performance) per-match average as
        # services.user.queries.encounters.get_roster_avg_mvp_bulk. First collapse each
        # match's rows into one (impact_rank, performance, kda) tuple via an
        # outer join (keeps a teammate with zero stat rows in the result with
        # NULLs, matching the prior behaviour), THEN average per teammate.
        stats_per_match = (
            sa.select(
                shared_teams.c.teammate_id.label("user_id"),
                _facts.c.match_id.label("match_id"),
                sa.func.max(sa.case((_facts.c.stat_code == enums.LogStatsName.ImpactRank, _facts.c.value))).label(
                    "impact_rank"
                ),
                sa.func.max(sa.case((_facts.c.stat_code == enums.LogStatsName.Performance, _facts.c.value))).label(
                    "performance"
                ),
                sa.func.max(sa.case((_facts.c.stat_code == enums.LogStatsName.KDA, _facts.c.value))).label("kda"),
            )
            .select_from(shared_teams)
            .join(teammates_query, teammates_query.c.user_id == shared_teams.c.teammate_id)
            .outerjoin(
                _facts,
                sa.and_(
                    _facts.c.tournament_team_id == shared_teams.c.team_id,
                    _facts.c.player_id == shared_teams.c.teammate_id,
                    _facts.c.segment == 0,
                    _facts.c.entity_id.is_(None),
                    _facts.c.stat_code.in_(
                        [
                            enums.LogStatsName.ImpactRank,
                            enums.LogStatsName.Performance,
                            enums.LogStatsName.KDA,
                        ]
                    ),
                ),
            )
            .group_by(shared_teams.c.teammate_id, _facts.c.match_id)
        ).cte("teammate_stats_per_match")

        mvp_placement = sa.func.coalesce(stats_per_match.c.impact_rank, stats_per_match.c.performance)
        stats_query = (
            sa.select(
                stats_per_match.c.user_id,
                sa.func.avg(aggregate_order_by(mvp_placement, stats_per_match.c.match_id)).label("performance"),
                sa.func.avg(aggregate_order_by(stats_per_match.c.kda, stats_per_match.c.match_id)).label("kda"),
            ).group_by(stats_per_match.c.user_id)
        ).cte("stats_query")

        # Distinct maps played together (separate CTE so the encounter→match fan-out
        # does not skew the winrate/tournament aggregates in teammates_query).
        map_seat = Seat(name="teammate_map_seat")
        map_sides = (
            map_seat.join(
                sa.select(
                    shared_teams.c.teammate_id.label("user_id"),
                    _matches.c.map_entity_id.label("map_id"),
                )
                .select_from(shared_teams)
                .join(teammates_query, teammates_query.c.user_id == shared_teams.c.teammate_id),
                shared_teams.c.team_id,
                duel=False,
            )
            .outerjoin(_matches, _matches.c.encounter_id == models.Encounter.id)
            .subquery("teammate_map_sides")
        )
        maps_query = (
            sa.select(
                map_sides.c.user_id,
                sa.func.count(sa.distinct(map_sides.c.map_id)).label("maps"),
            ).group_by(map_sides.c.user_id)
        ).cte("maps_query")

        count_query = sa.select(sa.func.count(teammates_query.c.user_id))

        query = (
            sa.select(
                models.User,
                teammates_query.c.winrate,
                teammates_query.c.tournaments,
                maps_query.c.maps,
                stats_query.c.performance,
                stats_query.c.kda,
            )
            .select_from(teammates_query)
            .join(models.User, models.User.id == teammates_query.c.user_id)
            .join(stats_query, stats_query.c.user_id == teammates_query.c.user_id)
            .join(maps_query, maps_query.c.user_id == teammates_query.c.user_id)
        )

        query = params.apply_pagination_sort(query)
        result = await session.execute(query)
        count_result = await session.execute(count_query)
        return result.all(), count_result.scalar_one()  # type: ignore


profile = UserProfileQueries()
