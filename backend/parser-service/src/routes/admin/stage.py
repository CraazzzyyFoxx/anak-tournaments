"""Admin routes for stage CRUD, bracket generation, and stage activation."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core import auth, db
from src.schemas.admin import stage as admin_schemas
from src.services.admin import stage as stage_service

router = APIRouter(
    prefix="/stages",
    tags=["admin", "stages"],
)


@router.get(
    "/tournament/{tournament_id}",
    response_model=list[schemas.StageRead],
)
async def get_stages(
    tournament_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("tournament", "read")),
):
    """Get all stages for a tournament."""
    stages = await stage_service.get_stages_by_tournament(session, tournament_id)
    return [
        schemas.StageRead.model_validate(s, from_attributes=True) for s in stages
    ]


@router.get("/{stage_id}", response_model=schemas.StageRead)
async def get_stage(
    stage_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("tournament", "read")),
):
    """Get a single stage with items and inputs."""
    stage = await stage_service.get_stage(session, stage_id)
    return schemas.StageRead.model_validate(stage, from_attributes=True)


@router.post(
    "/tournament/{tournament_id}",
    response_model=schemas.StageRead,
)
async def create_stage(
    tournament_id: int,
    data: admin_schemas.StageCreate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("tournament", "update")),
):
    """Create a new stage for a tournament."""
    stage = await stage_service.create_stage(session, tournament_id, data)
    return schemas.StageRead.model_validate(stage, from_attributes=True)


@router.patch("/{stage_id}", response_model=schemas.StageRead)
async def update_stage(
    stage_id: int,
    data: admin_schemas.StageUpdate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("tournament", "update")),
):
    """Update stage metadata."""
    if data.stage_type is not None and not user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superusers can change stage type after creation",
        )

    stage = await stage_service.update_stage(session, stage_id, data)
    return schemas.StageRead.model_validate(stage, from_attributes=True)


@router.delete("/{stage_id}", status_code=204)
async def delete_stage(
    stage_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("tournament", "delete")),
):
    """Delete a stage and all its items/inputs."""
    await stage_service.delete_stage(session, stage_id)


@router.post(
    "/{stage_id}/items",
    response_model=schemas.StageItemRead,
)
async def create_stage_item(
    stage_id: int,
    data: admin_schemas.StageItemCreate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("tournament", "update")),
):
    """Create a stage item (group, bracket) within a stage."""
    item = await stage_service.create_stage_item(session, stage_id, data)
    return schemas.StageItemRead.model_validate(item, from_attributes=True)


@router.post(
    "/items/{stage_item_id}/inputs",
    response_model=schemas.StageItemInputRead,
)
async def create_stage_item_input(
    stage_item_id: int,
    data: admin_schemas.StageItemInputCreate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("tournament", "update")),
):
    """Create a stage item input (team slot)."""
    inp = await stage_service.create_stage_item_input(
        session, stage_item_id, data
    )
    return schemas.StageItemInputRead.model_validate(inp, from_attributes=True)


@router.post("/{stage_id}/activate", response_model=schemas.StageRead)
async def activate_stage(
    stage_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("tournament", "update")),
):
    """Activate a stage, resolving tentative inputs from previous stage standings."""
    stage = await stage_service.activate_stage(session, stage_id)
    return schemas.StageRead.model_validate(stage, from_attributes=True)


@router.post("/{stage_id}/generate")
async def generate_encounters(
    stage_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("tournament", "update")),
):
    """Generate bracket encounters for a stage based on its type and assigned teams."""
    encounters = await stage_service.generate_encounters(session, stage_id)
    return {"generated": len(encounters)}
