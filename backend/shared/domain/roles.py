"""A discipline's role ontology as one workspace sees it (D31, D34, D86; spec §8.3).

Built from ``catalog.role_dimension`` and ``catalog.role`` rows -- the module's roles plus one workspace's own sub-roles
-- by ``shared.repository.roles.CatalogRoleRepository.ontology``. Pure: team-format checks, the slot projection and every
code <-> id translation run on it without IO. Trees are tens of nodes, so descendants are walked here (D34).
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

__all__ = (
    "DimensionNode",
    "Ontology",
    "RoleNode",
    "UnknownRole",
    "public_role_attrs",
    "validate_presentation",
)

logger = logging.getLogger(__name__)

_ICON_MAX = 512
_ICON_FORBIDDEN = re.compile(r"""[\s'"<>\\]""")
_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


def validate_presentation(attrs: Mapping[str, object], *, discipline: str) -> None:
    """Refuse a role ``icon``/``color`` that is not an image reference or a plain hex color (§1.5).

    Other keys are left alone: ``attrs`` never confers role membership. Raises ``ValueError``.
    """
    if "icon" in attrs and (icon := attrs["icon"]) is not None:
        game = re.escape(discipline)
        allowed = (
            re.compile(r"^https://\S+$"),
            re.compile(rf"^assets/{game}/[a-z0-9_/-]+\.(svg|png|webp)$"),
            re.compile(rf"^/disciplines/{game}/[a-z0-9_/-]+\.(svg|png|webp)$"),
        )
        if (
            not isinstance(icon, str)
            or len(icon) > _ICON_MAX
            or _ICON_FORBIDDEN.search(icon)
            or ".." in icon
            or not any(pattern.match(icon) for pattern in allowed)
        ):
            raise ValueError(
                "icon must be an https URL, an assets/<discipline>/ key or a /disciplines/<discipline>/ path"
            )
    if (
        "color" in attrs
        and (color := attrs["color"]) is not None
        and not (isinstance(color, str) and _COLOR.match(color))
    ):
        raise ValueError("color must be #RRGGBB")


def public_role_attrs(attrs: Mapping[str, object], *, public_origin: str | None) -> dict[str, Any]:
    """``attrs`` as the wire shows it: raw keys kept, a stored ``assets/`` object key resolved to its public URL.

    Without a configured public origin the icon is ``None`` (one warning), never an error and never a storage probe.
    """
    out = dict(attrs)
    icon = out.get("icon")
    if isinstance(icon, str) and icon.startswith("assets/"):
        if public_origin:
            out["icon"] = f"{public_origin.rstrip('/')}/{icon}"
        else:
            logger.warning("S3 public URL is not configured; role icon %r is served as null", icon)
            out["icon"] = None
    return out


class UnknownRole(ValueError):
    """A ``(dimension, role)`` pair, or a role id, this ontology does not hold."""


@dataclass(frozen=True, slots=True)
class DimensionNode:
    id: int
    code: str
    name: str
    selection_mode: str
    rated: bool
    active: bool = True
    sort_order: int = 0


@dataclass(frozen=True, slots=True)
class RoleNode:
    id: int
    dimension_id: int
    dimension: str
    code: str
    name: str
    parent_id: int | None = None
    workspace_id: int | None = None
    active: bool = True
    selectable: bool = True
    sort_order: int = 0
    #: Raw ``catalog.role.attrs`` (``icon``/``color`` presentation); never role membership.
    attrs: Mapping[str, object] = field(default_factory=dict, hash=False, compare=False)


class Ontology:
    def __init__(self, discipline: str, dimensions: Iterable[DimensionNode], roles: Iterable[RoleNode]) -> None:
        self.discipline = discipline
        self.dimensions: dict[str, DimensionNode] = {dimension.code: dimension for dimension in dimensions}
        ordered = sorted(roles, key=lambda role: (role.sort_order, role.code))
        self._by_id = {role.id: role for role in ordered}
        self._by_code = {(role.dimension, role.code): role for role in ordered}
        self._children: dict[int, list[RoleNode]] = {}
        for role in ordered:
            if role.parent_id is not None:
                self._children.setdefault(role.parent_id, []).append(role)

    @property
    def rated(self) -> DimensionNode:
        rated = [dimension for dimension in self.dimensions.values() if dimension.rated]
        if len(rated) != 1:
            raise LookupError(f"{self.discipline}: expected exactly one rated dimension, found {len(rated)} (D32)")
        return rated[0]

    def node(self, dimension: str, code: str) -> RoleNode:
        try:
            return self._by_code[(dimension, code)]
        except KeyError:
            raise UnknownRole(f"{self.discipline} has no role {code!r} in dimension {dimension!r}") from None

    def by_id(self, role_id: int) -> RoleNode:
        try:
            return self._by_id[role_id]
        except KeyError:
            raise UnknownRole(f"{self.discipline} has no role with id {role_id}") from None

    def parent(self, role: RoleNode) -> RoleNode | None:
        return None if role.parent_id is None else self._by_id.get(role.parent_id)

    def root(self, role: RoleNode) -> RoleNode:
        """The top-level ancestor: what a leaf assignment counts as on its dimension (D86)."""
        seen = {role.id}
        while (parent := self.parent(role)) is not None and parent.id not in seen:
            seen.add(parent.id)
            role = parent
        return role

    def subtree(self, role: RoleNode) -> frozenset[int]:
        """``role`` and every descendant, by id; cycle-safe (D34: cycles are refused on write, not trusted here)."""
        found: set[int] = set()
        stack = [role]
        while stack:
            node = stack.pop()
            if node.id in found:
                continue
            found.add(node.id)
            stack.extend(self._children.get(node.id, ()))
        return frozenset(found)

    def roots(self, dimension: str) -> tuple[RoleNode, ...]:
        """Top-level roles of ``dimension`` in display order (a workspace sub-role always has a parent)."""
        return tuple(role for role in self._by_id.values() if role.dimension == dimension and role.parent_id is None)

    def roles(self, dimension: str) -> tuple[RoleNode, ...]:
        return tuple(role for role in self._by_id.values() if role.dimension == dimension)
