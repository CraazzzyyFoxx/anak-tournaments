"""``catalog.role_dimension`` / ``catalog.role``: the modules' ontologies and the workspaces' sub-roles (D31)."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.disciplines import DisciplineSpec
from shared.domain.roles import DimensionNode, Ontology, RoleNode, UnknownRole
from shared.repository.base import BaseRepository

__all__ = ("CatalogRoleRepository",)


def _owned_by(workspace_id: int | None) -> sa.ColumnElement[bool]:
    """Module roles, plus ``workspace_id``'s own sub-roles -- never another workspace's."""
    role = models.CatalogRole
    if workspace_id is None:
        return role.workspace_id.is_(None)
    return sa.or_(role.workspace_id.is_(None), role.workspace_id == workspace_id)


class CatalogRoleRepository(BaseRepository[models.CatalogRole]):
    def __init__(self) -> None:
        super().__init__(models.CatalogRole)

    async def ontology(self, session: AsyncSession, *, discipline: str, workspace_id: int | None) -> Ontology:
        dimension, role = models.RoleDimension, models.CatalogRole
        dimensions = (
            await session.scalars(
                sa.select(dimension).where(dimension.discipline == discipline, dimension.active.is_(True))
            )
        ).all()
        codes = {row.id: row.code for row in dimensions}
        roles = (
            await session.scalars(sa.select(role).where(role.dimension_id.in_(list(codes)), _owned_by(workspace_id)))
        ).all()
        return Ontology(
            discipline,
            [DimensionNode(row.id, row.code, row.name, row.selection_mode, row.rated) for row in dimensions],
            [
                RoleNode(
                    row.id,
                    row.dimension_id,
                    codes[row.dimension_id],
                    row.code,
                    row.name,
                    row.parent_role_id,
                    row.workspace_id,
                    row.active,
                    row.selectable,
                    row.sort_order,
                )
                for row in roles
            ],
        )

    async def resolve(
        self, session: AsyncSession, *, discipline: str, workspace_id: int | None, dimension: str | None, code: str
    ) -> models.CatalogRole:
        """The row ``(dimension, code)`` names for this owner; ``dimension=None`` is the rated dimension."""
        dim, role = models.RoleDimension, models.CatalogRole
        on_dimension = dim.rated.is_(True) if dimension is None else dim.code == dimension
        row = (
            await session.scalars(
                sa.select(role)
                .join(dim, dim.id == role.dimension_id)
                .where(dim.discipline == discipline, on_dimension, role.code == code, _owned_by(workspace_id))
            )
        ).first()
        if row is None:
            raise UnknownRole(f"{discipline} has no role {code!r} in dimension {dimension or 'rated'}")
        return row

    async def rated_dimension_id(self, session: AsyncSession, *, discipline: str) -> int | None:
        """The discipline's rated dimension (D32): the axis every rank is held on."""
        dim = models.RoleDimension
        return await session.scalar(sa.select(dim.id).where(dim.discipline == discipline, dim.rated.is_(True)))

    async def rated_rows(
        self, session: AsyncSession, *, discipline: str, workspace_id: int | None
    ) -> dict[str, models.CatalogRole]:
        """Module roles and this workspace's sub-roles on the rated dimension, in display order."""
        dim, role = models.RoleDimension, models.CatalogRole
        rows = (
            await session.scalars(
                sa.select(role)
                .join(dim, dim.id == role.dimension_id)
                .where(dim.discipline == discipline, dim.rated.is_(True), _owned_by(workspace_id))
                .order_by(role.sort_order, role.code)
            )
        ).all()
        return {row.code: row for row in rows}

    async def list_sub_roles(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        dimension_id: int,
        parent_id: int | None,
        only_active: bool,
    ) -> Sequence[models.CatalogRole]:
        role = models.CatalogRole
        query = sa.select(role).where(role.workspace_id == workspace_id, role.dimension_id == dimension_id)
        if parent_id is not None:
            query = query.where(role.parent_role_id == parent_id)
        if only_active:
            query = query.where(role.active.is_(True))
        return (await session.scalars(query.order_by(role.parent_role_id, role.sort_order, role.name))).all()

    async def code_taken(
        self, session: AsyncSession, *, dimension_id: int, workspace_id: int | None, code: str
    ) -> bool:
        """Whether ``code`` already names a module role (or, with a workspace, one of its sub-roles) on the dimension."""
        role = models.CatalogRole
        return await self.exists(
            session, filters=[role.dimension_id == dimension_id, role.code == code, _owned_by(workspace_id)]
        )

    async def project_module(self, session: AsyncSession, spec: DisciplineSpec) -> None:
        """Upsert one module's discipline row, dimensions and roles (D31).

        Idempotent and safe from every replica at once (``ON CONFLICT`` throughout). A dimension or role the module
        stopped declaring is deactivated, never deleted: assignments may still point at it.
        """
        spec.rated_dimension  # noqa: B018 -- LookupError before any write (D32: exactly one rated dimension)
        await session.execute(
            pg_insert(models.Discipline)
            .values(code=spec.code, name=spec.name)
            .on_conflict_do_update(index_elements=[models.Discipline.code], set_={"name": spec.name})
        )
        dim, role = models.RoleDimension, models.CatalogRole
        declared = [dimension.code for dimension in spec.dimensions]
        # Un-rate first: ``uq_role_dimension_rated`` holds at every statement, not only at the end.
        # ponytail: a module that moves ``rated`` between two declared dimensions needs a two-pass upsert; none does.
        await session.execute(
            sa.update(dim)
            .where(dim.discipline == spec.code, dim.code.not_in(declared))
            .values(active=False, rated=False)
        )
        for order, dimension in enumerate(spec.dimensions):
            values = {
                "name": dimension.name,
                "selection_mode": dimension.selection_mode,
                "rated": dimension.rated,
                "active": True,
                "sort_order": order,
            }
            dimension_id = (
                await session.execute(
                    pg_insert(dim)
                    .values(discipline=spec.code, code=dimension.code, **values)
                    .on_conflict_do_update(constraint="uq_role_dimension_code", set_=values)
                    .returning(dim.id)
                )
            ).scalar_one()
            for role_order, declared_role in enumerate(dimension.roles):
                await session.execute(
                    pg_insert(role)
                    .values(
                        dimension_id=dimension_id,
                        code=declared_role.code,
                        name=declared_role.name,
                        sort_order=role_order,
                    )
                    .on_conflict_do_update(
                        index_elements=[role.dimension_id, role.code],
                        index_where=role.workspace_id.is_(None),
                        set_={
                            "name": declared_role.name,
                            "sort_order": role_order,
                            "active": True,
                            "updated_at": sa.func.now(),
                        },
                    )
                )
            await session.execute(
                sa.update(role)
                .where(
                    role.dimension_id == dimension_id,
                    role.workspace_id.is_(None),
                    role.code.not_in([declared_role.code for declared_role in dimension.roles]),
                )
                .values(active=False, updated_at=sa.func.now())
            )
        await session.flush()
