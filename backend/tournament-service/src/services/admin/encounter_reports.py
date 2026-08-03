"""Cross-tournament admin list of captain reports.

The unit of the list is the *encounter*, not the report: a dispute spans two
reports and the action that settles it is per-encounter, so a row that showed
one report could never carry the resolve action.

Three things here refuse to be computed in Python:

* ``reported_count`` and whether the two sides agree drive both a filter and a
  filter chip, so they must be expressible in SQL — a page-local computation
  would make ``mismatch_only`` return the wrong rows and the chips count only
  the current page.
* ``last_resolution`` is the newest audit row per encounter, fetched with one
  window function rather than a query per row.
* the stats counters deliberately ignore the chip filters themselves, so each
  chip reports how many rows it *would* select rather than how many are
  currently shown.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from shared.core import pagination
from src import models
from src.schemas.admin.encounter_reports import (
    CaptainReportRead,
    EncounterMapCodeRead,
    EncounterReportsRow,
    EncounterReportsSearchParams,
    EncounterReportsStats,
    EncounterTeamRef,
    LastResolutionRead,
    valid_series_scores,
)

__all__ = ("get_reports_stats", "list_encounter_reports")


def _report_aggregate() -> sa.Subquery:
    """Per encounter: how many captains reported, and how many distinct scores.

    ``count(DISTINCT ROW(...))`` rather than ``count(DISTINCT (a, b))`` — the
    latter parses as a two-argument aggregate and Postgres rejects DISTINCT on
    those. With this, "the sides agree" is ``distinct_scores = 1``.
    """
    report = models.EncounterCaptainReport
    return (
        sa.select(
            report.encounter_id.label("encounter_id"),
            sa.func.count().label("reported_count"),
            sa.func.count(sa.distinct(sa.func.row(report.home_score, report.away_score))).label("distinct_scores"),
        )
        .group_by(report.encounter_id)
        .subquery("report_agg")
    )


def _last_audit() -> sa.Subquery:
    """The newest audit row per encounter — one window pass, not N+1."""
    audit = models.EncounterResultAudit
    ranked = sa.select(
        audit.encounter_id.label("encounter_id"),
        audit.action.label("action"),
        audit.actor_user_id.label("actor_user_id"),
        audit.created_at.label("created_at"),
        sa.func.row_number()
        .over(partition_by=audit.encounter_id, order_by=(audit.created_at.desc(), audit.id.desc()))
        .label("rn"),
    ).subquery("audit_ranked")
    return sa.select(ranked).where(ranked.c.rn == 1).subquery("last_audit")


class _Query:
    """Shared joins and predicates for the list and its stats.

    Both surfaces must agree on what "in scope" means, so the scope predicates
    are built once. The chip predicates are kept separate because the stats
    deliberately drop them.
    """

    def __init__(self, workspace_id: int, params: EncounterReportsSearchParams) -> None:
        self.params = params
        self.agg = _report_aggregate()
        self.audit = _last_audit()
        self.home = aliased(models.Team, name="home_team")
        self.away = aliased(models.Team, name="away_team")
        self.workspace_id = workspace_id

    def join(self, query: sa.Select) -> sa.Select:
        return (
            query.join(models.Tournament, models.Tournament.id == models.Encounter.tournament_id)
            .outerjoin(self.agg, self.agg.c.encounter_id == models.Encounter.id)
            .outerjoin(self.home, self.home.id == models.Encounter.home_team_id)
            .outerjoin(self.away, self.away.id == models.Encounter.away_team_id)
        )

    def scope_predicates(self) -> list[sa.ColumnElement[bool]]:
        """Where the admin is looking: workspace, tournament, stage, free text."""
        params = self.params
        where: list[sa.ColumnElement[bool]] = [models.Tournament.workspace_id == self.workspace_id]
        if params.tournament_id is not None:
            where.append(models.Encounter.tournament_id == params.tournament_id)
        if params.stage_id is not None:
            where.append(models.Encounter.stage_id == params.stage_id)
        if params.query:
            like = f"%{params.query}%"
            where.append(
                sa.or_(
                    models.Encounter.name.ilike(like),
                    self.home.name.ilike(like),
                    self.away.name.ilike(like),
                )
            )
        return where

    def chip_predicates(self) -> list[sa.ColumnElement[bool]]:
        """What the admin narrowed to inside that scope."""
        params = self.params
        where: list[sa.ColumnElement[bool]] = []
        if params.result_status:
            where.append(models.Encounter.result_status.in_(params.result_status))
        if params.mismatch_only:
            where.append(sa.and_(self.agg.c.reported_count >= 2, self.agg.c.distinct_scores > 1))
        if params.reported_count is not None:
            # A zero has to match rows with no aggregate row at all.
            if params.reported_count == 0:
                where.append(self.agg.c.reported_count.is_(None))
            else:
                where.append(self.agg.c.reported_count == params.reported_count)
        return where


def _team_ref(team: models.Team | None) -> EncounterTeamRef | None:
    if team is None:
        return None
    return EncounterTeamRef(id=team.id, name=team.name)


def _report_read(report: models.EncounterCaptainReport, encounter: models.Encounter) -> CaptainReportRead:
    side: str | None = None
    if report.team_id == encounter.home_team_id:
        side = "home"
    elif report.team_id == encounter.away_team_id:
        side = "away"
    return CaptainReportRead(
        id=report.id,
        encounter_id=report.encounter_id,
        team_id=report.team_id,
        side=side,
        reporter_user_id=report.reporter_user_id,
        reporter_name=report.reporter.name if report.reporter else None,
        home_score=report.home_score,
        away_score=report.away_score,
        closeness=report.closeness,
        map_codes=[
            EncounterMapCodeRead(id=c.id, map_index=c.map_index, map_id=c.map_id, code=c.code)
            for c in report.map_codes
        ],
        created_at=report.created_at.isoformat() if report.created_at else None,
        updated_at=report.updated_at.isoformat() if report.updated_at else None,
    )


def _series_valid(encounter: models.Encounter, reports: Sequence[models.EncounterCaptainReport]) -> bool:
    """Advisory: reports predate per-round best_of, so a mismatch is information.

    No reports means nothing contradicts the series length — reported as valid
    rather than as a violation nobody can act on.
    """
    if not reports:
        return True
    allowed = valid_series_scores(encounter.best_of)
    if not allowed:
        return True
    return all((r.home_score, r.away_score) in allowed for r in reports)


def _row(
    encounter: models.Encounter,
    reported_count: int | None,
    distinct_scores: int | None,
    resolution: LastResolutionRead | None,
) -> EncounterReportsRow:
    reports = list(encounter.captain_reports)
    by_side = {r.team_id: r for r in reports}
    home_report = by_side.get(encounter.home_team_id) if encounter.home_team_id else None
    away_report = by_side.get(encounter.away_team_id) if encounter.away_team_id else None
    count = int(reported_count or 0)
    return EncounterReportsRow(
        id=encounter.id,
        name=encounter.name,
        tournament_id=encounter.tournament_id,
        tournament_name=encounter.tournament.name if encounter.tournament else None,
        stage_name=(encounter.stage_item.name if encounter.stage_item else None)
        or (encounter.stage.name if encounter.stage else None),
        round=encounter.round,
        best_of=encounter.best_of,
        status=encounter.status,
        result_status=encounter.result_status,
        scheduled_at=encounter.scheduled_at,
        home_team=_team_ref(encounter.home_team),
        away_team=_team_ref(encounter.away_team),
        home_report=_report_read(home_report, encounter) if home_report else None,
        away_report=_report_read(away_report, encounter) if away_report else None,
        reported_count=count,
        # Undecided until both sides have answered: "they disagree" and "only one
        # has reported" are different states and the UI must not conflate them.
        scores_match=(distinct_scores == 1) if count >= 2 else None,
        series_score_valid=_series_valid(encounter, reports),
        last_resolution=resolution,
    )


async def list_encounter_reports(
    session: AsyncSession,
    *,
    workspace_id: int,
    params: EncounterReportsSearchParams,
) -> pagination.Paginated[EncounterReportsRow]:
    builder = _Query(workspace_id, params)
    where = builder.scope_predicates() + builder.chip_predicates()

    actor = aliased(models.User, name="audit_actor")
    query = (
        builder.join(
            sa.select(
                models.Encounter,
                builder.agg.c.reported_count,
                builder.agg.c.distinct_scores,
                builder.audit.c.action,
                builder.audit.c.actor_user_id,
                builder.audit.c.created_at.label("resolved_at"),
                actor.name.label("actor_name"),
            )
        )
        .outerjoin(builder.audit, builder.audit.c.encounter_id == models.Encounter.id)
        .outerjoin(actor, actor.id == builder.audit.c.actor_user_id)
        .where(*where)
        .options(
            selectinload(models.Encounter.captain_reports).selectinload(models.EncounterCaptainReport.reporter),
            selectinload(models.Encounter.home_team),
            selectinload(models.Encounter.away_team),
            selectinload(models.Encounter.tournament),
            selectinload(models.Encounter.stage),
            selectinload(models.Encounter.stage_item),
        )
        .order_by(models.Encounter.updated_at.desc().nullslast(), models.Encounter.id.desc())
        .offset((params.page - 1) * params.per_page)
        .limit(params.per_page)
    )

    total_query = builder.join(sa.select(sa.func.count()).select_from(models.Encounter)).where(*where)

    rows = (await session.execute(query)).unique().all()
    total = (await session.execute(total_query)).scalar_one()

    results = [
        _row(
            row[0],
            row.reported_count,
            row.distinct_scores,
            LastResolutionRead(
                action=row.action,
                actor_user_id=row.actor_user_id,
                actor_name=row.actor_name,
                created_at=row.resolved_at,
            )
            if row.action is not None
            else None,
        )
        for row in rows
    ]
    return pagination.Paginated(
        page=params.page,
        per_page=params.per_page,
        total=total,
        results=results,
    )


async def get_reports_stats(
    session: AsyncSession,
    *,
    workspace_id: int,
    params: EncounterReportsSearchParams,
) -> EncounterReportsStats:
    """Counters for the filter chips.

    Scoped by tournament/stage/search but **not** by the chip filters: a chip
    must say how many rows it would select, not how many survive its own
    selection. Selecting "disputed" otherwise zeroes every other chip.
    """
    builder = _Query(workspace_id, params)
    scope = builder.scope_predicates()

    by_status_query = (
        builder.join(sa.select(models.Encounter.result_status, sa.func.count()).select_from(models.Encounter))
        .where(*scope)
        .group_by(models.Encounter.result_status)
    )
    by_status = {status.value: int(count) for status, count in (await session.execute(by_status_query)).all()}

    counts_query = builder.join(
        sa.select(
            sa.func.count()
            .filter(sa.and_(builder.agg.c.reported_count >= 2, builder.agg.c.distinct_scores > 1))
            .label("mismatch"),
            sa.func.count().filter(builder.agg.c.reported_count == 1).label("awaiting_second"),
        ).select_from(models.Encounter)
    ).where(*scope)
    counts = (await session.execute(counts_query)).one()

    return EncounterReportsStats(
        by_result_status=by_status,
        mismatch_count=int(counts.mismatch),
        awaiting_second_count=int(counts.awaiting_second),
    )
