"""Detached ontology rows for unit tests; database tests resolve the real catalog instead."""

from shared import models
from shared.disciplines import discipline
from shared.domain.player_sub_roles import workspace_sub_role_code


def rated_catalog(
    *, sub_roles: dict[str, tuple[str, ...]] | None = None, discipline_code: str = "overwatch"
) -> dict[str, models.CatalogRole]:
    spec = discipline(discipline_code).rated_dimension
    dimension = models.RoleDimension(
        id=1, discipline=discipline_code, code=spec.code, name=spec.name, selection_mode=spec.selection_mode, rated=True
    )
    rows = {
        role.code: models.CatalogRole(
            id=index,
            dimension_id=1,
            dimension=dimension,
            code=role.code,
            name=role.name,
            parent=None,
            parent_role_id=None,
            workspace_id=None,
            sort_order=index,
        )
        for index, role in enumerate(spec.roles, 1)
    }
    for parent, slugs in (sub_roles or {}).items():
        for slug in slugs:
            code = workspace_sub_role_code(parent, slug)
            rows[code] = models.CatalogRole(
                id=len(rows) + 1,
                dimension_id=1,
                dimension=dimension,
                code=code,
                name=slug,
                parent=rows[parent],
                parent_role_id=rows[parent].id,
                workspace_id=1,
                sort_order=len(rows),
            )
    return rows


def registration_role(*, role: str, subrole: str | None = None, **values) -> models.RegistrationRole:
    rows = rated_catalog(sub_roles={role: (subrole,)} if subrole else None)
    leaf = rows[workspace_sub_role_code(role, subrole) if subrole else role]
    return models.RegistrationRole(catalog_role=leaf, dimension_id=leaf.dimension_id, **values)
