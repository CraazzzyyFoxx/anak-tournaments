"""Public native metadata of the installed disciplines (P7 §1).

Reads declarations and persisted rows only: a capability is the *presence* of a hook on the ``DisciplineSpec``, and no
hook (catalog sync, analytics factory, condition registration, collection handler) is ever called here.
"""

from __future__ import annotations

import dataclasses

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core.errors import ApiExc, ApiHTTPException, BaseAPIException
from shared.disciplines import DISCIPLINES, DisciplineSpec
from shared.domain.roles import public_role_attrs
from shared.domain.team_format import TeamFormat
from shared.models.identity.auth_user import AuthUser
from shared.repository import CatalogRoleRepository, WorkspaceRepository
from shared.schemas.team_format import TeamFormatRead
from src.core import config
from src.schemas.discipline import (
    DisciplineCapabilities,
    DisciplineDescriptor,
    DisciplineMetadata,
    EventTypeRead,
    NativeTierRead,
    OntologyRole,
    RoleDimensionRead,
    StatDefinition,
)

__all__ = ("list_disciplines", "metadata")

#: ``workspace_id=all``: the global view. A missing parameter means the same (the gateway has already filled in a
#: single-workspace credential's scope before it gets here).
_ALL = "all"
_roles = CatalogRoleRepository()
_workspaces = WorkspaceRepository()


def _not_found() -> BaseAPIException:
    return BaseAPIException(status_code=404, detail="Workspace not found")


def _scope(raw: str | None) -> int | None:
    """``None`` for the global view, else a workspace id; anything else is a 422 the client can branch on."""
    if raw is None or raw == _ALL:
        return None
    if not (raw.isascii() and raw.isdigit()):
        raise ApiHTTPException(
            status_code=422,
            detail=[ApiExc(code="invalid_workspace_id", msg="workspace_id must be a workspace id or 'all'")],
        )
    return int(raw) if len(raw) <= 9 else 0  # longer cannot be an id; 0 reads as the unknown workspace


async def _visible_workspace(session: AsyncSession, workspace_id: int, viewer: AuthUser | None) -> models.Workspace:
    """The workspace, or the one 404 an unknown id and a hidden workspace the viewer is not in both get.

    ``workspaces.get`` is public and existence-only; child ontology is not, so a hidden workspace is readable only by
    a superuser or one of its members.
    """
    workspace = await _workspaces.get(session, workspace_id) if workspace_id > 0 else None
    if workspace is None:
        raise _not_found()
    if workspace.is_hidden and not (
        viewer is not None and (viewer.is_superuser or workspace.id in viewer.get_workspace_ids())
    ):
        raise _not_found()
    return workspace


def _descriptor(spec: DisciplineSpec, *, enabled: bool) -> DisciplineDescriptor:
    return DisciplineDescriptor(
        code=spec.code,
        name=spec.name,
        enabled=enabled,
        kinds=dict(spec.kinds),  # type: ignore[arg-type]  # validated against the catalog kinds
        character_classes=list(spec.character_classes),
        identity_provider=spec.identity_provider,
        capabilities=DisciplineCapabilities(
            catalog_sync=spec.catalog_sync is not None,
            native_rank_collection="rank.collect" in spec.collection_handlers,
            native_ladder=bool(spec.native_ladder),
            achievement_conditions=spec.achievement_conditions is not None,
            analytics=spec.analytics is not None,
        ),
    )


def _enabled(workspace: models.Workspace | None, code: str) -> bool:
    return True if workspace is None else code in workspace.disciplines_enabled


async def list_disciplines(
    session: AsyncSession, raw_scope: str | None, viewer: AuthUser | None
) -> list[DisciplineDescriptor]:
    workspace_id = _scope(raw_scope)
    workspace = None if workspace_id is None else await _visible_workspace(session, workspace_id, viewer)
    return [_descriptor(spec, enabled=_enabled(workspace, code)) for code, spec in DISCIPLINES.items()]


async def metadata(
    session: AsyncSession, code: str, raw_scope: str | None, viewer: AuthUser | None
) -> DisciplineMetadata:
    # ``discipline(code)`` would answer an unknown code with an empty stand-in; a browsing code must never be accepted.
    spec = DISCIPLINES.get(code)
    if spec is None:
        raise ApiHTTPException(
            status_code=404,
            detail=[ApiExc(code="discipline_not_installed", msg=f"Discipline {code!r} is not installed")],
        )
    workspace_id = _scope(raw_scope)
    workspace = None if workspace_id is None else await _visible_workspace(session, workspace_id, viewer)

    dimensions, roles = await _roles.dictionary(session, discipline=code, workspace_id=workspace_id)
    stat_defs = (
        await session.scalars(
            sa.select(models.StatDef)
            .where(models.StatDef.discipline == code)
            .order_by(models.StatDef.sort_order, models.StatDef.code)
        )
    ).all()
    event_types = (
        await session.scalars(
            sa.select(models.EventType).where(models.EventType.discipline == code).order_by(models.EventType.code)
        )
    ).all()
    presets: list[TeamFormatRead] = []
    if spec.team_format_presets:
        # Presets are checked against the *selection* ontology (active dimensions), not the history dictionary.
        ontology = await _roles.ontology(session, discipline=code, workspace_id=workspace_id)
        presets = [
            TeamFormatRead.from_domain(TeamFormat.from_preset(code, preset), source="preset", ontology=ontology)
            for preset in spec.team_format_presets
        ]
    public_origin = config.settings.s3_public_url
    return DisciplineMetadata(
        discipline=_descriptor(spec, enabled=_enabled(workspace, code)),
        workspace_id=workspace_id,
        dimensions=[
            RoleDimensionRead(
                id=row.id,
                code=row.code,
                name=row.name,
                selection_mode=row.selection_mode,  # type: ignore[arg-type]  # CHECK-constrained
                rated=row.rated,
                active=row.active,
                sort_order=row.sort_order,
            )
            for row in dimensions
        ],
        roles=[
            OntologyRole(
                id=role.id,
                dimension=role.dimension,
                code=role.code,
                name=role.name,
                parent_id=role.parent_id,
                workspace_id=role.workspace_id,
                active=role.active,
                selectable=role.selectable,
                sort_order=role.sort_order,
                attrs=public_role_attrs(role.attrs, public_origin=public_origin),
            )
            for role in roles
        ],
        stat_defs=[
            StatDefinition(
                id=row.id,
                code=row.code,
                name=row.name,
                value_format=row.value_format,  # type: ignore[arg-type]  # projected from a validated declaration
                aggregation=row.aggregation,  # type: ignore[arg-type]  # CHECK-constrained
                group=row.stat_group,
                active=row.active,
                sort_order=row.sort_order,
            )
            for row in stat_defs
        ],
        event_types=[EventTypeRead(id=row.id, code=row.code, name=row.name, active=row.active) for row in event_types],
        team_format_presets=presets,
        native_ladder=[NativeTierRead(**dataclasses.asdict(tier)) for tier in spec.native_ladder],
    )
