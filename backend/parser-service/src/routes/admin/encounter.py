"""Admin routes for encounter CRUD operations"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core import auth, db
from src.schemas.admin import encounter as admin_schemas
from src.services.admin import encounter as admin_service

router = APIRouter(
    prefix="/encounters",
    tags=["admin", "encounters"],
)


@router.post("", response_model=schemas.EncounterRead)
async def create_encounter(
    data: admin_schemas.EncounterCreate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_any_role("admin", "tournament_organizer")),
):
    """Create a new encounter (admin/organizer only)"""
    encounter = await admin_service.create_encounter(session, data)
    return schemas.EncounterRead.model_validate(encounter, from_attributes=True)


@router.patch("/{encounter_id}", response_model=schemas.EncounterRead)
async def update_encounter(
    encounter_id: int,
    data: admin_schemas.EncounterUpdate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_any_role("admin", "tournament_organizer")),
):
    """Update encounter fields (admin/organizer only)"""
    encounter = await admin_service.update_encounter(session, encounter_id, data)
    return schemas.EncounterRead.model_validate(encounter, from_attributes=True)


@router.delete("/{encounter_id}", status_code=204)
async def delete_encounter(
    encounter_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_any_role("admin", "tournament_organizer")),
):
    """Delete encounter and all matches (admin/organizer only)"""
    await admin_service.delete_encounter(session, encounter_id)
