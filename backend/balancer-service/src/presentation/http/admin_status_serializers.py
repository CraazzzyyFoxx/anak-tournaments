from __future__ import annotations

from src import models
from src.schemas.admin import balancer as admin_schemas


def serialize_status(
    status_row: models.BalancerRegistrationStatus,
) -> admin_schemas.BalancerRegistrationStatusRead:
    is_override = status_row.kind == "builtin" and status_row.workspace_id is not None
    return admin_schemas.BalancerRegistrationStatusRead(
        id=status_row.id,
        workspace_id=status_row.workspace_id,
        scope=status_row.scope,
        slug=status_row.slug,
        kind=status_row.kind,  # type: ignore[arg-type]
        is_override=is_override,
        can_delete=status_row.kind == "custom",
        can_reset=is_override,
        icon_slug=status_row.icon_slug,
        icon_color=status_row.icon_color,
        name=status_row.name,
        description=status_row.description,
        created_at=status_row.created_at,
        updated_at=status_row.updated_at,
    )
