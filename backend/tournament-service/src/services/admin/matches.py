"""Workspace-scoped admin reads over native observed OW duel matches."""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from shared.core import http_status as status
from shared.core import pagination
from shared.core.errors import BaseAPIException as HTTPException
from shared.repository.stats_queries import player_facts
from shared.repository.stats_reads import MatchReadContext, duel_matches, get_match_reads
from src import models, schemas

__all__ = ("matches_service",)
_NOT_FOUND = "Match not found"


class _Query:
    def __init__(self, workspace_id: int, params: schemas.AdminMatchesSearchParams) -> None:
        self.matches = duel_matches(discipline="overwatch")
        d = self.matches.c
        home, away = aliased(models.Team), aliased(models.Team)
        self.query = (
            sa.select(d.id)
            .select_from(self.matches)
            .join(models.Encounter, models.Encounter.id == d.encounter_id)
            .join(
                models.Tournament,
                sa.and_(
                    models.Tournament.id == d.tournament_id,
                    models.Tournament.workspace_id == d.workspace_id,
                    models.Tournament.discipline == d.discipline,
                ),
            )
            .outerjoin(home, home.id == d.home_tournament_team_id)
            .outerjoin(away, away.id == d.away_tournament_team_id)
            .outerjoin(
                models.IngestJob,
                sa.and_(
                    models.IngestJob.id == d.ingest_job_id,
                    models.IngestJob.workspace_id == d.workspace_id,
                    models.IngestJob.discipline == d.discipline,
                ),
            )
            .where(d.workspace_id == workspace_id)
        )
        predicates = []
        if params.tournament_id is not None:
            predicates.append(d.tournament_id == params.tournament_id)
        if params.encounter_id is not None:
            predicates.append(d.encounter_id == params.encounter_id)
        if params.map_id is not None:
            predicates.append(d.map_entity_id == params.map_id)
        if params.query:
            like = f"%{params.query}%"
            predicates.append(
                sa.or_(models.IngestJob.filename.ilike(like), home.name.ilike(like), away.name.ilike(like))
            )
        if params.log_status:
            predicates.append(models.IngestJob.status.in_(params.log_status))
        if params.unlinked_only:
            predicates.append(d.ingest_job_id.is_(None))
        self.query = self.query.where(*predicates)


def _team_ref(team: models.Team | None) -> schemas.EncounterTeamRef | None:
    return schemas.EncounterTeamRef(id=team.id, name=team.name) if team is not None else None


def _log_record_ref(job: models.IngestJob | None) -> schemas.LogRecordRef | None:
    if job is None:
        return None
    return schemas.LogRecordRef(
        id=job.id,
        filename=job.filename,
        status=job.status,
        source=job.source_kind,
        uploader_id=job.uploader_user_id,
        attempts=job.attempts,
        error_message=job.error_message,
        created_at=job.created_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )


def _row_fields(read: MatchReadContext) -> dict[str, Any]:
    match, encounter = read.match, read.encounter
    tournament = encounter.tournament
    return {
        "id": match.id,
        "encounter_id": encounter.id,
        "encounter_name": encounter.name,
        "tournament_id": tournament.id,
        "tournament_name": tournament.name,
        "map_id": match.map_entity_id,
        "map_name": read.map.name,
        "home_team": _team_ref(read.home_team),
        "away_team": _team_ref(read.away_team),
        "home_score": read.home_score,
        "away_score": read.away_score,
        "time": match.duration_s,
        "log_name": read.display_filename,
        "created_at": match.created_at,
        "log_record": _log_record_ref(read.job),
    }


class AdminMatchesService:
    async def list_admin_matches(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        params: schemas.AdminMatchesSearchParams,
    ) -> pagination.Paginated[schemas.AdminMatchRow]:
        builder = _Query(workspace_id, params)
        total = int(
            await session.scalar(sa.select(sa.func.count()).select_from(builder.query.distinct().subquery())) or 0
        )
        ids = (
            list(
                (
                    await session.scalars(
                        params.apply_pagination(
                            builder.query.order_by(
                                builder.matches.c.created_at.desc(),
                                builder.matches.c.id.desc(),
                            )
                        )
                    )
                ).all()
            )
            if not params.only_count
            else []
        )
        reads = await get_match_reads(
            session, match_ids=ids, encounter_options=[selectinload(models.Encounter.tournament)]
        )
        return pagination.Paginated(
            page=params.page,
            per_page=params.per_page,
            total=total,
            results=[schemas.AdminMatchRow(**_row_fields(reads[id])) for id in ids],
        )

    async def get_admin_match(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        match_id: int,
    ) -> schemas.AdminMatchDetail:
        builder = _Query(workspace_id, schemas.AdminMatchesSearchParams())
        scoped_id = await session.scalar(builder.query.where(builder.matches.c.id == match_id))
        if scoped_id is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
        read = (
            await get_match_reads(
                session,
                match_ids=[match_id],
                encounter_options=[selectinload(models.Encounter.tournament)],
            )
        )[match_id]
        facts = player_facts(discipline="overwatch").c
        statistics_count, max_segment = (
            await session.execute(
                sa.select(sa.func.count(), sa.func.max(facts.segment)).where(facts.match_id == match_id)
            )
        ).one()
        event, kind = models.StatsEvent, models.EventType
        kills, events = (
            await session.execute(
                sa.select(sa.func.count().filter(kind.code == "kill"), sa.func.count().filter(kind.code != "kill"))
                .select_from(event)
                .join(kind, sa.and_(kind.id == event.type_id, kind.discipline == "overwatch"))
                .where(event.match_id == match_id)
            )
        ).one()
        return schemas.AdminMatchDetail(
            **_row_fields(read),
            rounds=int(max_segment or 0),
            statistics_count=int(statistics_count),
            kill_feed_count=int(kills),
            event_count=int(events),
        )


matches_service = AdminMatchesService()
