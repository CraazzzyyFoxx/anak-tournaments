"""Admin service layer for stage CRUD and bracket generation."""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.core import enums
from shared.core.tournament_state import validate_transition
from shared.services.bracket.engine import generate_bracket
from shared.services.bracket.swiss import SwissStanding
from src import models
from src.schemas.admin import stage as admin_schemas


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


async def create_stage_item(
    session: AsyncSession, stage_id: int, data: admin_schemas.StageItemCreate
) -> models.StageItem:
    await get_stage(session, stage_id)  # verify exists
    item = models.StageItem(stage_id=stage_id, **data.model_dump())
    session.add(item)
    await session.commit()
    return await get_stage_item(session, item.id)


async def create_stage_item_input(
    session: AsyncSession,
    stage_item_id: int,
    data: admin_schemas.StageItemInputCreate,
) -> models.StageItemInput:
    result = await session.execute(
        select(models.StageItem).where(models.StageItem.id == stage_item_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Stage item not found"
        )
    inp = models.StageItemInput(stage_item_id=stage_item_id, **data.model_dump())
    session.add(inp)
    await session.commit()
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


async def generate_encounters(
    session: AsyncSession, stage_id: int
) -> list[models.Encounter]:
    """Generate bracket encounters for a stage based on its type and team inputs."""
    stage = await get_stage(session, stage_id)

    # Collect team_ids from all stage items
    team_ids: list[int] = []
    for item in stage.items:
        for inp in sorted(item.inputs, key=lambda x: x.slot):
            if inp.team_id is not None:
                team_ids.append(inp.team_id)

    if len(team_ids) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Need at least 2 teams to generate a bracket",
        )

    # For Swiss, gather current standings and played pairs
    swiss_standings = None
    swiss_played_pairs: set[frozenset[int]] | None = None
    swiss_round = 1
    if stage.stage_type == enums.StageType.SWISS:
        existing_encounters = await session.execute(
            select(models.Encounter).where(models.Encounter.stage_id == stage_id)
        )
        existing = list(existing_encounters.scalars().all())
        if existing:
            swiss_round = max(e.round for e in existing) + 1
            swiss_played_pairs = set()
            for e in existing:
                if e.home_team_id and e.away_team_id:
                    swiss_played_pairs.add(
                        frozenset({e.home_team_id, e.away_team_id})
                    )
            # Build standings from Standing table
            standing_result = await session.execute(
                select(models.Standing).where(
                    models.Standing.stage_id == stage_id
                )
            )
            raw_standings = list(standing_result.scalars().all())
            swiss_standings = [
                SwissStanding(
                    team_id=s.team_id,
                    points=s.points,
                    buchholz=s.buchholz or 0.0,
                )
                for s in raw_standings
            ]

    skeleton = generate_bracket(
        stage.stage_type,
        team_ids,
        swiss_standings=swiss_standings,
        swiss_played_pairs=swiss_played_pairs,
        swiss_round_number=swiss_round,
    )

    # Determine the primary stage_item_id (first item for simple brackets)
    primary_item_id = stage.items[0].id if stage.items else None

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
            stage_item_id=primary_item_id,
            status=enums.EncounterStatus.OPEN,
        )
        session.add(encounter)
        encounters.append(encounter)

    await session.commit()
    return encounters
