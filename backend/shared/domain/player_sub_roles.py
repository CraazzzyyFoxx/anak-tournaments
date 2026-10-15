from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any

from shared.domain.roles import Ontology

# OW rank and Discord consumers retain these codes until P3 moves ranks.
REGISTRATION_ROLE_CODES: tuple[str, ...] = ("tank", "damage", "support")


def normalize_role(role: Any) -> str | None:
    if role is None:
        return None

    value = str(role).strip().lower()
    return value or None


def normalize_sub_role(sub_role: str | None) -> str | None:
    if sub_role is None:
        return None

    normalized = re.sub(r"\s+", "_", sub_role.strip().lower())
    return normalized or None


def workspace_sub_role_code(parent: str, slug: str | None) -> str | None:
    """The catalog code for a normalized parent code and a legacy/form sub-role slug.

    Mirrored by ``discipline01b_roles._workspace_code``; migration tests pin their parity.
    """
    normalized = normalize_sub_role(slug)
    return f"{parent}_{normalized}" if normalized else None


def workspace_sub_role_slug(parent: str, code: str) -> str:
    """Recover the legacy/form slug from a workspace role's parent-qualified catalog code."""
    return code.removeprefix(f"{parent}_")


def catalog_slugs(
    catalog: dict[str, Iterable[Any]] | None,
    role: str | None = None,
) -> set[str] | None:
    """Allowed sub-role slugs from a workspace catalog.

    ``None`` catalog means the caller has nothing to enforce (skip). An empty
    catalog means no slugs are allowed. ``role`` None/flex unions every role;
    a registration code (tank/damage/support) returns that role only.
    """
    if catalog is None:
        return None
    codes: Iterable[str] = (role,) if role and role != "flex" else catalog.keys()
    slugs: set[str] = set()
    for code in codes:
        for entry in catalog.get(code, []) or []:
            raw = entry.get("slug") if isinstance(entry, dict) else getattr(entry, "slug", None)
            slug = normalize_sub_role(raw if isinstance(raw, str) else None)
            if slug:
                slugs.add(slug)
    return slugs


def canonical_to_registration_role(role: Any) -> str | None:
    """Normalize a role, narrowed to the three roles a registration can name.

    ``None`` for ``flex`` and for anything unrecognised, which is what the
    sub-role catalog lookups need: flex has no catalog to index.
    """
    canonical = normalize_role(role)
    return canonical if canonical in REGISTRATION_ROLE_CODES else None


def build_subrole_catalog(ontology: Ontology, workspace_id: int | None) -> dict[str, list[dict[str, str]]]:
    """``{top-level role code: [{"slug": suffix, "label": name}]}`` of active, selectable workspace sub-roles.

    Every top-level role of the rated dimension gets a key, so the frontend always receives a stable shape.
    """
    rated = ontology.rated.code
    return {
        root.code: [
            {"slug": workspace_sub_role_slug(root.code, child.code), "label": child.name}
            for child in ontology.roles(rated)
            if child.parent_id == root.id and child.workspace_id == workspace_id and child.active and child.selectable
        ]
        for root in ontology.roots(rated)
    }
