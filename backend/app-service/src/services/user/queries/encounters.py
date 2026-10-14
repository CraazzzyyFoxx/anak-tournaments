"""Encounter / roster queries for the user Matches and Tournaments tabs.

These queries used to live in ``services._internal.encounter.service`` and
``services._internal.team.service``. After P3-A they are private to
``services/user/`` — the only consumer.
"""

from __future__ import annotations

import typing

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from shared.core.enums import PickBanKind
from shared.models.encounter.pick_ban import PickBanEntry, PickBanSession
from src import models
from src.core import enums, pagination
from src.core.workspace import workspace_filter
from src.domain.encounter_seats import Seat
from src.services.user import _mappers

_LAST_MATCH_AT = (
    sa.select(sa.func.max(models.Match.created_at))
    .where(models.Match.encounter_id == models.Encounter.id)
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
) -> tuple[int, int, int | None]:
    team, encounter, match, *_ = row
    return team.id, encounter.id, match.id if match is not None else None


def _encounter_match_identity(
    row: typing.Sequence[typing.Any],
) -> tuple[int, int | None]:
    encounter, match, *_ = row
    return encounter.id, match.id if match is not None else None


def _user_player_where(user_id: int):
    return (
        models.Player.workspace_member.has(models.WorkspaceMember.player_id == user_id),
        models.Player.is_substitution.is_(False),
    )


class UserEncounterQueries:
    """Encounter, opponent and roster aggregate reads for one user."""

    async def get_user_encounter_matches_unpaginated(
        self, session: AsyncSession, user_id: int, *, tournament_id: int | None = None
    ) -> typing.Sequence[
        tuple[
            models.Team,
            models.Encounter,
            models.Match | None,
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
                models.MatchStatistics.match_id.label("match_id"),
                models.MatchStatistics.value.label("value"),
            )
            .where(
                sa.and_(
                    models.MatchStatistics.match_id == models.Match.id,
                    models.MatchStatistics.user_id == user_id,
                    models.MatchStatistics.name == enums.LogStatsName.Performance,
                    models.MatchStatistics.hero_id.is_(None),
                    models.MatchStatistics.round == 0,
                )
            )
            .cte("performance_cte")
        )

        impact_rank_cte = (
            sa.select(
                models.MatchStatistics.match_id.label("match_id"),
                models.MatchStatistics.value.label("value"),
            )
            .where(
                sa.and_(
                    models.MatchStatistics.match_id == models.Match.id,
                    models.MatchStatistics.user_id == user_id,
                    models.MatchStatistics.name == enums.LogStatsName.ImpactRank,
                    models.MatchStatistics.hero_id.is_(None),
                    models.MatchStatistics.round == 0,
                )
            )
            .cte("impact_rank_cte")
        )

        impact_points_cte = (
            sa.select(
                models.MatchStatistics.match_id.label("match_id"),
                models.MatchStatistics.value.label("value"),
            )
            .where(
                sa.and_(
                    models.MatchStatistics.match_id == models.Match.id,
                    models.MatchStatistics.user_id == user_id,
                    models.MatchStatistics.name == enums.LogStatsName.ImpactPoints,
                    models.MatchStatistics.hero_id.is_(None),
                    models.MatchStatistics.round == 0,
                )
            )
            .cte("impact_points_cte")
        )

        overperf_cte = (
            sa.select(
                models.MatchStatistics.match_id.label("match_id"),
                models.MatchStatistics.user_id.label("user_id"),
                models.MatchStatistics.value.label("value"),
                sa.func.rank()
                .over(
                    partition_by=models.MatchStatistics.match_id,
                    order_by=models.MatchStatistics.value.desc(),
                )
                .label("pos"),
            )
            .where(
                sa.and_(
                    models.MatchStatistics.name == enums.LogStatsName.OverperformanceScore,
                    models.MatchStatistics.hero_id.is_(None),
                    models.MatchStatistics.round == 0,
                )
            )
            .cte("overperf_cte")
        )

        heroes_cte = (
            sa.select(
                models.MatchStatistics.match_id.label("match_id"),
                sa.func.jsonb_agg(_HERO_JSON).label("value"),
            )
            .select_from(models.MatchStatistics)
            .join(models.CatalogEntity, models.MatchStatistics.hero_id == models.CatalogEntity.id)
            .where(
                sa.and_(
                    models.CatalogEntity.kind == "character",
                    models.CatalogEntity.discipline == "overwatch",
                    models.MatchStatistics.match_id == models.Match.id,
                    models.MatchStatistics.name == enums.LogStatsName.HeroTimePlayed,
                    models.MatchStatistics.user_id == user_id,
                    models.MatchStatistics.hero_id.isnot(None),
                    models.MatchStatistics.value > 60,
                    models.MatchStatistics.round == 0,
                )
            )
            .group_by(models.MatchStatistics.match_id)
            .cte("heroes_cte")
        )

        seat = Seat()
        query = (
            sa.select(
                models.Team,
                models.Encounter,
                models.Match,
                performance_cte.c.value.label("performance"),
                heroes_cte.c.value.label("heroes"),
                impact_rank_cte.c.value.label("impact_rank"),
                impact_points_cte.c.value.label("impact_points"),
                overperf_cte.c.value.label("overperformance_score"),
                overperf_cte.c.pos.label("overperf_pos"),
            )
            .select_from(models.Player)
            .options(
                joinedload(models.Match.map).joinedload(models.CatalogEntity.parent),
                joinedload(models.Encounter.tournament),
            )
            .join(models.Team, models.Player.team_id == models.Team.id)
        )
        query = (
            seat.join(query, models.Player.team_id, duel=False)
            .join(models.Match, models.Encounter.id == models.Match.encounter_id, isouter=True)
            .outerjoin(performance_cte, performance_cte.c.match_id == models.Match.id)
            .outerjoin(heroes_cte, heroes_cte.c.match_id == models.Match.id)
            .outerjoin(impact_rank_cte, impact_rank_cte.c.match_id == models.Match.id)
            .outerjoin(impact_points_cte, impact_points_cte.c.match_id == models.Match.id)
            .outerjoin(
                overperf_cte,
                sa.and_(overperf_cte.c.match_id == models.Match.id, overperf_cte.c.user_id == user_id),
            )
            .join(models.WorkspaceMember, models.WorkspaceMember.id == models.Player.workspace_member_id)
            .where(
                sa.and_(
                    models.WorkspaceMember.player_id == user_id,
                    models.Player.is_substitution.is_(False),
                    *([models.Team.tournament_id == tournament_id] if tournament_id is not None else []),
                )
            )
            .order_by(
                _PLAYED_AT.asc(),
                models.Encounter.id.asc(),
                models.Match.map_index.asc().nulls_last(),
                models.Match.id.asc(),
            )
        )

        result = await session.execute(query)
        return result.unique(_team_encounter_match_identity).all()  # type: ignore[arg-type]

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
                models.Match | None,
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
        user_player_filter = sa.and_(
            models.Player.workspace_member.has(models.WorkspaceMember.player_id == user_id),
            models.Player.is_substitution.is_(False),
        )

        seat = Seat()
        total_query = seat.join(
            sa.select(sa.func.count(models.Encounter.id)).select_from(models.Player), models.Player.team_id, duel=False
        ).where(user_player_filter)

        encounters_query = seat.join(
            sa.select(models.Encounter, models.Player.id.label("player_id"), _PLAYED_AT.label("played_at")).select_from(
                models.Player
            ),
            models.Player.team_id,
            duel=False,
        ).where(user_player_filter)

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
            """Apply the Matches-tab filters server-side. Both the count and the
            result query must get identical filters so pagination stays correct.
            `models.Player.team_id` is the viewer's team for the encounter (joined
            above), which lets us express win/loss and opponent-name conditions."""
            if has_logs is not None:
                q = q.where(models.Encounter.has_logs.is_(has_logs))

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
                        models.MatchStatistics.match_id.label("match_id"),
                        sa.func.max(
                            sa.case(
                                (
                                    models.MatchStatistics.name == enums.LogStatsName.ImpactRank,
                                    models.MatchStatistics.value,
                                )
                            )
                        ).label("impact_rank"),
                        sa.func.max(
                            sa.case(
                                (
                                    models.MatchStatistics.name == enums.LogStatsName.Performance,
                                    models.MatchStatistics.value,
                                )
                            )
                        ).label("performance"),
                    )
                    .where(
                        models.MatchStatistics.user_id == user_id,
                        models.MatchStatistics.name.in_(
                            [enums.LogStatsName.ImpactRank, enums.LogStatsName.Performance]
                        ),
                        models.MatchStatistics.hero_id.is_(None),
                        models.MatchStatistics.round == 0,
                    )
                    .group_by(models.MatchStatistics.match_id)
                    .cte("mvp1_placement_cte")
                )
                mvp_subq = (
                    sa.select(models.Match.encounter_id)
                    .join(mvp_placement_cte, mvp_placement_cte.c.match_id == models.Match.id)
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
            sa.select(models.Match.id.label("match_id"))
            .select_from(encounters_query)
            .join(models.Match, models.Match.encounter_id == encounters_query.c.id)
            .cte("paginated_match_ids")
        )

        performance_cte = (
            sa.select(
                models.MatchStatistics.match_id,
                models.MatchStatistics.value.label("performance"),
            )
            .where(
                sa.and_(
                    models.MatchStatistics.user_id == user_id,
                    models.MatchStatistics.name == enums.LogStatsName.Performance,
                    models.MatchStatistics.hero_id.is_(None),
                    models.MatchStatistics.round == 0,
                    models.MatchStatistics.match_id.in_(sa.select(paginated_match_ids.c.match_id)),
                )
            )
            .cte("performance_cte")
        )

        heroes_cte = (
            sa.select(
                models.MatchStatistics.match_id,
                sa.func.jsonb_agg(_HERO_JSON).label("heroes"),
            )
            .join(models.CatalogEntity, models.MatchStatistics.hero_id == models.CatalogEntity.id)
            .where(
                sa.and_(
                    models.CatalogEntity.kind == "character",
                    models.CatalogEntity.discipline == "overwatch",
                    models.MatchStatistics.user_id == user_id,
                    models.MatchStatistics.name == enums.LogStatsName.HeroTimePlayed,
                    models.MatchStatistics.hero_id.isnot(None),
                    models.MatchStatistics.value > 60,
                    models.MatchStatistics.round == 0,
                    models.MatchStatistics.match_id.in_(sa.select(paginated_match_ids.c.match_id)),
                )
            )
            .group_by(models.MatchStatistics.match_id)
            .cte("heroes_cte")
        )

        impact_rank_cte = (
            sa.select(
                models.MatchStatistics.match_id,
                models.MatchStatistics.value.label("impact_rank"),
            )
            .where(
                sa.and_(
                    models.MatchStatistics.user_id == user_id,
                    models.MatchStatistics.name == enums.LogStatsName.ImpactRank,
                    models.MatchStatistics.hero_id.is_(None),
                    models.MatchStatistics.round == 0,
                    models.MatchStatistics.match_id.in_(sa.select(paginated_match_ids.c.match_id)),
                )
            )
            .cte("impact_rank_cte")
        )

        impact_points_cte = (
            sa.select(
                models.MatchStatistics.match_id,
                models.MatchStatistics.value.label("impact_points"),
            )
            .where(
                sa.and_(
                    models.MatchStatistics.user_id == user_id,
                    models.MatchStatistics.name == enums.LogStatsName.ImpactPoints,
                    models.MatchStatistics.hero_id.is_(None),
                    models.MatchStatistics.round == 0,
                    models.MatchStatistics.match_id.in_(sa.select(paginated_match_ids.c.match_id)),
                )
            )
            .cte("impact_points_cte")
        )

        overperf_cte = (
            sa.select(
                models.MatchStatistics.match_id.label("match_id"),
                models.MatchStatistics.user_id.label("user_id"),
                models.MatchStatistics.value.label("overperformance_score"),
                sa.func.rank()
                .over(
                    partition_by=models.MatchStatistics.match_id,
                    order_by=models.MatchStatistics.value.desc(),
                )
                .label("overperf_pos"),
            )
            .where(
                sa.and_(
                    models.MatchStatistics.name == enums.LogStatsName.OverperformanceScore,
                    models.MatchStatistics.hero_id.is_(None),
                    models.MatchStatistics.round == 0,
                    models.MatchStatistics.match_id.in_(sa.select(paginated_match_ids.c.match_id)),
                )
            )
            .cte("overperf_cte")
        )

        query = (
            sa.select(
                models.Encounter,
                models.Match,
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
                joinedload(models.Match.map).joinedload(models.CatalogEntity.parent),
            )
            .join(models.Encounter, encounters_query.c.id == models.Encounter.id)
            .join(models.Match, models.Encounter.id == models.Match.encounter_id, isouter=True)
            .join(performance_cte, performance_cte.c.match_id == models.Match.id, isouter=True)
            .join(heroes_cte, heroes_cte.c.match_id == models.Match.id, isouter=True)
            .join(impact_rank_cte, impact_rank_cte.c.match_id == models.Match.id, isouter=True)
            .join(impact_points_cte, impact_points_cte.c.match_id == models.Match.id, isouter=True)
            .join(
                overperf_cte,
                sa.and_(overperf_cte.c.match_id == models.Match.id, overperf_cte.c.user_id == user_id),
                isouter=True,
            )
        )
        if params.sort in ("played_at", "round"):
            descending = params.order == pagination.SortOrder.DESC or params.order == "desc"
            sort_column = encounters_query.c[params.sort]
            query = query.order_by(
                (sort_column.desc() if descending else sort_column.asc()).nulls_last(),
                encounters_query.c.id.desc() if descending else encounters_query.c.id.asc(),
                models.Match.map_index.asc().nulls_last(),
                models.Match.id.asc(),
            )
        else:
            query = params.apply_sort(query)
        result = await session.execute(query)
        total_result = await session.execute(total_query)
        # Custom identity — the row contains a `jsonb_agg` list (heroes) which
        # isn't hashable, so the default `.unique()` blows up.
        return (
            result.unique(_encounter_match_identity).all(),  # type: ignore[arg-type]
            total_result.scalar_one(),
        )

    async def get_settled_map_ids(
        self,
        session: AsyncSession,
        ids: list[int],
    ) -> dict[int, list[int]]:
        """Play-order map ids per encounter, from pick-ban entries."""
        if not ids:
            return {}
        pick_ban_rows = (
            await session.execute(
                sa.select(
                    PickBanSession.encounter_id,
                    PickBanEntry.item_id,
                    PickBanEntry.status,
                    PickBanEntry.action_index,
                    PickBanEntry.order,
                )
                .join(PickBanEntry, PickBanEntry.session_id == PickBanSession.id)
                .where(
                    PickBanSession.encounter_id.in_(tuple(ids)),
                    PickBanSession.kind == PickBanKind.MAP,
                )
            )
        ).all()
        grouped: dict[int, list[tuple[object, object, object, object]]] = {}
        for encounter_id, item_id, status, action_index, order in pick_ban_rows:
            grouped.setdefault(int(encounter_id), []).append((item_id, status, action_index, order))
        return {encounter_id: _mappers.settled_map_ids(rows) for encounter_id, rows in grouped.items() if rows}

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

        roles: dict[int, list[str]] = {}
        for member_id, role in (
            await session.execute(
                sa.select(models.EncounterTeamMemberRole.team_member_id, models.EncounterTeamMemberRole.role)
                .join(
                    models.EncounterTeamMember,
                    models.EncounterTeamMember.id == models.EncounterTeamMemberRole.team_member_id,
                )
                .where(
                    models.EncounterTeamMember.encounter_id.in_(ids),
                    models.EncounterTeamMember.active.is_(True),
                    models.EncounterTeamMemberRole.dimension == "player_role",
                )
                .order_by(models.EncounterTeamMemberRole.team_member_id, models.EncounterTeamMemberRole.role)
            )
        ).all():
            roles.setdefault(member_id, []).append(role)
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
                _mappers.RosterEntry(member=member, user_id=user_id, roles=tuple(roles.get(member.id, ())))
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
                models.MatchStatistics.user_id.label("user_id"),
                models.MatchStatistics.match_id.label("match_id"),
                sa.func.max(
                    sa.case(
                        (
                            models.MatchStatistics.name == enums.LogStatsName.ImpactRank,
                            models.MatchStatistics.value,
                        )
                    )
                ).label("impact_rank"),
                sa.func.max(
                    sa.case(
                        (
                            models.MatchStatistics.name == enums.LogStatsName.Performance,
                            models.MatchStatistics.value,
                        )
                    )
                ).label("performance"),
            )
            .select_from(models.MatchStatistics)
            .join(models.Match, models.Match.id == models.MatchStatistics.match_id)
            .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
            .where(
                sa.and_(
                    models.MatchStatistics.user_id.in_(user_ids),
                    models.MatchStatistics.name.in_([enums.LogStatsName.ImpactRank, enums.LogStatsName.Performance]),
                    models.MatchStatistics.hero_id.is_(None),
                    models.MatchStatistics.round == 0,
                    models.Encounter.tournament_id.in_(tournament_ids),
                )
            )
            .group_by(
                models.Encounter.tournament_id,
                models.MatchStatistics.user_id,
                models.MatchStatistics.match_id,
            )
            .cte("roster_mvp_per_match")
        )

        placement = sa.func.coalesce(per_match.c.impact_rank, per_match.c.performance)

        query = (
            sa.select(
                per_match.c.tournament_id,
                per_match.c.user_id,
                sa.func.avg(placement).label("avg_mvp"),
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
                models.MatchStatistics.user_id.label("user_id"),
                models.MatchStatistics.hero_id.label("hero_id"),
                sa.func.sum(models.MatchStatistics.value).label("playtime"),
            )
            .select_from(models.MatchStatistics)
            .join(models.Match, models.Match.id == models.MatchStatistics.match_id)
            .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
            .where(
                sa.and_(
                    models.MatchStatistics.user_id.in_(user_ids),
                    models.MatchStatistics.name == enums.LogStatsName.HeroTimePlayed,
                    models.MatchStatistics.hero_id.isnot(None),
                    models.MatchStatistics.value > 60,
                    models.MatchStatistics.round == 0,
                    models.Encounter.tournament_id.in_(tournament_ids),
                )
            )
            .group_by(
                models.Encounter.tournament_id,
                models.MatchStatistics.user_id,
                models.MatchStatistics.hero_id,
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
                models.MatchStatistics.hero_id.label("hero_id"),
                models.MatchStatistics.team_id.label("team_id"),
                models.Match.id.label("match_id"),
            )
            .select_from(models.MatchStatistics)
            .join(models.Match, models.Match.id == models.MatchStatistics.match_id)
            .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
            .where(
                sa.and_(
                    models.MatchStatistics.user_id == user_id,
                    models.MatchStatistics.name == enums.LogStatsName.HeroTimePlayed,
                    models.MatchStatistics.hero_id.isnot(None),
                    models.MatchStatistics.value > min_seconds,
                    models.MatchStatistics.round == 0,
                )
            )
        )
        if workspace_id is not None:
            hero_match_q = hero_match_q.join(
                models.Tournament, models.Tournament.id == models.Encounter.tournament_id
            ).where(models.Tournament.workspace_id == workspace_id)

        hero_match = hero_match_q.group_by(
            models.MatchStatistics.hero_id,
            models.MatchStatistics.team_id,
            models.Match.id,
        ).cte("draft_card_hero_match")

        team_score = sa.case(
            (models.Match.home_team_id == hero_match.c.team_id, models.Match.home_score),
            else_=models.Match.away_score,
        )
        opponent_score = sa.case(
            (models.Match.home_team_id == hero_match.c.team_id, models.Match.away_score),
            else_=models.Match.home_score,
        )
        maps = sa.func.count(hero_match.c.match_id)
        maps_won = sa.func.sum(sa.case((team_score > opponent_score, 1), else_=0))

        query = (
            sa.select(models.CatalogEntity, maps.label("maps"), maps_won.label("maps_won"))
            .select_from(hero_match)
            .join(models.Match, models.Match.id == hero_match.c.match_id)
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
                models.MatchStatistics.match_id.label("match_id"),
                sa.func.max(
                    sa.case(
                        (
                            models.MatchStatistics.name == enums.LogStatsName.ImpactRank,
                            models.MatchStatistics.value,
                        )
                    )
                ).label("impact_rank"),
                sa.func.max(
                    sa.case(
                        (
                            models.MatchStatistics.name == enums.LogStatsName.Performance,
                            models.MatchStatistics.value,
                        )
                    )
                ).label("performance"),
            )
            .select_from(models.MatchStatistics)
            .join(models.Match, models.Match.id == models.MatchStatistics.match_id)
            .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
            .where(
                sa.and_(
                    models.MatchStatistics.user_id == user_id,
                    models.MatchStatistics.name.in_([enums.LogStatsName.ImpactRank, enums.LogStatsName.Performance]),
                    models.MatchStatistics.hero_id.is_(None),
                    models.MatchStatistics.round == 0,
                )
            )
        )
        if workspace_id is not None:
            per_match = per_match.join(models.Tournament, models.Tournament.id == models.Encounter.tournament_id).where(
                models.Tournament.workspace_id == workspace_id
            )

        per_match = per_match.group_by(models.MatchStatistics.match_id).cte("draft_card_mvp_per_match")
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
