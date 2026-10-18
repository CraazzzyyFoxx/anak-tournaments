"""Read/validation helpers for the match-log admin surface.

Extracted verbatim from the former ``src/routes/admin/logs.py`` HTTP route so the
typed-RPC handlers (``src/rpc/logs.py``) can reuse them after the FastAPI face was
removed.

``HTTPException`` here is ``fastapi.HTTPException`` on purpose: the stats RPC
envelope (``src/rpc/_common.py``) maps ``fastapi.HTTPException`` onto the
``{ok,data,error}`` envelope, and a Starlette base-class instance would not be
caught by that ``except`` clause (it is a strict subclass). The rest of the
``src/services/match_logs`` layer (``uploads.py``) raises the same type.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence

import httpx
from loguru import logger
from sqlalchemy import ColumnElement, and_, case, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.messaging.config import ingest_queue, ingest_replay_queue
from shared.repository import EncounterRepository
from src import models, schemas
from src.core import config

# The ingest and replay queues of every discipline this deployment serves (STATS_DISCIPLINES), then the shared fanout queues.
MONITORED_QUEUES = [
    *(ingest_queue(spec.code).name for spec in config.settings.selected_disciplines),
    *(ingest_replay_queue(spec.code).name for spec in config.settings.selected_disciplines),
    "process_tournament_logs",
    "discord_commands",
    "balancer_jobs",
]


async def _fetch_queue_depths() -> list[schemas.QueueDepth]:
    """Query RabbitMQ Management API for queue depths."""
    cfg = config.settings
    base = cfg.rabbitmq_management_url.rstrip("/")
    auth_tuple = (cfg.rabbitmq_management_user, cfg.rabbitmq_management_password)

    def _error_depth(queue_name: str, depth_status: str = "error") -> schemas.QueueDepth:
        return schemas.QueueDepth(
            name=queue_name,
            messages_ready=-1,
            messages_unacknowledged=-1,
            consumers=0,
            status=depth_status,
        )

    async def _one(client: httpx.AsyncClient, queue_name: str) -> schemas.QueueDepth:
        url = f"{base}/api/queues/%2F/{queue_name}"
        resp = await client.get(url, auth=auth_tuple)
        if resp.status_code != 200:
            return _error_depth(queue_name, "not_found" if resp.status_code == 404 else "error")
        data = resp.json()
        return schemas.QueueDepth(
            name=queue_name,
            messages_ready=data.get("messages_ready", 0),
            messages_unacknowledged=data.get("messages_unacknowledged", 0),
            consumers=data.get("consumers", 0),
        )

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            return list(await asyncio.gather(*(_one(client, queue_name) for queue_name in MONITORED_QUEUES)))
    except Exception as exc:
        logger.warning(f"Failed to fetch queue depths from RabbitMQ management API: {exc}")
        return [_error_depth(queue_name) for queue_name in MONITORED_QUEUES]


def history_query():
    job, match, encounter = models.IngestJob, models.StatsMatch, models.Encounter
    linked = (
        select(
            match.ingest_job_id,
            func.count().label("observations"),
            func.count(func.distinct(match.encounter_id)).label("owners"),
            func.min(match.encounter_id).label("encounter_id"),
            func.count(func.distinct(encounter.tournament_id)).label("tournaments"),
            func.min(encounter.tournament_id).label("tournament_id"),
            func.min(match.encounter_game_id).label("game_id"),
            func.max(match.revision).label("revision"),
        )
        .join(encounter, encounter.id == match.encounter_id)
        .where(match.ingest_job_id.is_not(None))
        .group_by(match.ingest_job_id)
        .subquery()
    )
    tournament_id = case(
        (linked.c.tournaments == 1, linked.c.tournament_id),
        (linked.c.observations.is_(None), job.hint_tournament_id),
    )
    encounter_id = case(
        (linked.c.owners == 1, linked.c.encounter_id),
        (linked.c.observations.is_(None), job.hint_encounter_id),
    )
    game_id = case(
        (linked.c.observations == 1, linked.c.game_id),
        (linked.c.observations.is_(None), job.hint_encounter_game_id),
    )
    return (
        select(
            job,
            models.Tournament.name,
            encounter.name,
            models.User.name,
            tournament_id,
            encounter_id,
            game_id,
            linked.c.revision,
            linked.c.observations,
        )
        .outerjoin(linked, linked.c.ingest_job_id == job.id)
        .outerjoin(models.Tournament, models.Tournament.id == tournament_id)
        .outerjoin(encounter, encounter.id == encounter_id)
        .outerjoin(models.User, models.User.id == job.uploader_user_id)
    )


def _record_to_dict(
    record: models.IngestJob,
    tournament_name,
    encounter_name,
    uploader_name,
    tournament_id,
    encounter_id,
    game_id,
    revision=None,
    observations=None,
) -> dict:
    # Imported here: the ingest package imports this module's siblings.
    from src.services.ingest.jobs import decode_error

    error = decode_error(record.error_message)
    return {
        "id": record.id,
        "tournament_id": tournament_id,
        "tournament_name": tournament_name,
        "attached_encounter_id": encounter_id,
        "attached_encounter_game_id": game_id,
        "attached_encounter_name": encounter_name,
        "filename": record.filename,
        "status": record.status.value,
        "source": record.source_kind,
        "raw_status": record.raw_status,
        "raw_available": record.raw_available,
        "uploader_name": uploader_name,
        "error_message": error.message if error else None,
        "error": error.model_dump(mode="json") if error else None,
        "attempts": record.attempts or 0,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "started_at": record.started_at.isoformat() if record.started_at else None,
        "finished_at": record.finished_at.isoformat() if record.finished_at else None,
        # One observation owned by this job = it is still the current provenance of that game.
        "observation_revision": revision if observations == 1 else None,
        "is_current_provenance": observations == 1,
    }


async def document_teams(s3, records: Sequence[models.IngestJob]) -> dict[int, list[dict]]:
    """Job id -> its document's teams in canonical order, for the records among ``records`` a bind accepts (``awaiting_link`` and ``failed``) that kept a stored document.

    The operator's bind team map is keyed by these. Best effort: a record whose stored document cannot be read
    keeps an empty list (the page itself must not fail on one object).
    """
    from src.services.ingest.jobs import load_document

    gate = asyncio.Semaphore(8)

    async def one(record: models.IngestJob) -> tuple[int, list[dict]]:
        async with gate:
            try:
                doc, _ = await load_document(s3, record.document_ref)
            except (LookupError, ValueError):
                return record.id, []
        handles: dict[str, list[str]] = {team.key: [] for team in doc.teams}
        for person in doc.participants:
            handles[person.team].append(person.identity.id)
        return record.id, [
            {"key": team.key, "source_position": position, "participants": handles[team.key][:12]}
            for position, team in enumerate(doc.teams, start=1)
        ]

    parked = [
        r
        for r in records
        if r.status in (models.IngestJobStatus.AWAITING_LINK, models.IngestJobStatus.FAILED) and r.document_ref
    ]
    return dict(await asyncio.gather(*(one(record) for record in parked)))


def history_scope_conditions(
    *,
    tournament_id: int | None,
    encounter_id: int | None,
    workspace_id: int | None,
) -> list[ColumnElement[bool]]:
    """Linked observations own their scope; only an unlinked upload uses hints."""
    job, match, encounter = models.IngestJob, models.StatsMatch, models.Encounter
    linked = exists().where(match.ingest_job_id == job.id).correlate(job)
    owned = (
        select(match.id)
        .join(encounter, encounter.id == match.encounter_id)
        .where(match.ingest_job_id == job.id, match.workspace_id == job.workspace_id)
        .correlate(job)
    )
    conditions: list[ColumnElement[bool]] = []
    if tournament_id is not None:
        conditions.append(
            or_(
                owned.where(encounter.tournament_id == tournament_id).exists(),
                and_(~linked, job.hint_tournament_id == tournament_id),
            )
        )
    if encounter_id is not None:
        conditions.append(
            or_(
                owned.where(match.encounter_id == encounter_id).exists(),
                and_(~linked, job.hint_encounter_id == encounter_id),
            )
        )
    if workspace_id is not None:
        conditions.append(models.IngestJob.workspace_id == workspace_id)
    return conditions


def history_search_condition(search: str | None) -> ColumnElement[bool] | None:
    """Case-insensitive match across the fields the console renders per row.

    Searching used to happen in the browser over the current page only, so a term
    matching a record two pages down found nothing. Uploader/encounter names live
    on related rows and are matched with EXISTS for the same composability reason
    as the workspace scope.
    """
    term = (search or "").strip()
    if not term:
        return None

    # Escape LIKE wildcards so a filename containing "_" stays a literal match.
    pattern = "%{}%".format(term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_"))
    return or_(
        models.IngestJob.filename.ilike(pattern, escape="\\"),
        models.IngestJob.error_message.ilike(pattern, escape="\\"),
        exists()
        .where(models.User.id == models.IngestJob.uploader_user_id, models.User.name.ilike(pattern, escape="\\"))
        .correlate(models.IngestJob),
        select(models.StatsMatch.id)
        .join(models.Encounter, models.Encounter.id == models.StatsMatch.encounter_id)
        .where(
            models.StatsMatch.ingest_job_id == models.IngestJob.id,
            models.StatsMatch.workspace_id == models.IngestJob.workspace_id,
            models.Encounter.name.ilike(pattern, escape="\\"),
        )
        .correlate(models.IngestJob)
        .exists(),
        and_(
            ~exists().where(models.StatsMatch.ingest_job_id == models.IngestJob.id).correlate(models.IngestJob),
            exists()
            .where(
                models.Encounter.id == models.IngestJob.hint_encounter_id,
                models.Encounter.name.ilike(pattern, escape="\\"),
            )
            .correlate(models.IngestJob),
        ),
    )


async def _validate_attached_encounter(
    session: AsyncSession,
    *,
    tournament_id: int,
    encounter_id: int | None,
) -> models.Encounter | None:
    if encounter_id is None:
        return None

    result = await session.execute(EncounterRepository().select().where(models.Encounter.id == encounter_id).limit(1))
    encounter = result.scalar_one_or_none()
    if encounter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Encounter not found")
    if encounter.tournament_id != tournament_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Encounter does not belong to this tournament",
        )
    return encounter
