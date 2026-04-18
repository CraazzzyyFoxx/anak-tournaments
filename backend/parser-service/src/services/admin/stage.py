"""Admin service layer for stage CRUD and bracket generation."""

from fastapi import HTTPException, status
from shared.core import enums
from shared.services.bracket.engine import generate_bracket
from shared.services.bracket.swiss import SwissStanding
from shared.services.bracket.types import BracketSkeleton
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src import models
from src.schemas.admin import stage as admin_schemas
from src.services.standings import service as standings_service

GROUPED_GENERATION_STAGE_TYPES = {
    enums.StageType.ROUND_ROBIN,
    enums.StageType.SWISS,
}


async def get_stage(session: AsyncSession, stage_id: int) -> models.Stage:
    result = await session.execute(
        select(models.Stage)
        .where(models.Stage.id == stage_id)
        .options(
            selectinload(models.Stage.items).selectinload(models.StageItem.inputs)
        )
    )
    stage = result.scalar_one_or_none()
    if not stage:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stage not found")
    return stage


async def get_stage_item(session: AsyncSession, stage_item_id: int) -> models.StageItem:
    result = await session.execute(
        select(models.StageItem)
        .where(models.StageItem.id == stage_item_id)
        .options(selectinload(models.StageItem.inputs))
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stage item not found",
        )
    return item


async def get_stages_by_tournament(
    session: AsyncSession, tournament_id: int
) -> list[models.Stage]:
    result = await session.execute(
        select(models.Stage)
        .where(models.Stage.tournament_id == tournament_id)
        .options(
            selectinload(models.Stage.items).selectinload(models.StageItem.inputs)
        )
        .order_by(models.Stage.order)
    )
    return list(result.scalars().all())


async def create_stage(
    session: AsyncSession, tournament_id: int, data: admin_schemas.StageCreate
) -> models.Stage:
    result = await session.execute(
        select(models.Tournament).where(models.Tournament.id == tournament_id)
    )
    tournament = result.scalar_one_or_none()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    stage = models.Stage(tournament_id=tournament_id, **data.model_dump())
    session.add(stage)
    await session.commit()
    return await get_stage(session, stage.id)


async def update_stage(
    session: AsyncSession, stage_id: int, data: admin_schemas.StageUpdate
) -> models.Stage:
    stage = await get_stage(session, stage_id)
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(stage, field, value)
    await session.commit()
    return await get_stage(session, stage.id)


async def delete_stage(session: AsyncSession, stage_id: int) -> None:
    stage = await get_stage(session, stage_id)
    await session.delete(stage)
    await session.commit()


async def _ensure_stage_item_compat_group(
    session: AsyncSession,
    stage: models.Stage,
    item: models.StageItem,
) -> None:
    result = await session.execute(
        select(models.TournamentGroup).where(
            models.TournamentGroup.tournament_id == stage.tournament_id,
            models.TournamentGroup.stage_id == stage.id,
            models.TournamentGroup.name == item.name,
        )
    )
    if result.scalar_one_or_none() is not None:
        return

    session.add(
        models.TournamentGroup(
            tournament_id=stage.tournament_id,
            name=item.name,
            description=None,
            is_groups=stage.stage_type in GROUPED_GENERATION_STAGE_TYPES,
            stage_id=stage.id,
        )
    )


async def create_stage_item(
    session: AsyncSession, stage_id: int, data: admin_schemas.StageItemCreate
) -> models.StageItem:
    stage = await get_stage(session, stage_id)
    tournament_id = stage.tournament_id
    item = models.StageItem(stage_id=stage_id, **data.model_dump())
    session.add(item)
    await _ensure_stage_item_compat_group(session, stage, item)
    await session.commit()
    item_id = item.id
    await standings_service.recalculate_for_tournament(session, tournament_id)
    return await get_stage_item(session, item_id)


async def create_stage_item_input(
    session: AsyncSession,
    stage_item_id: int,
    data: admin_schemas.StageItemInputCreate,
) -> models.StageItemInput:
    result = await session.execute(
        select(models.StageItem)
        .where(models.StageItem.id == stage_item_id)
        .options(selectinload(models.StageItem.stage))
    )
    stage_item = result.scalar_one_or_none()
    if not stage_item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Stage item not found"
        )
    tournament_id = stage_item.stage.tournament_id
    inp = models.StageItemInput(stage_item_id=stage_item_id, **data.model_dump())
    session.add(inp)
    await session.commit()
    await session.refresh(inp)
    await standings_service.recalculate_for_tournament(session, tournament_id)
    await session.refresh(inp)
    return inp


async def activate_stage(session: AsyncSession, stage_id: int) -> models.Stage:
    """Activate a stage, resolving tentative inputs from previous stages."""
    stage = await get_stage(session, stage_id)

    # Deactivate all other stages in this tournament
    other_stages = await get_stages_by_tournament(session, stage.tournament_id)
    for other in other_stages:
        if other.id != stage_id:
            other.is_active = False

    stage.is_active = True

    # Resolve tentative inputs
    for item in stage.items:
        for inp in item.inputs:
            if inp.input_type != enums.StageItemInputType.TENTATIVE:
                continue
            if inp.source_stage_item_id is None or inp.source_position is None:
                continue

            # Look up standings for the source stage item
            standings_result = await session.execute(
                select(models.Standing)
                .where(
                    models.Standing.stage_item_id == inp.source_stage_item_id,
                )
                .order_by(models.Standing.position)
            )
            standings = list(standings_result.scalars().all())

            target_pos = inp.source_position
            if target_pos <= len(standings):
                inp.team_id = standings[target_pos - 1].team_id
                inp.input_type = enums.StageItemInputType.FINAL

    await session.commit()
    return await get_stage(session, stage.id)


def _collect_item_team_ids(item: models.StageItem) -> list[int]:
    return [
        inp.team_id
        for inp in sorted(item.inputs, key=lambda value: value.slot)
        if inp.team_id is not None
    ]


async def _get_swiss_generation_context(
    session: AsyncSession,
    stage_id: int,
    stage_item_id: int | None,
) -> tuple[list[SwissStanding] | None, set[frozenset[int]] | None, int]:
    existing_encounters = await session.execute(
        select(models.Encounter).where(
            models.Encounter.stage_id == stage_id,
            models.Encounter.stage_item_id == stage_item_id,
        )
    )
    existing = list(existing_encounters.scalars().all())
    if not existing:
        return None, None, 1

    swiss_round = max(e.round for e in existing) + 1
    swiss_played_pairs: set[frozenset[int]] = set()
    for encounter in existing:
        if encounter.home_team_id and encounter.away_team_id:
            swiss_played_pairs.add(
                frozenset({encounter.home_team_id, encounter.away_team_id})
            )

    standing_result = await session.execute(
        select(models.Standing).where(
            models.Standing.stage_id == stage_id,
            models.Standing.stage_item_id == stage_item_id,
        )
    )
    raw_standings = list(standing_result.scalars().all())
    swiss_standings = [
        SwissStanding(
            team_id=standing.team_id,
            points=standing.points,
            buchholz=standing.buchholz or 0.0,
        )
        for standing in raw_standings
    ]

    return swiss_standings, swiss_played_pairs, swiss_round


async def _generate_stage_skeleton(
    session: AsyncSession,
    stage: models.Stage,
    team_ids: list[int],
    stage_item_id: int | None,
) -> BracketSkeleton:
    swiss_standings = None
    swiss_played_pairs: set[frozenset[int]] | None = None
    swiss_round = 1
    if stage.stage_type == enums.StageType.SWISS:
        swiss_standings, swiss_played_pairs, swiss_round = (
            await _get_swiss_generation_context(session, stage.id, stage_item_id)
        )

    return generate_bracket(
        stage.stage_type,
        team_ids,
        swiss_standings=swiss_standings,
        swiss_played_pairs=swiss_played_pairs,
        swiss_round_number=swiss_round,
    )


def _create_encounters_from_skeleton(
    session: AsyncSession,
    stage: models.Stage,
    skeleton: BracketSkeleton,
    stage_item_id: int | None,
) -> list[models.Encounter]:
    encounters: list[models.Encounter] = []
    for pairing in skeleton.pairings:
        encounter = models.Encounter(
            name=pairing.name,
            home_team_id=pairing.home_team_id,
            away_team_id=pairing.away_team_id,
            home_score=0,
            away_score=0,
            round=pairing.round_number,
            tournament_id=stage.tournament_id,
            stage_id=stage.id,
            stage_item_id=stage_item_id,
            status=enums.EncounterStatus.OPEN,
        )
        session.add(encounter)
        encounters.append(encounter)
    return encounters


async def generate_encounters(
    session: AsyncSession, stage_id: int
) -> list[models.Encounter]:
    """Generate bracket encounters for a stage based on its type and team inputs."""
    stage = await get_stage(session, stage_id)

    should_generate_by_item = (
        stage.stage_type in GROUPED_GENERATION_STAGE_TYPES and len(stage.items) > 1
    )

    if should_generate_by_item:
        encounters: list[models.Encounter] = []
        for item in stage.items:
            team_ids = _collect_item_team_ids(item)
            if len(team_ids) < 2:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Each group needs at least 2 teams to generate a bracket",
                )

            skeleton = await _generate_stage_skeleton(session, stage, team_ids, item.id)
            encounters.extend(
                _create_encounters_from_skeleton(session, stage, skeleton, item.id)
            )

        await session.commit()
        return encounters

    team_ids: list[int] = []
    for item in stage.items:
        team_ids.extend(_collect_item_team_ids(item))

    if len(team_ids) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Need at least 2 teams to generate a bracket",
        )

    primary_item_id = stage.items[0].id if stage.items else None
    skeleton = await _generate_stage_skeleton(session, stage, team_ids, primary_item_id)
    encounters = _create_encounters_from_skeleton(
        session, stage, skeleton, primary_item_id
    )

    await session.commit()
    return encounters
