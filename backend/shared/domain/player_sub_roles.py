from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any, Protocol

from shared.core.enums import HeroClass

# Registration uses the short codes tank/dps/support (``HeroClass.slot_code``),
# while the canonical PlayerSubRole catalog uses tank/damage/support
# (``HeroClass.name``). ``HeroClass`` is the single source of truth for both;
# these are just its 3 non-flex members projected into each vocabulary.
_REGISTRATION_ROLES: tuple[HeroClass, ...] = (HeroClass.tank, HeroClass.damage, HeroClass.support)
REGISTRATION_ROLE_CODES: tuple[str, ...] = tuple(role.slot_code for role in _REGISTRATION_ROLES)
REGISTRATION_TO_CANONICAL: dict[str, str] = {role.slot_code: role.name for role in _REGISTRATION_ROLES}
_CANONICAL_TO_REGISTRATION: dict[str, str] = {role.name: role.slot_code for role in _REGISTRATION_ROLES}


def normalize_role(role: Any) -> str | None:
    if role is None:
        return None

    parsed = HeroClass.parse(role)
    if parsed is not None:
        return parsed.name

    value = str(role).strip().lower()
    return value or None


def normalize_sub_role(sub_role: str | None) -> str | None:
    if sub_role is None:
        return None

    normalized = re.sub(r"\s+", "_", sub_role.strip().lower())
    return normalized or None


def catalog_slugs(
    catalog: dict[str, Iterable[Any]] | None,
    role: str | None = None,
) -> set[str] | None:
    """Allowed sub-role slugs from a workspace catalog.

    ``None`` catalog means the caller has nothing to enforce (skip). An empty
    catalog means no slugs are allowed. ``role`` None/flex unions every role;
    a registration code (tank/dps/support) returns that role only.
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


def registration_to_canonical_role(role: Any) -> str | None:
    """Map a registration role code (tank/dps/support) to its canonical name."""
    return normalize_role(role)


def canonical_to_registration_role(role: Any) -> str | None:
    """Map a canonical role (tank/damage/support) to a registration code."""
    canonical = normalize_role(role)
    if canonical is None:
        return None
    return _CANONICAL_TO_REGISTRATION.get(canonical)


class SubRoleRow(Protocol):
    """Duck-typed PlayerSubRole row used to build the catalog."""

    role: str
    slug: str
    label: str


def build_subrole_catalog(
    rows: Iterable[SubRoleRow],
) -> dict[str, list[dict[str, str]]]:
    """Group catalog rows by registration role code, preserving input order.

    Returns ``{reg_code: [{"slug": ..., "label": ...}]}`` for every registration
    role code, so the frontend always receives a stable shape. Callers should
    pass rows already sorted (role, sort_order, label).
    """
    catalog: dict[str, list[dict[str, str]]] = {code: [] for code in REGISTRATION_ROLE_CODES}
    for row in rows:
        reg_code = canonical_to_registration_role(getattr(row, "role", None))
        if reg_code is None or reg_code not in catalog:
            continue
        slug = normalize_sub_role(getattr(row, "slug", None))
        if slug is None:
            continue
        label = getattr(row, "label", None) or slug
        catalog[reg_code].append({"slug": slug, "label": str(label)})
    return catalog
