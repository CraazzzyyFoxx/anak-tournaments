"""Native ingest-job lifecycle. Callers own processing transactions and commits."""

import hashlib
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core.errors import BaseAPIException
from shared.messaging.config import ACHIEVEMENT_EVALUATE_QUEUE
from shared.messaging.outbox import enqueue_outbox_event
from shared.repository.encounter import EncounterGameRepository
from shared.repository.stats import IngestJobRepository
from shared.repository.tournament import EncounterRepository, TournamentRepository
from shared.schemas.events import AchievementEvaluateEvent
from shared.services.stats_evidence import capture_stats_evidence, owner_scopes, stage_stats_evidence
from src.services.match_logs.realtime import emit_logs_updated


def compute_content_hash(raw_bytes: bytes) -> str:
    return hashlib.sha256(raw_bytes).hexdigest()


#: Plain-text failures and the structured ingest error JSON both fit here; the JSON encoder bounds itself below it.
ERROR_MESSAGE_LIMIT = 16000


async def claim_timestamp(session: AsyncSession, previous: datetime | None) -> datetime:
    """The claim's ``started_at``, read back from the database clock and strictly after the previous claim.

    ``clock_timestamp()`` alone can tie or step back across replicas with skewed clocks, and a late attempt
    is fenced on ``(attempts, started_at)`` -- so every claim must yield a distinct value.
    """
    clock = sa.func.clock_timestamp()
    if previous is not None:
        clock = sa.func.greatest(clock, sa.literal(previous, sa.DateTime(timezone=True)) + timedelta(microseconds=1))
    return await session.scalar(sa.select(clock))


async def reparse_observation(session: AsyncSession, job: models.IngestJob) -> models.StatsMatch | None:
    """Refuse uncertain provenance before retry or any observation replacement."""
    if not job.raw_available:
        raise BaseAPIException(status_code=409, detail=f"stats_raw_unavailable:{job.raw_status}")
    linked = list(
        await session.scalars(sa.select(models.StatsMatch).where(models.StatsMatch.ingest_job_id == job.id).limit(2))
    )
    if len(linked) > 1:
        raise BaseAPIException(status_code=409, detail="stats_reparse_shared_observations")
    observation = linked[0] if linked else None
    if observation is not None:
        if observation.encounter_game_id is None:
            raise BaseAPIException(status_code=409, detail="stats_reparse_unbound_observation")
        if observation.workspace_id != job.workspace_id or observation.discipline != job.discipline:
            raise BaseAPIException(status_code=409, detail="stats_reparse_owner_conflict")
    elif job.source_kind == "historical_reference":
        raise BaseAPIException(status_code=409, detail="stats_reparse_unbound_observation")
    return observation


class LogRecordsService:
    def __init__(self, *, repo: IngestJobRepository = IngestJobRepository()) -> None:
        self._repo = repo

    async def transition(
        self,
        session: AsyncSession,
        job: models.IngestJob,
        status: models.IngestJobStatus,
        *,
        error_message: str | None = None,
        reset_attempts: bool = False,
        now: datetime | None = None,
        document_ref: str | None = None,
    ) -> None:
        scopes = owner_scopes("job", (job.id,))
        before = await capture_stats_evidence(session, scopes=scopes)
        moment = now or datetime.now(UTC)
        job.status = status
        if document_ref is not None:
            # Set after the before-capture so the audit chain's before state is the committed one.
            job.document_ref = document_ref
        job.updated_at = moment
        job.error_message = error_message[:ERROR_MESSAGE_LIMIT] if error_message else None
        if reset_attempts:
            job.attempts = 0
        if status == models.IngestJobStatus.PROCESSING:
            job.attempts += 1
            job.started_at = await claim_timestamp(session, job.started_at)
            job.finished_at = None
        elif status == models.IngestJobStatus.PENDING:
            # started_at keeps meaning "the most recent attempt began", which the next claim replaces.
            job.finished_at = None
        else:
            job.finished_at = moment
        await session.flush()
        after = await capture_stats_evidence(session, scopes=scopes)
        await stage_stats_evidence(
            session,
            operation="stats.job_transition",
            before=before,
            after=after,
            workspace_id=job.workspace_id,
            entity_type="ingest_job",
            entity_id=job.id,
        )
        await emit_logs_updated(session, job.workspace_id, change=status.value)
        await enqueue_outbox_event(
            session,
            AchievementEvaluateEvent(
                workspace_id=job.workspace_id,
                tournament_id=job.hint_tournament_id,
                changed_tables=["stats.ingest_job"],
                source_service="parser-service",
            ),
            exchange="",
            routing_key=ACHIEVEMENT_EVALUATE_QUEUE.name,
        )

    async def retry(
        self,
        session: AsyncSession,
        job_id: int,
        *,
        workspace_id: int,
        encounter_id: int | None = None,
        encounter_game_id: int | None = None,
    ) -> models.IngestJob:
        if encounter_id is not None or encounter_game_id is not None:
            scope = (
                await session.execute(
                    sa.select(
                        models.IngestJob.hint_tournament_id,
                        models.IngestJob.discipline,
                    ).where(models.IngestJob.id == job_id, models.IngestJob.workspace_id == workspace_id)
                )
            ).one_or_none()
            if scope is None:
                raise BaseAPIException(status_code=404, detail="Ingest job not found")
            target = encounter_id
            if target is None:
                target = await session.scalar(
                    sa.select(models.EncounterGame.encounter_id).where(
                        models.EncounterGame.id == encounter_game_id,
                    )
                )
            # A changed FK needs the parent lock before the job lock, just as
            # processing and parent deletion do. Plain retry changes no hints.
            parent = await session.scalar(
                sa.select(models.Encounter.id)
                .where(
                    models.Encounter.id == target,
                    models.Encounter.workspace_id == workspace_id,
                    models.Encounter.tournament_id == scope.hint_tournament_id,
                    models.Encounter.discipline == scope.discipline,
                )
                .with_for_update(read=True)
            )
            if parent is None:
                raise BaseAPIException(status_code=422, detail="stats_upload_hint_conflict")
            if (
                encounter_game_id is not None
                and await session.scalar(
                    sa.select(models.EncounterGame.id)
                    .where(
                        models.EncounterGame.id == encounter_game_id,
                        models.EncounterGame.encounter_id == parent,
                        models.EncounterGame.state != "cancelled",
                    )
                    .with_for_update(read=True)
                )
                is None
            ):
                raise BaseAPIException(status_code=422, detail="stats_upload_hint_conflict")
        job = await self._repo.get_for_update(session, job_id, workspace_id=workspace_id)
        if job is None:
            raise BaseAPIException(status_code=404, detail="Ingest job not found")
        if job.status == models.IngestJobStatus.PROCESSING:
            raise BaseAPIException(status_code=409, detail="Ingest job is already processing")
        if job.status == models.IngestJobStatus.DONE:
            # Observations are replaced only by an explicit reparse that names the revision the operator saw.
            raise BaseAPIException(status_code=409, detail="reparse_required: a done log needs an explicit reparse")
        linked = await reparse_observation(session, job)
        next_encounter = encounter_id if encounter_id is not None else job.hint_encounter_id
        next_game = (
            encounter_game_id
            if encounter_game_id is not None
            else None
            if encounter_id is not None and encounter_id != job.hint_encounter_id
            else job.hint_encounter_game_id
        )
        if encounter_game_id is not None:
            game = await EncounterGameRepository().get(session, encounter_game_id)
            if (
                game is None
                or game.state.value == "cancelled"
                or (next_encounter is not None and game.encounter_id != next_encounter)
            ):
                raise BaseAPIException(status_code=422, detail="stats_upload_hint_conflict")
            next_encounter = game.encounter_id
        if (next_encounter, next_game) != (job.hint_encounter_id, job.hint_encounter_game_id):
            if linked is not None:
                raise BaseAPIException(status_code=409, detail="A linked log cannot be re-attached")
            encounter = await EncounterRepository().get(session, next_encounter)
            if (
                encounter is None
                or encounter.tournament_id != job.hint_tournament_id
                or encounter.workspace_id != job.workspace_id
                or encounter.discipline != job.discipline
            ):
                raise BaseAPIException(status_code=422, detail="stats_upload_hint_conflict")
            scopes = owner_scopes("job", (job.id,))
            before = await capture_stats_evidence(session, scopes=scopes)
            await self._repo.update_hints(session, job, encounter_id=next_encounter, encounter_game_id=next_game)
            after = await capture_stats_evidence(session, scopes=scopes)
            await stage_stats_evidence(
                session,
                operation="stats.job_hint",
                before=before,
                after=after,
                workspace_id=workspace_id,
                entity_type="ingest_job",
                entity_id=job.id,
            )
        await self.transition(session, job, models.IngestJobStatus.PENDING, reset_attempts=True)
        await session.commit()
        return job

    async def requeue_tournament(self, session: AsyncSession, tournament_id: int) -> list[int]:
        tournament = await TournamentRepository().get(session, tournament_id)
        if tournament is None:
            raise BaseAPIException(status_code=404, detail="Tournament not found")
        workspace_id, discipline_code = tournament.workspace_id, tournament.discipline
        ids = []
        cursor = 0
        while True:
            jobs = list(
                await session.scalars(
                    sa.select(models.IngestJob)
                    .where(
                        models.IngestJob.hint_tournament_id == tournament_id,
                        models.IngestJob.workspace_id == workspace_id,
                        models.IngestJob.discipline == discipline_code,
                        models.IngestJob.id > cursor,
                    )
                    .order_by(models.IngestJob.id)
                    .limit(100)
                    .with_for_update()
                )
            )
            if not jobs:
                break
            for job in jobs:
                cursor = job.id
                if job.status == models.IngestJobStatus.PROCESSING:
                    continue
                try:
                    await reparse_observation(session, job)
                except BaseAPIException:
                    continue
                await self.transition(session, job, models.IngestJobStatus.PENDING, reset_attempts=True)
                ids.append(job.id)
            await session.commit()
        return ids


log_records_service = LogRecordsService()
