"""Bidirectional Challonge sync engine.

Import: Challonge -> Local (upsert encounters from Challonge matches)
Export: Local -> Challonge (push encounter results to Challonge)
Auto-push: triggered when encounter result_status becomes 'confirmed'
"""

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src import models
from src.services.challonge import service as challonge_service


async def _log_sync(
    session: AsyncSession,
    tournament_id: int,
    direction: str,
    entity_type: str,
    entity_id: int | None,
    challonge_id: int | None,
    status: str,
    payload: dict | None = None,
    error_message: str | None = None,
) -> models.ChallongeSyncLog:
    entry = models.ChallongeSyncLog(
        tournament_id=tournament_id,
        direction=direction,
        entity_type=entity_type,
        entity_id=entity_id,
        challonge_id=challonge_id,
        status=status,
        payload_json=payload,
        error_message=error_message,
    )
    session.add(entry)
    await session.flush()
    return entry


async def import_tournament(
    session: AsyncSession, tournament_id: int
) -> dict:
    """Full import from Challonge: update encounters with scores and status."""
    result = await session.execute(
        select(models.Tournament)
        .where(models.Tournament.id == tournament_id)
        .options(selectinload(models.Tournament.groups))
    )
    tournament = result.scalar_one_or_none()
    if not tournament or not tournament.challonge_id:
        return {"error": "Tournament has no challonge_id"}

    stats = {"matches_synced": 0, "errors": 0}

    # Build challonge_id -> local encounter mapping
    enc_result = await session.execute(
        select(models.Encounter)
        .where(
            models.Encounter.tournament_id == tournament_id,
            models.Encounter.challonge_id.isnot(None),
        )
    )
    local_encounters = {e.challonge_id: e for e in enc_result.scalars().all()}

    # Build challonge participant_id -> local team mapping
    ct_result = await session.execute(
        select(models.ChallongeTeam)
        .where(models.ChallongeTeam.tournament_id == tournament_id)
    )
    challonge_team_map = {ct.challonge_id: ct.team_id for ct in ct_result.scalars().all()}

    # Fetch matches from Challonge
    try:
        challonge_matches = await challonge_service.fetch_matches(tournament.challonge_id)
    except Exception as e:
        await _log_sync(
            session, tournament_id, "import", "tournament",
            tournament_id, tournament.challonge_id,
            "failed", error_message=str(e),
        )
        await session.commit()
        return {"error": str(e)}

    for cm in challonge_matches:
        try:
            encounter = local_encounters.get(cm.id)
            if not encounter:
                continue  # No local match for this Challonge match

            # Parse scores_csv: "2-1" -> home=2, away=1
            if cm.scores_csv and "-" in cm.scores_csv:
                parts = cm.scores_csv.split("-")
                encounter.home_score = int(parts[0].strip())
                encounter.away_score = int(parts[1].strip())

            if cm.state == "complete":
                encounter.status = "completed"

            stats["matches_synced"] += 1
            await _log_sync(
                session, tournament_id, "import", "match",
                encounter.id, cm.id, "success",
                payload={"scores_csv": cm.scores_csv, "state": cm.state},
            )
        except Exception as e:
            stats["errors"] += 1
            await _log_sync(
                session, tournament_id, "import", "match",
                None, cm.id, "failed", error_message=str(e),
            )

    await session.commit()
    logger.info(f"Challonge import for tournament {tournament_id}: {stats}")
    return stats


async def export_tournament(
    session: AsyncSession, tournament_id: int
) -> dict:
    """Full export: push all completed encounter results to Challonge."""
    result = await session.execute(
        select(models.Tournament).where(models.Tournament.id == tournament_id)
    )
    tournament = result.scalar_one_or_none()
    if not tournament or not tournament.challonge_id:
        return {"error": "Tournament has no challonge_id"}

    stats = {"matches_pushed": 0, "errors": 0}

    # Get completed encounters with challonge_id
    enc_result = await session.execute(
        select(models.Encounter)
        .where(
            models.Encounter.tournament_id == tournament_id,
            models.Encounter.challonge_id.isnot(None),
            models.Encounter.status == "completed",
        )
        .options(
            selectinload(models.Encounter.home_team)
            .selectinload(models.Team.challonge),
            selectinload(models.Encounter.away_team)
            .selectinload(models.Team.challonge),
        )
    )
    encounters = enc_result.scalars().all()

    for encounter in encounters:
        try:
            await push_single_result(session, tournament, encounter)
            stats["matches_pushed"] += 1
        except Exception as e:
            stats["errors"] += 1
            await _log_sync(
                session, tournament_id, "export", "match",
                encounter.id, encounter.challonge_id,
                "failed", error_message=str(e),
            )

    await session.commit()
    logger.info(f"Challonge export for tournament {tournament_id}: {stats}")
    return stats


async def push_single_result(
    session: AsyncSession,
    tournament: models.Tournament,
    encounter: models.Encounter,
) -> None:
    """Push a single encounter result to Challonge."""
    if not tournament.challonge_id or not encounter.challonge_id:
        return

    # Determine winner's challonge participant ID
    winner_team = (
        encounter.home_team
        if encounter.home_score > encounter.away_score
        else encounter.away_team
    )
    if not winner_team or not winner_team.challonge:
        logger.warning(
            f"Cannot push encounter {encounter.id}: "
            f"winner team has no Challonge mapping"
        )
        return

    # Find the challonge participant ID for the winner
    # ChallongeTeam entries may be group-specific; pick any for this tournament
    winner_challonge = next(
        (ct for ct in winner_team.challonge if ct.tournament_id == tournament.id),
        None,
    )
    if not winner_challonge:
        return

    scores_csv = f"{encounter.home_score}-{encounter.away_score}"

    await challonge_service.update_match(
        tournament.challonge_id,
        encounter.challonge_id,
        scores_csv=scores_csv,
        winner_id=winner_challonge.challonge_id,
    )

    await _log_sync(
        session, tournament.id, "export", "match",
        encounter.id, encounter.challonge_id, "success",
        payload={"scores_csv": scores_csv, "winner_challonge_id": winner_challonge.challonge_id},
    )


async def auto_push_on_confirm(
    session: AsyncSession, encounter_id: int
) -> None:
    """Auto-push to Challonge when an encounter result is confirmed.

    Called from captain.confirm_result after status -> confirmed.
    """
    enc_result = await session.execute(
        select(models.Encounter)
        .where(models.Encounter.id == encounter_id)
        .options(
            selectinload(models.Encounter.tournament),
            selectinload(models.Encounter.home_team)
            .selectinload(models.Team.challonge),
            selectinload(models.Encounter.away_team)
            .selectinload(models.Team.challonge),
        )
    )
    encounter = enc_result.scalar_one_or_none()
    if not encounter or not encounter.challonge_id:
        return

    tournament = encounter.tournament
    if not tournament or not tournament.challonge_id:
        return

    try:
        await push_single_result(session, tournament, encounter)
        await session.commit()
        logger.info(f"Auto-pushed encounter {encounter_id} to Challonge")
    except Exception as e:
        logger.error(f"Auto-push failed for encounter {encounter_id}: {e}")
        await _log_sync(
            session, tournament.id, "export", "match",
            encounter.id, encounter.challonge_id,
            "failed", error_message=str(e),
        )
        await session.commit()


async def get_sync_log(
    session: AsyncSession, tournament_id: int, limit: int = 50
) -> list[models.ChallongeSyncLog]:
    result = await session.execute(
        select(models.ChallongeSyncLog)
        .where(models.ChallongeSyncLog.tournament_id == tournament_id)
        .order_by(models.ChallongeSyncLog.created_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())
