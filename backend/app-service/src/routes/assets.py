from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from shared.clients.s3 import S3Client
from shared.clients.s3.upload import upload_asset

from src import models
from src.core import auth


router = APIRouter(prefix="/admin/assets", tags=["admin", "assets"])


def get_s3(request: Request) -> S3Client:
    return request.app.state.s3


@router.post("/{asset_type}/{slug}")
async def upload_asset_file(
    asset_type: Literal["achievements", "divisions"],
    slug: str,
    file: UploadFile,
    user: models.AuthUser = Depends(auth.get_current_superuser),
    s3: S3Client = Depends(get_s3),
):
    """Upload a static asset image (achievement icon or division image)."""
    file_data = await file.read()
    content_type = file.content_type or "application/octet-stream"

    result = await upload_asset(
        s3,
        asset_type=asset_type,
        slug=slug,
        file_data=file_data,
        content_type=content_type,
    )
    if not result.success:
        raise HTTPException(status_code=400, detail=result.error)

    return {"key": result.key, "public_url": result.public_url}


@router.delete("/{asset_type}/{slug}")
async def delete_asset_file(
    asset_type: Literal["achievements", "divisions"],
    slug: str,
    user: models.AuthUser = Depends(auth.get_current_superuser),
    s3: S3Client = Depends(get_s3),
):
    """Delete a static asset image."""
    prefix = f"assets/{asset_type}/{slug}."
    deleted = await s3.delete_prefix(prefix)
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"deleted": deleted}
