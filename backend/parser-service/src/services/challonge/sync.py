"""Bidirectional Challonge sync engine.

Import: Challonge -> Local (upsert encounters from Challonge matches)
Export: Local -> Challonge (push encounter results to Challonge)
Auto-push: triggered when encounter result_status becomes 'confirmed'
"""

import re
from dataclasses import dataclass

from loguru import logger
from shared.core import enums
from shared.services.encounter_naming import build_encounter_name
from shared.services.stage_refs import StageRefs, resolve_stage_refs_from_group
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src import models, schemas
from src.services.challonge import service as challonge_service
from src.services.standings import recalculation as standings_recalculation

_SCORE_RE = re.compile(r"\s*(-?\d+)\s*-\s*(-?\d+)")


@dataclass(frozen=True)
class _ImportSource:
    challonge_id: int
    stage: models.Stage | None = None
    group: models.TournamentGroup | None = None


@dataclass(frozen=True)
class _TeamLookup:
    by_group_and_challonge_id: dict[tuple[int | None, int], int]
    unique_by_challonge_id: dict[int, int]
    teams_by_id: dict[int, models.Team]


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


def _encounter_status_from_challonge(state: str) -> enums.EncounterStatus:
    if state == "complete":
        return enums.EncounterStatus.COMPLETED
    if state == "pending":
        return enums.EncounterStatus.PENDING
    return enums.EncounterStatus.OPEN


def _parse_scores(scores_csv: str | None) -> tuple[int, int]:
    match = _SCORE_RE.search(scores_csv or "")
    if not match:
        return 0, 0
    return int(match.group(1)), int(match.group(2))


def _default_stage_item_id(
    stage: models.Stage | None,
    match: schemas.ChallongeMatch,
) -> int | None:
    if stage is None:
        return None

    items = sorted(stage.items or [], key=lambda item: (item.order, item.id))
    if not items:
        return None

    if stage.stage_type == enums.StageType.DOUBLE_ELIMINATION and match.round < 0:
        lower_item = next(
            (item for item in items if item.type == enums.StageItemType.BRACKET_LOWER),
            None,
        )
        if lower_item is not None:
            return lower_item.id

    return items[0].id


def _collect_import_sources(tournament: models.Tournament) -> list[_ImportSource]:
    sources: list[_ImportSource] = []
    seen: set[int] = set()

    if tournament.challonge_id is not None:
        stage = next(
            (
                stage
                for stage in tournament.stages or []
                if stage.challonge_id == tournament.challonge_id
            ),
            None,
        )
        sources.append(_ImportSource(challonge_id=tournament.challonge_id, stage=stage))
        seen.add(tournament.challonge_id)

    for stage in tournament.stages or []:
        if stage.challonge_id is None or stage.challonge_id in seen:
            continue
        sources.append(_ImportSource(challonge_id=stage.challonge_id, stage=stage))
        seen.add(stage.challonge_id)

    for group in tournament.groups or []:
        if group.challonge_id is None or group.challonge_id in seen:
            continue
        sources.append(_ImportSource(challonge_id=group.challonge_id, group=group))
        seen.add(group.challonge_id)

    return sources


def _resolve_group_for_match(
    tournament: models.Tournament,
    source: _ImportSource,
    match: schemas.ChallongeMatch,
) -> models.TournamentGroup | None:
    if source.group is not None:
        return source.group

    groups = list(tournament.groups or [])
    if match.group_id is not None:
        return next((group for group in groups if group.challonge_id == match.group_id), None)

    playoff_groups = [group for group in groups if not group.is_groups]
    if len(playoff_groups) == 1:
        return playoff_groups[0]

    if len(groups) == 1:
        return groups[0]

    return None


async def _resolve_stage_refs_for_match(
    session: AsyncSession,
    tournament: models.Tournament,
    source: _ImportSource,
    group: models.TournamentGroup | None,
    match: schemas.ChallongeMatch,
) -> StageRefs:
    stage = source.stage
    if stage is None and source.group is not None:
        stage = source.group.stage

    return await resolve_stage_refs_from_group(
        session,
        tournament_id=tournament.id,
        tournament_group_id=group.id if group else None,
        stage_id=stage.id if stage else None,
        stage_item_id=_default_stage_item_id(stage, match),
    )


async def _build_team_lookup(
    session: AsyncSession,
    tournament_id: int,
    sources: list[_ImportSource],
) -> _TeamLookup:
    ct_result = await session.execute(
        select(models.ChallongeTeam).where(models.ChallongeTeam.tournament_id == tournament_id)
    )
    mappings = list(ct_result.scalars().all())
    by_group_and_challonge_id = {
        (mapping.group_id, mapping.challonge_id): mapping.team_id
        for mapping in mappings
    }

    candidates: dict[int, set[int]] = {}
    for mapping in mappings:
        candidates.setdefault(mapping.challonge_id, set()).add(mapping.team_id)

    unique_by_challonge_id = {
        challonge_id: next(iter(team_ids))
        for challonge_id, team_ids in candidates.items()
        if len(team_ids) == 1
    }

    team_ids = sorted({mapping.team_id for mapping in mappings})
    teams_by_id: dict[int, models.Team] = {}
    if team_ids:
        team_result = await session.execute(
            select(models.Team).where(models.Team.id.in_(team_ids))
        )
        teams_by_id = {team.id: team for team in team_result.scalars().all()}

    await _add_challonge_participant_aliases(
        by_group_and_challonge_id,
        unique_by_challonge_id,
        sources,
    )

    return _TeamLookup(
        by_group_and_challonge_id=by_group_and_challonge_id,
        unique_by_challonge_id=unique_by_challonge_id,
        teams_by_id=teams_by_id,
    )


def _participant_aliases(participant: schemas.ChallongeParticipant) -> set[int]:
    return {participant.id, *participant.group_player_ids}


async def _add_challonge_participant_aliases(
    by_group_and_challonge_id: dict[tuple[int | None, int], int],
    unique_by_challonge_id: dict[int, int],
    sources: list[_ImportSource],
) -> None:
    source_ids = sorted({source.challonge_id for source in sources})
    group_ids = {group_id for group_id, _ in by_group_and_challonge_id}

    for challonge_tournament_id in source_ids:
        try:
            participants = await challonge_service.fetch_participants(challonge_tournament_id)
        except Exception as exc:
            logger.warning(
                "Could not fetch Challonge participants for alias lookup",
                challonge_tournament_id=challonge_tournament_id,
                error=str(exc),
            )
            continue

        for participant in participants:
            aliases = _participant_aliases(participant)
            if len(aliases) <= 1:
                continue

            for group_id in group_ids:
                team_ids = {
                    team_id
                    for alias in aliases
                    if (team_id := by_group_and_challonge_id.get((group_id, alias))) is not None
                }
                if len(team_ids) == 1:
                    team_id = next(iter(team_ids))
                    for alias in aliases:
                        by_group_and_challonge_id.setdefault((group_id, alias), team_id)

            unique_team_ids = {
                team_id
                for alias in aliases
                if (team_id := unique_by_challonge_id.get(alias)) is not None
            }
            if len(unique_team_ids) == 1:
                team_id = next(iter(unique_team_ids))
                for alias in aliases:
                    unique_by_challonge_id.setdefault(alias, team_id)


def _resolve_team_id(
    lookup: _TeamLookup,
    group_id: int | None,
    challonge_id: int | None,
) -> int | None:
    if challonge_id is None:
        return None

    return (
        lookup.by_group_and_challonge_id.get((group_id, challonge_id))
        or lookup.by_group_and_challonge_id.get((None, challonge_id))
        or lookup.unique_by_challonge_id.get(challonge_id)
    )


async def _upsert_encounter_from_challonge(
    session: AsyncSession,
    tournament: models.Tournament,
    source: _ImportSource,
    match: schemas.ChallongeMatch,
    *,
    local_encounters: dict[int, models.Encounter],
    team_lookup: _TeamLookup,
) -> tuple[str, models.Encounter | None]:
    if match.state == "pending" or match.player1_id is None or match.player2_id is None:
        return "skipped", None

    encounter = local_encounters.get(match.id)
    group = _resolve_group_for_match(tournament, source, match)
    home_team_id = _resolve_team_id(team_lookup, group.id if group else None, match.player1_id)
    away_team_id = _resolve_team_id(team_lookup, group.id if group else None, match.player2_id)
    missing_team_mapping = home_team_id is None or away_team_id is None
    if encounter is None and missing_team_mapping:
        missing = [
            str(challonge_id)
            for challonge_id, team_id in (
                (match.player1_id, home_team_id),
                (match.player2_id, away_team_id),
            )
            if team_id is None
        ]
        raise ValueError(
            "Missing Challonge team mapping for participant(s): " + ", ".join(missing)
        )

    home_team = team_lookup.teams_by_id.get(home_team_id) if home_team_id is not None else None
    away_team = team_lookup.teams_by_id.get(away_team_id) if away_team_id is not None else None
    missing_local_team = home_team is None or away_team is None
    if encounter is None and missing_local_team:
        missing = [
            str(team_id)
            for team_id, team in (
                (home_team_id, home_team),
                (away_team_id, away_team),
            )
            if team is None
        ]
        raise ValueError("Mapped local team(s) not found: " + ", ".join(missing))

    home_score, away_score = _parse_scores(match.scores_csv)
    status = _encounter_status_from_challonge(match.state)
    refs = await _resolve_stage_refs_for_match(session, tournament, source, group, match)
    if encounter is None:
        encounter = models.Encounter(
            name=build_encounter_name(home_team.name, away_team.name),
            home_team_id=home_team_id,
            away_team_id=away_team_id,
            home_score=home_score,
            away_score=away_score,
            round=match.round,
            tournament_id=tournament.id,
            tournament_group_id=refs.tournament_group_id,
            stage_id=refs.stage_id,
            stage_item_id=refs.stage_item_id,
            challonge_id=match.id,
            status=status,
        )
        session.add(encounter)
        await session.flush()
        local_encounters[match.id] = encounter
        return "created", encounter

    was_completed = encounter.status == enums.EncounterStatus.COMPLETED
    if not missing_team_mapping and not missing_local_team:
        encounter.name = build_encounter_name(home_team.name, away_team.name)
        encounter.home_team_id = home_team_id
        encounter.away_team_id = away_team_id
    encounter.home_score = home_score
    encounter.away_score = away_score
    encounter.round = match.round
    encounter.tournament_group_id = refs.tournament_group_id
    encounter.stage_id = refs.stage_id
    encounter.stage_item_id = refs.stage_item_id
    encounter.status = status
    await session.flush()

    if not was_completed and status == enums.EncounterStatus.COMPLETED:
        from shared.services.bracket.advancement import advance_winner  # noqa: PLC0415

        await advance_winner(session, encounter)

    return "updated", encounter


async def import_tournament(
    session: AsyncSession, tournament_id: int
) -> dict:
    """Full import from Challonge: upsert encounters with scores and status."""
    result = await session.execute(
        select(models.Tournament)
        .where(models.Tournament.id == tournament_id)
        .options(
            selectinload(models.Tournament.groups).selectinload(models.TournamentGroup.stage),
            selectinload(models.Tournament.stages).selectinload(models.Stage.items),
        )
    )
    tournament = result.scalar_one_or_none()
    if not tournament:
        return {"error": "Tournament not found"}

    sources = _collect_import_sources(tournament)
    if not sources:
        return {"error": "Tournament has no Challonge source"}

    stats = {
        "matches_synced": 0,
        "matches_created": 0,
        "matches_updated": 0,
        "matches_skipped": 0,
        "errors": 0,
    }

    # Build challonge_id -> local encounter mapping
    enc_result = await session.execute(
        select(models.Encounter)
        .where(
            models.Encounter.tournament_id == tournament_id,
            models.Encounter.challonge_id.isnot(None),
        )
    )
    local_encounters = {e.challonge_id: e for e in enc_result.scalars().all()}
    team_lookup = await _build_team_lookup(session, tournament_id, sources)
    processed_match_ids: set[int] = set()

    for source in sources:
        try:
            challonge_matches = await challonge_service.fetch_matches(source.challonge_id)
        except Exception as e:
            stats["errors"] += 1
            await _log_sync(
                session, tournament_id, "import", "tournament",
                tournament_id, source.challonge_id,
                "failed", error_message=str(e),
            )
            continue

        for cm in challonge_matches:
            if cm.id in processed_match_ids:
                continue
            processed_match_ids.add(cm.id)

            try:
                action, encounter = await _upsert_encounter_from_challonge(
                    session,
                    tournament,
                    source,
                    cm,
                    local_encounters=local_encounters,
                    team_lookup=team_lookup,
                )
                if action == "skipped":
                    stats["matches_skipped"] += 1
                    continue

                stats["matches_synced"] += 1
                if action == "created":
                    stats["matches_created"] += 1
                else:
                    stats["matches_updated"] += 1

                await _log_sync(
                    session, tournament_id, "import", "match",
                    encounter.id if encounter else None, cm.id, "success",
                    payload={
                        "action": action,
                        "scores_csv": cm.scores_csv,
                        "state": cm.state,
                        "challonge_tournament_id": source.challonge_id,
                    },
                )
            except Exception as e:
                stats["errors"] += 1
                await _log_sync(
                    session, tournament_id, "import", "match",
                    None, cm.id, "failed", error_message=str(e),
                )

    await session.commit()
    if stats["matches_synced"] > 0:
        await standings_recalculation.enqueue_tournament_recalculation(tournament_id)
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
