"""Cross-tournament admin list of parsed matches, plus the single-match detail.

The unit is one ``matches.match`` row — one played map produced by the log
parser. Three things shape the queries:

* Workspace scoping runs through ``Encounter -> Tournament``; ``Match`` carries no
  workspace of its own. The join is therefore not decoration, it is the tenancy
  boundary, and it is the same join for the page and for the total.
* The log record is a LEFT join and stays one. Most rows do not resolve a record
  at all — ``log_processing.record`` postdates the bulk of the match history — so
  an inner join, or a status predicate applied unconditionally, would hide almost
  the whole table.
* The stat counts are detail-only (NFR 3). ``statistics`` / ``kill_feed`` /
  ``assists`` are the hot tables; three aggregates per row would be three scans
  per page.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from shared.core import enums, pagination
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.models.ingestion.log_processing import LogProcessingRecord
from src import models
from src.schemas.admin.encounter_reports import EncounterTeamRef
from src.schemas.admin.matches import (
    AdminMatchDetail,
    AdminMatchesSearchParams,
    AdminMatchRow,
    LogRecordRef,
)

__all__ = ("matches_service",)

#: One message for "no such match" and for "not in your workspace". Telling them
#: apart would make this endpoint an id oracle for other tenants.
_NOT_FOUND = "Match not found"


class _Query:
    """Shared joins and predicates for the list and its total.

    Both must agree on what is in scope, or the page and the count disagree and
    pagination reports a total it will never show.
    """

    def __init__(self, workspace_id: int, params: AdminMatchesSearchParams) -> None:
        self.params = params
        self.workspace_id = workspace_id
        # A WHERE clause cannot reach through an eager load, so the relations a
        # filter or the free-text search touches are joined explicitly too.
        self.home = aliased(models.Team, name="home_team")
        self.away = aliased(models.Team, name="away_team")
        self.record = aliased(LogProcessingRecord, name="log_record")

    def join(self, query: sa.Select) -> sa.Select:
        return (
            query.join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
            .join(models.Tournament, models.Tournament.id == models.Encounter.tournament_id)
            .outerjoin(self.home, self.home.id == models.Match.home_team_id)
            .outerjoin(self.away, self.away.id == models.Match.away_team_id)
            .outerjoin(self.record, self.record.id == models.Match.log_record_id)
        )

    def scope_predicates(self) -> list[sa.ColumnElement[bool]]:
        """Which rows exist for this caller: workspace, then where they look."""
        params = self.params
        where: list[sa.ColumnElement[bool]] = [
            models.Tournament.workspace_id == self.workspace_id,
            # This view's unit is "one played map the log parser produced"
            # (module docstring) — a source=captain_report Match (no log,
            # no stats) is scored/reconciled elsewhere and does not belong
            # in a log-ingestion health view.
            models.Match.source == enums.MatchSource.LOG_PARSER.value,
        ]
        if params.tournament_id is not None:
            where.append(models.Encounter.tournament_id == params.tournament_id)
        if params.encounter_id is not None:
            where.append(models.Match.encounter_id == params.encounter_id)
        if params.map_id is not None:
            where.append(models.Match.map_id == params.map_id)
        if params.query:
            like = f"%{params.query}%"
            where.append(
                sa.or_(
                    models.Match.log_name.ilike(like),
                    models.Match.code.ilike(like),
                    self.home.name.ilike(like),
                    self.away.name.ilike(like),
                )
            )
        return where

    def provenance_predicates(self) -> list[sa.ColumnElement[bool]]:
        """Narrowing by where the match came from, inside that scope.

        An empty ``log_status`` contributes nothing at all. Folding it into a
        default of "every status" would turn the LEFT join into an inner one and
        drop every row whose record was never resolved — the majority.
        """
        params = self.params
        where: list[sa.ColumnElement[bool]] = []
        if params.log_status:
            where.append(self.record.status.in_(params.log_status))
        if params.unlinked_only:
            where.append(models.Match.log_record_id.is_(None))
        return where


def _load_options() -> tuple[Any, ...]:
    """Everything a row reads, eager-loaded once per page.

    ``Match.log_record`` is ``lazy="raise"``, so it has to be requested
    explicitly. Its own relationships are ``lazy="selectin"`` and would add three
    more round trips per page for data no row uses — ``noload`` keeps them off.
    """
    return (
        selectinload(models.Match.map),
        selectinload(models.Match.home_team),
        selectinload(models.Match.away_team),
        selectinload(models.Match.encounter).selectinload(models.Encounter.tournament),
        selectinload(models.Match.log_record).noload("*"),
    )


def _team_ref(team: models.Team) -> EncounterTeamRef:
    return EncounterTeamRef(id=team.id, name=team.name)


def _log_record_ref(record: LogProcessingRecord | None) -> LogRecordRef | None:
    if record is None:
        return None
    return LogRecordRef(
        id=record.id,
        filename=record.filename,
        status=record.status,
        source=record.source,
        uploader_id=record.uploader_id,
        attempts=record.attempts,
        error_message=record.error_message,
        created_at=record.created_at,
        started_at=record.started_at,
        finished_at=record.finished_at,
    )


def _row_fields(match: models.Match) -> dict[str, Any]:
    """The fields the list row and the detail have in common.

    Built once so the detail cannot drift from the row it extends.

    Every relationship read here is behind a NOT NULL foreign key and is
    inner-joined or eager-loaded by both callers, so no ``if x else None`` guard:
    a missing one is a broken invariant and raising beats emitting a row that
    quietly points at nothing.
    """
    encounter = match.encounter
    tournament = encounter.tournament
    return {
        "id": match.id,
        "encounter_id": match.encounter_id,
        "encounter_name": encounter.name,
        "tournament_id": tournament.id,
        "tournament_name": tournament.name,
        "map_id": match.map_id,
        "map_name": match.map.name,
        "home_team": _team_ref(match.home_team),
        "away_team": _team_ref(match.away_team),
        "home_score": match.home_score,
        "away_score": match.away_score,
        "time": match.time,
        "log_name": match.log_name,
        "code": match.code,
        "created_at": match.created_at,
        "log_record": _log_record_ref(match.log_record),
    }


def _row(match: models.Match) -> AdminMatchRow:
    return AdminMatchRow(**_row_fields(match))


class AdminMatchesService:
    """Read-only admin views over parsed matches.

    Both methods are analytical rather than CRUD — a three-table scope join with
    pagination, and a detail read followed by three aggregate counts — so they stay
    here as ``sa.select`` statements instead of hiding behind repository methods
    (``backend/docs/repository-boundaries.md``). There is nothing to inject.
    """

    async def list_admin_matches(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        params: AdminMatchesSearchParams,
    ) -> pagination.Paginated[AdminMatchRow]:
        builder = _Query(workspace_id, params)
        where = builder.scope_predicates() + builder.provenance_predicates()

        query = (
            builder.join(sa.select(models.Match))
            .where(*where)
            .options(*_load_options())
            # Newest first, always. ``params.sort`` is not consulted: the gateway
            # rebuilds the query model whether or not the client sent the field, so an
            # absent sort is indistinguishable from an explicit "id", and honouring it
            # would silently make "id asc" the default the design asked not to have.
            # ``id desc`` is the tiebreak — one parse writes every map of an encounter
            # in the same transaction, so equal timestamps are the common case, and an
            # order that then falls back to plan order repeats and skips rows between
            # pages.
            .order_by(models.Match.created_at.desc(), models.Match.id.desc())
        )
        # The shared helper, not a hand-rolled offset/limit: it is what honours
        # ``per_page=-1`` (capped) and ``only_count``.
        query = params.apply_pagination(query)

        total_query = builder.join(sa.select(sa.func.count()).select_from(models.Match)).where(*where)

        matches = (await session.execute(query)).unique().scalars().all()
        total = (await session.execute(total_query)).scalar_one()

        return pagination.Paginated(
            page=params.page,
            per_page=params.per_page,
            total=total,
            results=[_row(match) for match in matches],
        )

    async def get_admin_match(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        match_id: int,
    ) -> AdminMatchDetail:
        """One match with its provenance and its stat volumes.

        Scoped by the same ``Encounter -> Tournament`` join the list uses, so a match
        in another workspace is indistinguishable from one that does not exist.
        """
        query = (
            sa.select(models.Match)
            .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
            .join(models.Tournament, models.Tournament.id == models.Encounter.tournament_id)
            .where(
                models.Match.id == match_id,
                models.Tournament.workspace_id == workspace_id,
                models.Match.source == enums.MatchSource.LOG_PARSER.value,
            )
            .options(*_load_options())
        )
        match = (await session.execute(query)).unique().scalar_one_or_none()
        if match is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)

        # One scan per stat table, each on its indexed ``match_id``. ``rounds`` rides
        # along with the statistics count instead of paying for a fourth scan of the
        # largest of the three.
        statistics = (
            await session.execute(
                sa.select(sa.func.count(), sa.func.max(models.MatchStatistics.round))
                .select_from(models.MatchStatistics)
                .where(models.MatchStatistics.match_id == match_id)
            )
        ).one()
        kill_feed_count = await session.scalar(
            sa.select(sa.func.count())
            .select_from(models.MatchKillFeed)
            .where(models.MatchKillFeed.match_id == match_id)
        )
        event_count = await session.scalar(
            sa.select(sa.func.count()).select_from(models.MatchEvent).where(models.MatchEvent.match_id == match_id)
        )

        return AdminMatchDetail(
            **_row_fields(match),
            # MAX over an empty table is NULL; a match whose stats never landed has
            # zero rounds, which is the finding, not an absence of information.
            rounds=int(statistics[1] or 0),
            statistics_count=int(statistics[0]),
            kill_feed_count=int(kill_feed_count or 0),
            event_count=int(event_count or 0),
        )


matches_service = AdminMatchesService()
