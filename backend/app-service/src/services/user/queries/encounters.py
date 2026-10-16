"""Encounter / roster queries for the user Matches and Tournaments tabs.

These queries used to live in ``services._internal.encounter.service`` and
``services._internal.team.service``. After P3-A they are private to
``services/user/`` — the only consumer.
"""

from __future__ import annotations

import typing

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import aggregate_order_by
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from shared.models.catalog.role import leaf_code
from shared.repository.stats_queries import match_context, player_facts
from shared.repository.stats_reads import MatchReadContext, duel_matches, get_match_reads
from shared.schemas.role import RoleRef
from src import models
from src.core import enums, pagination
from src.core.workspace import workspace_filter
from src.domain.encounter_seats import Seat
from src.services.user import _mappers

_facts = player_facts(discipline="overwatch")
_matches = match_context(discipline="overwatch")
_duels = duel_matches(discipline="overwatch")

_LAST_MATCH_AT = (
    sa.select(sa.func.max(_matches.c.created_at))
    .where(_matches.c.encounter_id == models.Encounter.id)
    .correlate(models.Encounter)
    .scalar_subquery()
)
_PLAYED_AT = sa.func.coalesce(
    models.Encounter.ended_at,
    models.Encounter.confirmed_at,
    models.Encounter.started_at,
    _LAST_MATCH_AT,
    models.Encounter.created_at,
)


_HERO_JSON = sa.func.jsonb_build_object(
    "id",
    models.CatalogEntity.id,
    "created_at",
    models.CatalogEntity.created_at,
    "updated_at",
    models.CatalogEntity.updated_at,
    "name",
    models.CatalogEntity.name,
    "slug",
    models.CatalogEntity.slug,
    "image_path",
    sa.func.coalesce(models.CatalogEntity.image_path, ""),
    "color",
    sa.func.coalesce(models.CatalogEntity.attrs["color"].astext, "#ffffff"),
    "type",
    models.CatalogEntity.attrs["class"].astext,
)


def _team_encounter_match_identity(
    row: typing.Sequence[typing.Any],
) -> tuple[int | None, int, int | None]:
    team, encounter, match_id, *_ = row
    return team.id if team is not None else None, encounter.id, match_id


def _encounter_match_identity(
    row: typing.Sequence[typing.Any],
) -> tuple[int, int | None]:
    encounter, match_id, *_ = row
    return encounter.id, match_id


def _user_player_where(user_id: int):
    return (
        models.Player.workspace_member.has(models.WorkspaceMember.player_id == user_id),
        models.Player.is_substitution.is_(False),
    )


def _user_history_seats(user_id: int) -> sa.CompoundSelect:
    """Current roster seats plus observed participations, including retired history."""
    live = (
        sa.select(models.EncounterTeam.id)
        .join(models.Player, models.Player.team_id == models.EncounterTeam.team_id)
        .where(models.EncounterTeam.active.is_(True), *_user_player_where(user_id))
    )
    observed = (
        sa.select(models.EncounterTeam.id)
        .select_from(models.StatsMatchPlayer)
        .join(_matches, _matches.c.id == models.StatsMatchPlayer.match_id)
        .join(
            models.EncounterTeam,
            sa.and_(
                models.EncounterTeam.id == models.StatsMatchPlayer.encounter_team_id,
                models.EncounterTeam.encounter_id == _matches.c.encounter_id,
            ),
        )
        .join(
            models.WorkspaceMember,
            sa.and_(
                models.WorkspaceMember.id == models.StatsMatchPlayer.workspace_member_id,
                models.WorkspaceMember.workspace_id == _matches.c.workspace_id,
            ),
        )
        .where(models.WorkspaceMember.player_id == user_id)
    )
    return live.union(observed)


class UserEncounterQueries:
    """Encounter, opponent and roster aggregate reads for one user."""

    async def get_user_encounter_matches_unpaginated(
        self, session: AsyncSession, user_id: int, *, tournament_id: int | None = None
    ) -> typing.Sequence[
        tuple[
            models.Team | None,
            models.Encounter,
            MatchReadContext | None,
            int | None,
            list[dict] | None,
            int | None,
            float | None,
            float | None,
            int | None,
        ]
    ]:
        """All (team, encounter, match) rows the user participated in.

        Used to assemble the Tournaments-tab dossier's per-tournament encounter
        list (`services.user.service.get_tournament_encounters`). `tournament_id`,
        when given, scopes the rows to one tournament — the flow calls this
        lazily per selected dossier entry rather than pulling the user's entire
        encounter history up front. Loads:
          - Match.map — for `MatchReadWithUserStats.map`
          - Encounter.tournament; the live seats, their roster snapshots and the
            bracket position come from :meth:`get_encounter_contexts`

        Row shape: (team, encounter, match, performance, heroes, impact_rank,
        impact_points, overperformance_score, overperf_pos). ``overperf_pos`` is
        the viewer's rank (1 = best) among all match participants by
        OverperformanceScore, used to compute the MVP-impact badge.
        """
        performance_cte = (
            sa.select(
                _facts.c.match_id.label("match_id"),
                _facts.c.value.label("value"),
            )
            .where(
                sa.and_(
                    _facts.c.match_id == _matches.c.id,
                    _facts.c.player_id == user_id,
                    _facts.c.stat_code == enums.LogStatsName.Performance,
                    _facts.c.entity_id.is_(None),
                    _facts.c.segment == 0,
                )
            )
            .cte("performance_cte")
        )

        impact_rank_cte = (
            sa.select(
                _facts.c.match_id.label("match_id"),
                _facts.c.value.label("value"),
            )
            .where(
                sa.and_(
                    _facts.c.match_id == _matches.c.id,
                    _facts.c.player_id == user_id,
                    _facts.c.stat_code == enums.LogStatsName.ImpactRank,
                    _facts.c.entity_id.is_(None),
                    _facts.c.segment == 0,
                )
            )
            .cte("impact_rank_cte")
        )

        impact_points_cte = (
            sa.select(
                _facts.c.match_id.label("match_id"),
                _facts.c.value.label("value"),
            )
            .where(
                sa.and_(
                    _facts.c.match_id == _matches.c.id,
                    _facts.c.player_id == user_id,
                    _facts.c.stat_code == enums.LogStatsName.ImpactPoints,
                    _facts.c.entity_id.is_(None),
                    _facts.c.segment == 0,
                )
            )
            .cte("impact_points_cte")
        )

        overperf_cte = (
            sa.select(
                _facts.c.match_id.label("match_id"),
                _facts.c.player_id.label("user_id"),
                _facts.c.value.label("value"),
                sa.func.rank()
                .over(
                    partition_by=_facts.c.match_id,
                    order_by=_facts.c.value.desc(),
                )
                .label("pos"),
            )
            .where(
                sa.and_(
                    _facts.c.stat_code == enums.LogStatsName.OverperformanceScore,
                    _facts.c.entity_id.is_(None),
                    _facts.c.segment == 0,
                )
            )
            .cte("overperf_cte")
        )

        heroes_cte = (
            sa.select(
                _facts.c.match_id.label("match_id"),
                sa.func.jsonb_agg(aggregate_order_by(_HERO_JSON, _facts.c.entity_id)).label("value"),
            )
            .select_from(_facts)
            .join(models.CatalogEntity, _facts.c.entity_id == models.CatalogEntity.id)
            .where(
                sa.and_(
                    models.CatalogEntity.kind == "character",
                    models.CatalogEntity.discipline == "overwatch",
                    _facts.c.match_id == _matches.c.id,
                    _facts.c.stat_code == enums.LogStatsName.HeroTimePlayed,
                    _facts.c.player_id == user_id,
                    _facts.c.entity_id.isnot(None),
                    _facts.c.value > 60,
                    _facts.c.segment == 0,
                )
            )
            .group_by(_facts.c.match_id)
            .cte("heroes_cte")
        )

        seat = Seat()
        query = (
            sa.select(
                models.Team,
                models.Encounter,
                _matches.c.id,
                performance_cte.c.value.label("performance"),
                heroes_cte.c.value.label("heroes"),
                impact_rank_cte.c.value.label("impact_rank"),
                impact_points_cte.c.value.label("impact_points"),
                overperf_cte.c.value.label("overperformance_score"),
                overperf_cte.c.pos.label("overperf_pos"),
            )
            .select_from(seat.team)
            .options(
                joinedload(models.Encounter.tournament),
            )
            .join(models.Encounter, models.Encounter.id == seat.team.encounter_id)
            .outerjoin(models.Team, models.Team.id == seat.team.team_id)
            .where(seat.team.id.in_(_user_history_seats(user_id)))
        )
        query = (
            query.join(_matches, models.Encounter.id == _matches.c.encounter_id, isouter=True)
            .outerjoin(performance_cte, performance_cte.c.match_id == _matches.c.id)
            .outerjoin(heroes_cte, heroes_cte.c.match_id == _matches.c.id)
            .outerjoin(impact_rank_cte, impact_rank_cte.c.match_id == _matches.c.id)
            .outerjoin(impact_points_cte, impact_points_cte.c.match_id == _matches.c.id)
            .outerjoin(
                overperf_cte,
                sa.and_(overperf_cte.c.match_id == _matches.c.id, overperf_cte.c.user_id == user_id),
            )
            .where(*([models.Encounter.tournament_id == tournament_id] if tournament_id is not None else []))
            .order_by(
                _PLAYED_AT.asc(),
                models.Encounter.id.asc(),
                _matches.c.position.asc().nulls_last(),
                _matches.c.id.asc(),
            )
        )

        result = await session.execute(query)
        rows = result.unique(_team_encounter_match_identity).all()
        reads = await get_match_reads(session, match_ids=[row[2] for row in rows if row[2] is not None])
        return [
            (team, encounter, reads[match_id] if match_id is not None else None, *stats)
            for team, encounter, match_id, *stats in rows
        ]

    async def get_user_encounters_paginated(
        self,
        session: AsyncSession,
        user_id: int,
        params: pagination.PaginationSortParams,
        workspace_id: int | None = None,
        *,
        result: str | None = None,
        stage: str | None = None,
        mvp1: bool = False,
        has_logs: bool | None = None,
        opponent: str | None = None,
    ) -> tuple[
        typing.Sequence[
            tuple[
                models.Encounter,
                MatchReadContext | None,
                int | None,
                list[dict] | None,
                int | None,
                float | None,
                float | None,
                int | None,
            ]
        ],
        int,
    ]:
        """Paginated user encounters with the viewer's per-match performance + heroes.

        Loads `Encounter.tournament` and `Match.map`; the seats, rosters and bracket
        position come from :meth:`get_encounter_contexts`, so the mapper can populate
        the narrow EncounterReadWithUserStats shape without any further round-trips.

        Row shape: (encounter, match, performance, heroes, impact_rank,
        impact_points, overperformance_score, overperf_pos). ``overperf_pos`` is
        the viewer's rank (1 = best) among all match participants by
        OverperformanceScore, used to compute the MVP-impact badge.
        """
        seat = Seat()
        history_seats = _user_history_seats(user_id)
        total_query = (
            sa.select(sa.func.count(sa.distinct(models.Encounter.id)))
            .select_from(seat.team)
            .join(models.Encounter, models.Encounter.id == seat.team.encounter_id)
            .where(seat.team.id.in_(history_seats))
        )
        encounters_query = (
            sa.select(models.Encounter, _PLAYED_AT.label("played_at"))
            .select_from(seat.team)
            .join(models.Encounter, models.Encounter.id == seat.team.encounter_id)
            .where(seat.team.id.in_(history_seats))
            .distinct()
        )

        if workspace_id is not None:
            total_query = total_query.join(
                models.Tournament, models.Encounter.tournament_id == models.Tournament.id
            ).where(*workspace_filter(workspace_id))
            encounters_query = encounters_query.join(
                models.Tournament, models.Encounter.tournament_id == models.Tournament.id
            ).where(*workspace_filter(workspace_id))
        if params.sort == "round" or stage in ("group", "playoffs", "finals"):
            # The bracket position moved to ``tournament.bracket_encounter``; an
            # encounter outside any bracket has no round or stage and sorts last.
            total_query = total_query.outerjoin(
                models.BracketEncounter, models.BracketEncounter.encounter_id == models.Encounter.id
            )
            encounters_query = encounters_query.outerjoin(
                models.BracketEncounter, models.BracketEncounter.encounter_id == models.Encounter.id
            )

        def apply_filters(q: sa.Select) -> sa.Select:
            """History may be retired; result filters still use the viewer's live roster seat."""
            if has_logs is not None:
                q = q.where(models.Encounter.has_logs.is_(has_logs))
            if result in ("win", "loss", "draw"):
                q = q.where(
                    seat.team.active.is_(True),
                    sa.exists(
                        sa.select(models.Player.id).where(
                            models.Player.team_id == seat.team.team_id, *_user_player_where(user_id)
                        )
                    ),
                )

            if result == "win":
                q = q.where(seat.won)
            elif result == "loss":
                q = q.where(seat.lost)
            elif result == "draw":
                q = q.where(seat.drew)

            if stage in ("group", "playoffs", "finals"):
                stage_item = sa.orm.aliased(models.StageItem)
                stage_obj = sa.orm.aliased(models.Stage)
                q = q.outerjoin(stage_item, models.BracketEncounter.stage_item_id == stage_item.id).outerjoin(
                    stage_obj, models.BracketEncounter.stage_id == stage_obj.id
                )
                stage_name = sa.func.coalesce(stage_item.name, stage_obj.name)
                if stage == "finals":
                    q = q.where(stage_name.ilike("%final%"))
                elif stage == "playoffs":
                    q = q.where(sa.or_(stage_name.ilike("%playoff%"), stage_name.ilike("%bracket%")))
                else:
                    q = q.where(sa.or_(stage_name.ilike("%group%"), stage_name.op("~*")("^[a-h]$")))

            if mvp1:
                # MVP placement spans two LogStatsName columns: ImpactRank when the
                # impact-scoring pipeline computed it for a match, legacy Performance
                # otherwise — same COALESCE(ImpactRank, Performance) == 1 (best) the
                # dossier/leaderboard use (see get_roster_avg_mvp_bulk).
                mvp_placement_cte = (
                    sa.select(
                        _facts.c.match_id.label("match_id"),
                        sa.func.max(
                            sa.case(
                                (
                                    _facts.c.stat_code == enums.LogStatsName.ImpactRank,
                                    _facts.c.value,
                                )
                            )
                        ).label("impact_rank"),
                        sa.func.max(
                            sa.case(
                                (
                                    _facts.c.stat_code == enums.LogStatsName.Performance,
                                    _facts.c.value,
                                )
                            )
                        ).label("performance"),
                    )
                    .where(
                        _facts.c.player_id == user_id,
                        _facts.c.stat_code.in_([enums.LogStatsName.ImpactRank, enums.LogStatsName.Performance]),
                        _facts.c.entity_id.is_(None),
                        _facts.c.segment == 0,
                    )
                    .group_by(_facts.c.match_id)
                    .cte("mvp1_placement_cte")
                )
                mvp_subq = (
                    sa.select(_matches.c.encounter_id)
                    .join(mvp_placement_cte, mvp_placement_cte.c.match_id == _matches.c.id)
                    .where(sa.func.coalesce(mvp_placement_cte.c.impact_rank, mvp_placement_cte.c.performance) == 1)
                )
                q = q.where(models.Encounter.id.in_(mvp_subq))

            if opponent:
                others = sa.orm.aliased(models.EncounterTeam, name="opponent_seat")
                q = q.where(
                    sa.exists(
                        sa.select(1).where(
                            others.encounter_id == seat.team.encounter_id,
                            others.active.is_(True),
                            others.id != seat.team.id,
                            others.name.ilike(f"%{opponent}%"),
                        )
                    )
                )

            return q

        total_query = apply_filters(total_query)
        encounters_query = apply_filters(encounters_query)

        if params.sort in ("played_at", "round"):
            descending = params.order == pagination.SortOrder.DESC or params.order == "desc"
            # ``round`` lives on the bracket row; the page query reads it back off this
            # subquery, and an encounter outside any bracket sorts last.
            sort_column = _PLAYED_AT if params.sort == "played_at" else models.BracketEncounter.round
            encounters_query = encounters_query.order_by(
                (sort_column.desc() if descending else sort_column.asc()).nulls_last(),
                models.Encounter.id.desc() if descending else models.Encounter.id.asc(),
            )
            if params.sort == "round":
                encounters_query = encounters_query.add_columns(models.BracketEncounter.round.label("round"))
            encounters_query = params.apply_pagination(encounters_query)
        else:
            encounters_query = params.apply_pagination_sort(encounters_query)
        encounters_query = encounters_query.subquery()

        paginated_match_ids = (
            sa.select(_matches.c.id.label("match_id"))
            .select_from(encounters_query)
            .join(_matches, _matches.c.encounter_id == encounters_query.c.id)
            .cte("paginated_match_ids")
        )

        performance_cte = (
            sa.select(
                _facts.c.match_id,
                _facts.c.value.label("performance"),
            )
            .where(
                sa.and_(
                    _facts.c.player_id == user_id,
                    _facts.c.stat_code == enums.LogStatsName.Performance,
                    _facts.c.entity_id.is_(None),
                    _facts.c.segment == 0,
                    _facts.c.match_id.in_(sa.select(paginated_match_ids.c.match_id)),
                )
            )
            .cte("performance_cte")
        )

        heroes_cte = (
            sa.select(
                _facts.c.match_id,
                sa.func.jsonb_agg(aggregate_order_by(_HERO_JSON, _facts.c.entity_id)).label("heroes"),
            )
            .join(models.CatalogEntity, _facts.c.entity_id == models.CatalogEntity.id)
            .where(
                sa.and_(
                    models.CatalogEntity.kind == "character",
                    models.CatalogEntity.discipline == "overwatch",
                    _facts.c.player_id == user_id,
                    _facts.c.stat_code == enums.LogStatsName.HeroTimePlayed,
                    _facts.c.entity_id.isnot(None),
                    _facts.c.value > 60,
                    _facts.c.segment == 0,
                    _facts.c.match_id.in_(sa.select(paginated_match_ids.c.match_id)),
                )
            )
            .group_by(_facts.c.match_id)
            .cte("heroes_cte")
        )

        impact_rank_cte = (
            sa.select(
                _facts.c.match_id,
                _facts.c.value.label("impact_rank"),
            )
            .where(
                sa.and_(
                    _facts.c.player_id == user_id,
                    _facts.c.stat_code == enums.LogStatsName.ImpactRank,
                    _facts.c.entity_id.is_(None),
                    _facts.c.segment == 0,
                    _facts.c.match_id.in_(sa.select(paginated_match_ids.c.match_id)),
                )
            )
            .cte("impact_rank_cte")
        )

        impact_points_cte = (
            sa.select(
                _facts.c.match_id,
                _facts.c.value.label("impact_points"),
            )
            .where(
                sa.and_(
                    _facts.c.player_id == user_id,
                    _facts.c.stat_code == enums.LogStatsName.ImpactPoints,
                    _facts.c.entity_id.is_(None),
                    _facts.c.segment == 0,
                    _facts.c.match_id.in_(sa.select(paginated_match_ids.c.match_id)),
                )
            )
            .cte("impact_points_cte")
        )

        overperf_cte = (
            sa.select(
                _facts.c.match_id.label("match_id"),
                _facts.c.player_id.label("user_id"),
                _facts.c.value.label("overperformance_score"),
                sa.func.rank()
                .over(
                    partition_by=_facts.c.match_id,
                    order_by=_facts.c.value.desc(),
                )
                .label("overperf_pos"),
            )
            .where(
                sa.and_(
                    _facts.c.stat_code == enums.LogStatsName.OverperformanceScore,
                    _facts.c.entity_id.is_(None),
                    _facts.c.segment == 0,
                    _facts.c.match_id.in_(sa.select(paginated_match_ids.c.match_id)),
                )
            )
            .cte("overperf_cte")
        )

        query = (
            sa.select(
                models.Encounter,
                _matches.c.id,
                performance_cte.c.performance,
                heroes_cte.c.heroes,
                impact_rank_cte.c.impact_rank,
                impact_points_cte.c.impact_points,
                overperf_cte.c.overperformance_score,
                overperf_cte.c.overperf_pos,
            )
            .select_from(encounters_query)
            .options(
                joinedload(models.Encounter.tournament),
            )
            .join(models.Encounter, encounters_query.c.id == models.Encounter.id)
            .join(_matches, models.Encounter.id == _matches.c.encounter_id, isouter=True)
            .join(performance_cte, performance_cte.c.match_id == _matches.c.id, isouter=True)
            .join(heroes_cte, heroes_cte.c.match_id == _matches.c.id, isouter=True)
            .join(impact_rank_cte, impact_rank_cte.c.match_id == _matches.c.id, isouter=True)
            .join(impact_points_cte, impact_points_cte.c.match_id == _matches.c.id, isouter=True)
            .join(
                overperf_cte,
                sa.and_(overperf_cte.c.match_id == _matches.c.id, overperf_cte.c.user_id == user_id),
                isouter=True,
            )
        )
        if params.sort in ("played_at", "round"):
            descending = params.order == pagination.SortOrder.DESC or params.order == "desc"
            sort_column = encounters_query.c[params.sort]
            query = query.order_by(
                (sort_column.desc() if descending else sort_column.asc()).nulls_last(),
                encounters_query.c.id.desc() if descending else encounters_query.c.id.asc(),
                _matches.c.position.asc().nulls_last(),
                _matches.c.id.asc(),
            )
        else:
            query = params.apply_sort(query)
        result = await session.execute(query)
        total_result = await session.execute(total_query)
        # Heroes contain unhashable JSON lists, so deduplicate on native ids.
        rows = result.unique(_encounter_match_identity).all()
        reads = await get_match_reads(session, match_ids=[row[1] for row in rows if row[1] is not None])
        return (
            [
                (encounter, reads[match_id] if match_id is not None else None, *stats)
                for encounter, match_id, *stats in rows
            ],
            total_result.scalar_one(),
        )

    async def get_encounter_contexts(
        self, session: AsyncSession, encounter_ids: typing.Collection[int]
    ) -> dict[int, _mappers.EncounterContext]:
        """Live seats (with their roster snapshots) and the bracket position, per encounter.

        Three bulk reads for any number of encounters: the active participations,
        their roster rows with the account each belongs to, and the bracket
        coordinate with its stage and stage item. An encounter outside a bracket
        has no position; one without seats gets an empty list.
        """
        if not encounter_ids:
            return {}
        ids = tuple(encounter_ids)
        seats = (
            await session.scalars(
                sa.select(models.EncounterTeam)
                .where(models.EncounterTeam.encounter_id.in_(ids), models.EncounterTeam.active.is_(True))
                .order_by(models.EncounterTeam.encounter_id, models.EncounterTeam.slot)
            )
        ).all()

        roles: dict[int, RoleRef | None] = {}
        for member_id, dimension, role, sub_role in (
            await session.execute(
                sa.select(
                    models.EncounterTeamMemberRole.team_member_id,
                    models.RoleDimension.code,
                    leaf_code(models.EncounterTeamMemberRole.role_id, top=True).label("role"),
                    leaf_code(models.EncounterTeamMemberRole.role_id, top=False).label("sub_role"),
                )
                .join(models.RoleDimension, models.RoleDimension.id == models.EncounterTeamMemberRole.dimension_id)
                .join(
                    models.EncounterTeamMember,
                    models.EncounterTeamMember.id == models.EncounterTeamMemberRole.team_member_id,
                )
                .join(models.Encounter, models.Encounter.id == models.EncounterTeamMember.encounter_id)
                .where(
                    models.EncounterTeamMember.encounter_id.in_(ids),
                    models.EncounterTeamMember.active.is_(True),
                    models.RoleDimension.rated.is_(True),
                    models.RoleDimension.discipline == models.Encounter.discipline,
                )
                .order_by(models.EncounterTeamMemberRole.team_member_id, models.EncounterTeamMemberRole.role_id)
            )
        ).all():
            roles[member_id] = RoleRef.of(dimension, role, sub_role)
        rosters: dict[int, list[_mappers.RosterEntry]] = {}
        for member, user_id in (
            await session.execute(
                sa.select(models.EncounterTeamMember, models.WorkspaceMember.player_id)
                .join(
                    models.WorkspaceMember, models.WorkspaceMember.id == models.EncounterTeamMember.workspace_member_id
                )
                .where(models.EncounterTeamMember.encounter_id.in_(ids), models.EncounterTeamMember.active.is_(True))
                .order_by(models.EncounterTeamMember.id)
            )
        ).all():
            rosters.setdefault(member.encounter_team_id, []).append(
                _mappers.RosterEntry(member=member, user_id=user_id, role=roles.get(member.id))
            )

        stage_item = sa.orm.aliased(models.StageItem)
        positions = {
            bracket.encounter_id: (bracket, stage, item)
            for bracket, stage, item in (
                await session.execute(
                    sa.select(models.BracketEncounter, models.Stage, stage_item)
                    .outerjoin(models.Stage, models.Stage.id == models.BracketEncounter.stage_id)
                    .outerjoin(stage_item, stage_item.id == models.BracketEncounter.stage_item_id)
                    .where(models.BracketEncounter.encounter_id.in_(ids))
                )
            ).all()
        }

        grouped: dict[int, list[tuple[models.EncounterTeam, list[_mappers.RosterEntry]]]] = {}
        for seat in seats:
            grouped.setdefault(seat.encounter_id, []).append((seat, rosters.get(seat.id, [])))
        contexts: dict[int, _mappers.EncounterContext] = {}
        for encounter_id in ids:
            bracket, stage, item = positions.get(encounter_id, (None, None, None))
            contexts[encounter_id] = _mappers.EncounterContext(
                seats=grouped.get(encounter_id, []), position=bracket, stage=stage, stage_item=item
            )
        return contexts

    async def get_user_opponents(
        self,
        session: AsyncSession,
        user_id: int,
        workspace_id: int | None = None,
        *,
        limit: int = 8,
    ):
        """Most-fought opponents across ALL of the user's encounters: opponent team
        name + win/loss/draw record, ordered by number of meetings (desc)."""
        seat = Seat()
        # The snapshot name the opponent seat played under; each other live seat
        # of the encounter is one opponent, so a lobby credits every rival.
        opponent = sa.orm.aliased(models.EncounterTeam, name="opponent_seat")

        query = (
            seat.join(
                sa.select(
                    opponent.name.label("name"),
                    sa.func.sum(seat.count(seat.won)).label("wins"),
                    sa.func.sum(seat.count(seat.lost)).label("losses"),
                    sa.func.sum(seat.count(seat.drew)).label("draws"),
                ).select_from(models.Player),
                models.Player.team_id,
                duel=False,
            )
            .join(
                opponent,
                sa.and_(
                    opponent.encounter_id == seat.team.encounter_id,
                    opponent.active.is_(True),
                    opponent.id != seat.team.id,
                ),
            )
            .where(*_user_player_where(user_id))
        )

        if workspace_id is not None:
            query = query.join(models.Tournament, models.Encounter.tournament_id == models.Tournament.id).where(
                *workspace_filter(workspace_id)
            )

        query = query.group_by(opponent.name).order_by(sa.func.count(models.Encounter.id).desc()).limit(limit)

        return (await session.execute(query)).all()

    async def get_user_stage_breakdown(
        self,
        session: AsyncSession,
        user_id: int,
        workspace_id: int | None = None,
    ):
        """Per-stage (group / playoffs / finals) win-loss record across ALL of the
        user's encounters. Rows whose stage doesn't classify get a NULL `kind` and
        are ignored by the caller."""
        stage_item = sa.orm.aliased(models.StageItem)
        stage_obj = sa.orm.aliased(models.Stage)
        stage_name = sa.func.coalesce(stage_item.name, stage_obj.name)
        stage_kind = sa.case(
            (stage_name.ilike("%final%"), "finals"),
            (sa.or_(stage_name.ilike("%playoff%"), stage_name.ilike("%bracket%")), "playoffs"),
            (sa.or_(stage_name.ilike("%group%"), stage_name.op("~*")("^[a-h]$")), "group"),
            else_=None,
        )

        seat = Seat()
        bracket = sa.orm.aliased(models.BracketEncounter)
        query = (
            seat.join(
                sa.select(
                    stage_kind.label("kind"),
                    sa.func.sum(seat.count(seat.won)).label("w"),
                    sa.func.sum(seat.count(seat.lost)).label("l"),
                ).select_from(models.Player),
                models.Player.team_id,
                duel=False,
            )
            .outerjoin(bracket, bracket.encounter_id == models.Encounter.id)
            .outerjoin(stage_item, bracket.stage_item_id == stage_item.id)
            .outerjoin(stage_obj, bracket.stage_id == stage_obj.id)
            .where(*_user_player_where(user_id))
        )

        if workspace_id is not None:
            query = query.join(models.Tournament, models.Encounter.tournament_id == models.Tournament.id).where(
                *workspace_filter(workspace_id)
            )

        query = query.group_by(stage_kind)

        return (await session.execute(query)).all()

    async def count_teams_by_tournament_bulk(self, session: AsyncSession, tournaments_ids: list[int]) -> dict[int, int]:
        """Number of teams per tournament — used to compute `count_teams`."""
        if not tournaments_ids:
            return {}
        query = (
            sa.select(models.Team.tournament_id, sa.func.count(models.Team.id))
            .where(models.Team.tournament_id.in_(tournaments_ids))
            .group_by(models.Team.tournament_id)
        )
        result = await session.execute(query)
        return dict(result.all())

    async def get_roster_avg_mvp_bulk(
        self,
        session: AsyncSession,
        tournament_ids: list[int],
        user_ids: list[int],
    ) -> dict[tuple[int, int], float]:
        """Average MVP placement per (tournament_id, user_id) for a set of roster players.

        Mirrors the dossier "Avg MVP" summary metric: for each match the player
        played, take ``COALESCE(ImpactRank, Performance)`` (1 = best; ImpactRank is
        the newer impact-scoring rank, Performance the legacy fallback — same
        preference the frontend applies), then average across the player's matches in
        that tournament.

        ONE bulk query keyed by (tournament_id, user_id) — no per-roster-player
        round-trips. Scoped to ``tournament_ids`` (which are already
        workspace-scoped by the caller) via ``Encounter.tournament_id``.
        """
        if not tournament_ids or not user_ids:
            return {}

        per_match = (
            sa.select(
                models.Encounter.tournament_id.label("tournament_id"),
                _facts.c.player_id.label("user_id"),
                _facts.c.match_id.label("match_id"),
                sa.func.max(
                    sa.case(
                        (
                            _facts.c.stat_code == enums.LogStatsName.ImpactRank,
                            _facts.c.value,
                        )
                    )
                ).label("impact_rank"),
                sa.func.max(
                    sa.case(
                        (
                            _facts.c.stat_code == enums.LogStatsName.Performance,
                            _facts.c.value,
                        )
                    )
                ).label("performance"),
            )
            .select_from(_facts)
            .join(_matches, _matches.c.id == _facts.c.match_id)
            .join(models.Encounter, models.Encounter.id == _matches.c.encounter_id)
            .where(
                sa.and_(
                    _facts.c.player_id.in_(user_ids),
                    _facts.c.stat_code.in_([enums.LogStatsName.ImpactRank, enums.LogStatsName.Performance]),
                    _facts.c.entity_id.is_(None),
                    _facts.c.segment == 0,
                    models.Encounter.tournament_id.in_(tournament_ids),
                )
            )
            .group_by(
                models.Encounter.tournament_id,
                _facts.c.player_id,
                _facts.c.match_id,
            )
            .cte("roster_mvp_per_match")
        )

        placement = sa.func.coalesce(per_match.c.impact_rank, per_match.c.performance)

        query = (
            sa.select(
                per_match.c.tournament_id,
                per_match.c.user_id,
                sa.func.avg(aggregate_order_by(placement, per_match.c.match_id)).label("avg_mvp"),
            )
            .where(placement.isnot(None))
            .group_by(per_match.c.tournament_id, per_match.c.user_id)
        )

        result = await session.execute(query)
        return {(row.tournament_id, row.user_id): float(row.avg_mvp) for row in result}

    async def get_roster_top_heroes_bulk(
        self,
        session: AsyncSession,
        tournament_ids: list[int],
        user_ids: list[int],
        *,
        top_n: int = 3,
    ) -> dict[tuple[int, int], list[dict]]:
        """Top-N heroes by playtime per (tournament_id, user_id) for roster players.

        Reuses the HeroTimePlayed playtime convention used elsewhere in this module
        (value > 60s, round 0) and emits each hero in the same ``_HERO_JSON`` shape
        the encounter/match reads use, so ``schemas.HeroRead`` validates identically.

        ONE bulk query, ranked with a window function partitioned by
        (tournament_id, user_id) — no per-roster-player round-trips. Scoped to
        ``tournament_ids`` (already workspace-scoped by the caller) via
        ``Encounter.tournament_id``.
        """
        if not tournament_ids or not user_ids:
            return {}

        playtime = (
            sa.select(
                models.Encounter.tournament_id.label("tournament_id"),
                _facts.c.player_id.label("user_id"),
                _facts.c.entity_id.label("hero_id"),
                sa.func.sum(
                    aggregate_order_by(
                        _facts.c.value,
                        _facts.c.match_id,
                        _facts.c.workspace_member_id,
                    )
                ).label("playtime"),
            )
            .select_from(_facts)
            .join(_matches, _matches.c.id == _facts.c.match_id)
            .join(models.Encounter, models.Encounter.id == _matches.c.encounter_id)
            .where(
                sa.and_(
                    _facts.c.player_id.in_(user_ids),
                    _facts.c.stat_code == enums.LogStatsName.HeroTimePlayed,
                    _facts.c.entity_id.isnot(None),
                    _facts.c.value > 60,
                    _facts.c.segment == 0,
                    models.Encounter.tournament_id.in_(tournament_ids),
                )
            )
            .group_by(
                models.Encounter.tournament_id,
                _facts.c.player_id,
                _facts.c.entity_id,
            )
            .cte("roster_hero_playtime")
        )

        ranked = sa.select(
            playtime.c.tournament_id,
            playtime.c.user_id,
            playtime.c.hero_id,
            playtime.c.playtime,
            sa.func.row_number()
            .over(
                partition_by=(playtime.c.tournament_id, playtime.c.user_id),
                # hero_id tiebreak keeps the ordering deterministic on equal playtime.
                order_by=(playtime.c.playtime.desc(), playtime.c.hero_id.asc()),
            )
            .label("rn"),
        ).cte("roster_hero_ranked")

        query = (
            sa.select(
                ranked.c.tournament_id,
                ranked.c.user_id,
                _HERO_JSON.label("hero"),
            )
            .select_from(ranked)
            .join(models.CatalogEntity, models.CatalogEntity.id == ranked.c.hero_id)
            .where(
                ranked.c.rn <= top_n,
                models.CatalogEntity.kind == "character",
                models.CatalogEntity.discipline == "overwatch",
            )
            .order_by(ranked.c.tournament_id, ranked.c.user_id, ranked.c.playtime.desc(), ranked.c.hero_id.asc())
        )

        result = await session.execute(query)
        heroes_map: dict[tuple[int, int], list[dict]] = {}
        for row in result:
            heroes_map.setdefault((row.tournament_id, row.user_id), []).append(row.hero)
        return heroes_map

    async def get_user_hero_records(
        self,
        session: AsyncSession,
        user_id: int,
        workspace_id: int | None = None,
        *,
        min_seconds: float = 60,
    ) -> typing.Sequence[tuple[models.CatalogEntity, int, int]]:
        """Every hero the user played as ``(hero, maps played, maps won)``, most played first.

        "Played" follows the same convention as every other hero read here
        (``HeroTimePlayed`` above ``min_seconds``, round 0): a hero swapped in for
        thirty seconds is not a map played. Win/loss comes from the map score
        against the side the user played on — the rule
        ``HeroQueries.get_user_hero_stats_by_maps`` applies for the per-map hero
        popover; draws count as maps played, never as wins. ONE query, ranked in
        the database. Uncapped because the card's role tiles look up the heroes a
        player DECLARED, which need not be among their most played.
        """
        hero_match_q = (
            sa.select(
                _facts.c.entity_id.label("hero_id"),
                _facts.c.encounter_team_id,
                _matches.c.id.label("match_id"),
            )
            .select_from(_facts)
            .join(_matches, _matches.c.id == _facts.c.match_id)
            .join(models.Encounter, models.Encounter.id == _matches.c.encounter_id)
            .where(
                sa.and_(
                    _facts.c.player_id == user_id,
                    _facts.c.stat_code == enums.LogStatsName.HeroTimePlayed,
                    _facts.c.entity_id.isnot(None),
                    _facts.c.value > min_seconds,
                    _facts.c.segment == 0,
                )
            )
        )
        if workspace_id is not None:
            hero_match_q = hero_match_q.join(
                models.Tournament, models.Tournament.id == models.Encounter.tournament_id
            ).where(models.Tournament.workspace_id == workspace_id)

        hero_match = hero_match_q.group_by(
            _facts.c.entity_id,
            _facts.c.encounter_team_id,
            _matches.c.id,
        ).cte("draft_card_hero_match")

        team_score = sa.case(
            (_duels.c.home_encounter_team_id == hero_match.c.encounter_team_id, _duels.c.home_score),
            else_=_duels.c.away_score,
        )
        opponent_score = sa.case(
            (_duels.c.home_encounter_team_id == hero_match.c.encounter_team_id, _duels.c.away_score),
            else_=_duels.c.home_score,
        )
        maps = sa.func.count(hero_match.c.match_id)
        maps_won = sa.func.sum(sa.case((team_score > opponent_score, 1), else_=0))

        query = (
            sa.select(models.CatalogEntity, maps.label("maps"), maps_won.label("maps_won"))
            .select_from(hero_match)
            .join(_duels, _duels.c.id == hero_match.c.match_id)
            .join(models.CatalogEntity, models.CatalogEntity.id == hero_match.c.hero_id)
            .where(models.CatalogEntity.kind == "character", models.CatalogEntity.discipline == "overwatch")
            .group_by(models.CatalogEntity.id)
            # hero id tiebreak keeps the order deterministic on equal map counts.
            .order_by(maps.desc(), models.CatalogEntity.id.asc())
        )
        result = await session.execute(query)
        return [(row[0], int(row.maps), int(row.maps_won or 0)) for row in result]

    async def count_user_mvp_maps(
        self,
        session: AsyncSession,
        user_id: int,
        workspace_id: int | None = None,
    ) -> int:
        """Maps the user topped the lobby's MVP placement on.

        Same placement the dossier's "Avg MVP" averages (see
        ``get_roster_avg_mvp_bulk``): ``COALESCE(ImpactRank, Performance)`` per
        match, 1 = best. This counts the maps where that placement is 1.
        """
        per_match = (
            sa.select(
                _facts.c.match_id.label("match_id"),
                sa.func.max(
                    sa.case(
                        (
                            _facts.c.stat_code == enums.LogStatsName.ImpactRank,
                            _facts.c.value,
                        )
                    )
                ).label("impact_rank"),
                sa.func.max(
                    sa.case(
                        (
                            _facts.c.stat_code == enums.LogStatsName.Performance,
                            _facts.c.value,
                        )
                    )
                ).label("performance"),
            )
            .select_from(_facts)
            .join(_matches, _matches.c.id == _facts.c.match_id)
            .join(models.Encounter, models.Encounter.id == _matches.c.encounter_id)
            .where(
                sa.and_(
                    _facts.c.player_id == user_id,
                    _facts.c.stat_code.in_([enums.LogStatsName.ImpactRank, enums.LogStatsName.Performance]),
                    _facts.c.entity_id.is_(None),
                    _facts.c.segment == 0,
                )
            )
        )
        if workspace_id is not None:
            per_match = per_match.join(models.Tournament, models.Tournament.id == models.Encounter.tournament_id).where(
                models.Tournament.workspace_id == workspace_id
            )

        per_match = per_match.group_by(_facts.c.match_id).cte("draft_card_mvp_per_match")
        query = (
            sa.select(sa.func.count())
            .select_from(per_match)
            .where(sa.func.coalesce(per_match.c.impact_rank, per_match.c.performance) == 1)
        )
        result = await session.execute(query)
        return int(result.scalar_one() or 0)

    async def get_player_by_user_and_tournament(
        self, session: AsyncSession, user_id: int, tournament_id: int
    ) -> models.Player | None:
        """Look up a user's Player row for a specific tournament.

        Loads `team` + `team.tournament` (+ its `division_grid_version`) +
        `team.standings` for the stats page. The grid version is eager-loaded so the
        last-tournament card can render the division on the tournament's own grid
        without triggering a lazy load outside the async greenlet.
        """
        query = (
            sa.select(models.Player)
            .options(
                joinedload(models.Player.team)
                .joinedload(models.Team.tournament)
                .joinedload(models.Tournament.division_grid_version),
                joinedload(models.Player.team).selectinload(models.Team.standings),
            )
            .where(
                sa.and_(
                    models.Player.workspace_member.has(models.WorkspaceMember.player_id == user_id),
                    models.Player.tournament_id == tournament_id,
                )
            )
        )
        result = await session.execute(query)
        return result.unique().scalars().first()


encounters = UserEncounterQueries()
