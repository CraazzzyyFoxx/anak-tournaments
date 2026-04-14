from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from shared.clients.s3 import S3Client
from shared.clients.s3.upload import upload_avatar
from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core import auth, db
from src.services.workspace import service as workspace_service


def get_s3(request: Request) -> S3Client:
    return request.app.state.s3

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.get("", response_model=list[schemas.WorkspaceRead])
async def get_all_workspaces(
    session: AsyncSession = Depends(db.get_async_session),
):
    workspaces = await workspace_service.get_all(session)
    return [schemas.WorkspaceRead.model_validate(w, from_attributes=True) for w in workspaces]


@router.get("/{workspace_id}", response_model=schemas.WorkspaceRead)
async def get_workspace(
    workspace_id: int,
    session: AsyncSession = Depends(db.get_async_session),
):
    workspace = await workspace_service.get_by_id(session, workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return schemas.WorkspaceRead.model_validate(workspace, from_attributes=True)


@router.post("", response_model=schemas.WorkspaceRead, status_code=201)
async def create_workspace(
    data: schemas.WorkspaceCreate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.get_current_superuser),
):
    existing = await workspace_service.get_by_slug(session, data.slug)
    if existing:
        raise HTTPException(status_code=400, detail="Workspace with this slug already exists")

    workspace = await workspace_service.create(session, **data.model_dump())
    await workspace_service.add_member(session, workspace.id, user.id, role="owner")
    await session.commit()
    return schemas.WorkspaceRead.model_validate(workspace, from_attributes=True)


@router.patch("/{workspace_id}", response_model=schemas.WorkspaceRead)
async def update_workspace(
    workspace_id: int,
    data: schemas.WorkspaceUpdate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.get_current_active_user),
):
    if not user.is_workspace_admin(workspace_id):
        raise HTTPException(status_code=403, detail="Workspace admin or owner role required")
    workspace = await workspace_service.get_by_id(session, workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    update_data = data.model_dump(exclude_unset=True)
    workspace = await workspace_service.update(session, workspace, update_data)
    await session.commit()
    return schemas.WorkspaceRead.model_validate(workspace, from_attributes=True)


@router.post("/{workspace_id}/icon", response_model=schemas.WorkspaceRead)
async def upload_workspace_icon(
    workspace_id: int,
    file: UploadFile,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.get_current_active_user),
    s3: S3Client = Depends(get_s3),
):
    if not user.is_workspace_admin(workspace_id):
        raise HTTPException(status_code=403, detail="Workspace admin or owner role required")
    workspace = await workspace_service.get_by_id(session, workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    file_data = await file.read()
    content_type = file.content_type or "application/octet-stream"

    result = await upload_avatar(
        s3,
        entity_type="workspaces",
        entity_id=workspace_id,
        file_data=file_data,
        content_type=content_type,
    )
    if not result.success:
        raise HTTPException(status_code=400, detail=result.error)

    workspace = await workspace_service.update(
        session, workspace, {"icon_url": result.public_url}
    )
    await session.commit()
    return schemas.WorkspaceRead.model_validate(workspace, from_attributes=True)


@router.delete("/{workspace_id}/icon", response_model=schemas.WorkspaceRead)
async def delete_workspace_icon(
    workspace_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.get_current_active_user),
    s3: S3Client = Depends(get_s3),
):
    if not user.is_workspace_admin(workspace_id):
        raise HTTPException(status_code=403, detail="Workspace admin or owner role required")
    workspace = await workspace_service.get_by_id(session, workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    await s3.delete_prefix(f"avatars/workspaces/{workspace_id}/")
    workspace = await workspace_service.update(
        session, workspace, {"icon_url": None}
    )
    await session.commit()
    return schemas.WorkspaceRead.model_validate(workspace, from_attributes=True)


# ─── Workspace Members ──────────────────────────────────────────────────────


@router.get("/{workspace_id}/members", response_model=list[schemas.WorkspaceMemberRead])
async def get_workspace_members(
    workspace_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.get_current_active_user),
):
    workspace = await workspace_service.get_by_id(session, workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    members = await workspace_service.get_members(session, workspace_id)
    return [schemas.WorkspaceMemberRead.model_validate(m, from_attributes=True) for m in members]


@router.post("/{workspace_id}/members", response_model=schemas.WorkspaceMemberRead, status_code=201)
async def add_workspace_member(
    workspace_id: int,
    data: schemas.WorkspaceMemberCreate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.get_current_active_user),
):
    if not user.is_workspace_admin(workspace_id):
        raise HTTPException(status_code=403, detail="Workspace admin or owner role required")
    workspace = await workspace_service.get_by_id(session, workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    existing = await workspace_service.get_member(session, workspace_id, data.auth_user_id)
    if existing:
        raise HTTPException(status_code=400, detail="User is already a member")

    member = await workspace_service.add_member(
        session, workspace_id, data.auth_user_id, data.role
    )
    await session.commit()
    return schemas.WorkspaceMemberRead.model_validate(member, from_attributes=True)


@router.patch("/{workspace_id}/members/{auth_user_id}", response_model=schemas.WorkspaceMemberRead)
async def update_workspace_member(
    workspace_id: int,
    auth_user_id: int,
    data: schemas.WorkspaceMemberUpdate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.get_current_active_user),
):
    if not user.is_workspace_admin(workspace_id):
        raise HTTPException(status_code=403, detail="Workspace admin or owner role required")
    member = await workspace_service.get_member(session, workspace_id, auth_user_id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    member = await workspace_service.update_member_role(session, member, data.role)
    await session.commit()
    return schemas.WorkspaceMemberRead.model_validate(member, from_attributes=True)


@router.delete("/{workspace_id}/members/{auth_user_id}", status_code=204)
async def remove_workspace_member(
    workspace_id: int,
    auth_user_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.get_current_active_user),
):
    if not user.is_workspace_admin(workspace_id):
        raise HTTPException(status_code=403, detail="Workspace admin or owner role required")
    member = await workspace_service.get_member(session, workspace_id, auth_user_id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    await workspace_service.remove_member(session, member)
    await session.commit()
