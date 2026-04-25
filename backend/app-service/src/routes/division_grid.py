from fastapi import APIRouter, Depends, HTTPException, Request
from shared.clients.s3 import S3Client
from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core import auth, db
from src.services.division_grid import marketplace as division_grid_marketplace
from src.services.division_grid import service as division_grid_service
from src.services.workspace import service as workspace_service

router = APIRouter(tags=["division-grids"])


def get_s3(request: Request) -> S3Client:
    return request.app.state.s3


async def _require_workspace_admin(
    workspace_id: int,
    *,
    session: AsyncSession,
    user: models.AuthUser,
) -> models.Workspace:
    if not user.is_workspace_admin(workspace_id):
        raise HTTPException(status_code=403, detail="Workspace admin or owner role required")
    workspace = await workspace_service.get_by_id(session, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return workspace


async def _get_source_workspace_or_404(
    session: AsyncSession,
    *,
    target_workspace_id: int,
    source_workspace_id: int,
    user: models.AuthUser,
) -> models.Workspace:
    if source_workspace_id == target_workspace_id:
        raise HTTPException(status_code=400, detail="Source and target workspace must be different")

    source_workspace = await workspace_service.get_by_id(session, source_workspace_id)
    if source_workspace is None:
        raise HTTPException(status_code=404, detail="Source workspace not found")
    if not user.is_superuser and source_workspace_id not in user.get_workspace_ids():
        raise HTTPException(status_code=403, detail="Source workspace is not accessible")
    return source_workspace


@router.get("/workspaces/{workspace_id}/division-grids", response_model=list[schemas.DivisionGridRead])
async def get_workspace_division_grids(
    workspace_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.get_current_active_user),
):
    await _require_workspace_admin(workspace_id, session=session, user=user)
    grids = await division_grid_service.get_workspace_grids(session, workspace_id)
    return [schemas.DivisionGridRead.model_validate(grid, from_attributes=True) for grid in grids]


@router.post("/workspaces/{workspace_id}/division-grids", response_model=schemas.DivisionGridRead, status_code=201)
async def create_workspace_division_grid(
    workspace_id: int,
    data: schemas.DivisionGridCreate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.get_current_active_user),
):
    await _require_workspace_admin(workspace_id, session=session, user=user)
    grid = await division_grid_service.create_grid(session, workspace_id, data)
    await session.commit()
    return schemas.DivisionGridRead.model_validate(grid, from_attributes=True)


@router.get(
    "/workspaces/{workspace_id}/division-grid-marketplace/workspaces",
    response_model=list[schemas.DivisionGridMarketplaceWorkspaceRead],
)
async def get_division_grid_marketplace_workspaces(
    workspace_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.get_current_active_user),
):
    await _require_workspace_admin(workspace_id, session=session, user=user)
    return await division_grid_marketplace.list_marketplace_workspaces(
        session,
        target_workspace_id=workspace_id,
        user=user,
    )


@router.get(
    "/workspaces/{workspace_id}/division-grid-marketplace",
    response_model=list[schemas.DivisionGridMarketplaceGridRead],
)
async def get_division_grid_marketplace(
    workspace_id: int,
    source_workspace_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.get_current_active_user),
):
    await _require_workspace_admin(workspace_id, session=session, user=user)
    source_workspace = await _get_source_workspace_or_404(
        session,
        target_workspace_id=workspace_id,
        source_workspace_id=source_workspace_id,
        user=user,
    )
    return await division_grid_marketplace.list_marketplace_grids(
        session,
        source_workspace_id=source_workspace.id,
    )


@router.post(
    "/workspaces/{workspace_id}/division-grid-marketplace/import",
    response_model=schemas.DivisionGridMarketplaceImportResult,
    status_code=201,
)
async def import_division_grid_marketplace(
    workspace_id: int,
    data: schemas.DivisionGridMarketplaceImportRequest,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.get_current_active_user),
    s3: S3Client = Depends(get_s3),
):
    target_workspace = await _require_workspace_admin(workspace_id, session=session, user=user)
    source_workspace = await _get_source_workspace_or_404(
        session,
        target_workspace_id=workspace_id,
        source_workspace_id=data.source_workspace_id,
        user=user,
    )
    source_grids = await division_grid_marketplace.get_marketplace_grids_by_ids(
        session,
        source_workspace_id=source_workspace.id,
        source_grid_ids=data.source_grid_ids,
    )
    result = await division_grid_marketplace.import_division_grids(
        session,
        s3,
        target_workspace=target_workspace,
        source_workspace=source_workspace,
        source_grids=source_grids,
        set_default=data.set_default,
    )
    await session.commit()
    return result


@router.get(
    "/workspaces/{workspace_id}/division-grids/{grid_id}/versions",
    response_model=list[schemas.DivisionGridVersionRead],
)
async def get_workspace_division_grid_versions(
    workspace_id: int,
    grid_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.get_current_active_user),
):
    await _require_workspace_admin(workspace_id, session=session, user=user)
    versions = await division_grid_service.get_versions(session, workspace_id, grid_id)
    return [schemas.DivisionGridVersionRead.model_validate(version, from_attributes=True) for version in versions]


@router.post(
    "/workspaces/{workspace_id}/division-grids/{grid_id}/versions",
    response_model=schemas.DivisionGridVersionRead,
    status_code=201,
)
async def create_workspace_division_grid_version(
    workspace_id: int,
    grid_id: int,
    data: schemas.DivisionGridVersionCreate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.get_current_active_user),
):
    await _require_workspace_admin(workspace_id, session=session, user=user)
    version = await division_grid_service.create_version(session, workspace_id, grid_id, data)
    await session.commit()
    return schemas.DivisionGridVersionRead.model_validate(version, from_attributes=True)


@router.get("/division-grid-versions/{version_id}", response_model=schemas.DivisionGridVersionRead)
async def get_division_grid_version(
    version_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    _: models.AuthUser = Depends(auth.get_current_active_user),
):
    version = await division_grid_service.get_version(session, version_id)
    return schemas.DivisionGridVersionRead.model_validate(version, from_attributes=True)


@router.delete("/division-grid-versions/{version_id}", status_code=204)
async def delete_division_grid_version(
    version_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.get_current_active_user),
):
    version = await division_grid_service.get_version(session, version_id)
    await _require_workspace_admin(version.grid.workspace_id, session=session, user=user)
    await division_grid_service.delete_version(session, version_id)
    await session.commit()


@router.post("/division-grid-versions/{version_id}/publish", response_model=schemas.DivisionGridVersionRead)
async def publish_division_grid_version(
    version_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.get_current_active_user),
):
    version = await division_grid_service.get_version(session, version_id)
    await _require_workspace_admin(version.grid.workspace_id, session=session, user=user)
    version = await division_grid_service.publish_version(session, version_id)
    await session.commit()
    return schemas.DivisionGridVersionRead.model_validate(version, from_attributes=True)


@router.post("/division-grid-versions/{version_id}/clone", response_model=schemas.DivisionGridVersionRead, status_code=201)
async def clone_division_grid_version(
    version_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.get_current_active_user),
):
    version = await division_grid_service.get_version(session, version_id)
    await _require_workspace_admin(version.grid.workspace_id, session=session, user=user)
    cloned = await division_grid_service.clone_version(session, version_id)
    await session.commit()
    return schemas.DivisionGridVersionRead.model_validate(cloned, from_attributes=True)


@router.get(
    "/division-grid-mappings/{source_version_id}/{target_version_id}",
    response_model=schemas.DivisionGridMappingRead,
)
async def get_division_grid_mapping(
    source_version_id: int,
    target_version_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    _: models.AuthUser = Depends(auth.get_current_active_user),
):
    mapping = await division_grid_service.get_mapping(session, source_version_id, target_version_id)
    if mapping is None:
        raise HTTPException(status_code=404, detail="Division grid mapping not found")
    return schemas.DivisionGridMappingRead.model_validate(mapping, from_attributes=True)


@router.put(
    "/division-grid-mappings/{source_version_id}/{target_version_id}",
    response_model=schemas.DivisionGridMappingRead,
)
async def put_division_grid_mapping(
    source_version_id: int,
    target_version_id: int,
    data: schemas.DivisionGridMappingWrite,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.get_current_active_user),
):
    source_version = await division_grid_service.get_version(session, source_version_id)
    await _require_workspace_admin(source_version.grid.workspace_id, session=session, user=user)
    mapping = await division_grid_service.upsert_mapping(session, source_version_id, target_version_id, data)
    await session.commit()
    return schemas.DivisionGridMappingRead.model_validate(mapping, from_attributes=True)
