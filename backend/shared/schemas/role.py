"""A role on the wire: ``{dimension, role}`` codes, never ids and never an enum."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from shared.domain.roles import Ontology, RoleNode

__all__ = ("RoleRef",)


class RoleRef(BaseModel):
    """``role`` is the leaf an assignment names; ``parent`` is derived and ignored on input."""

    model_config = ConfigDict(frozen=True)

    dimension: str = Field(min_length=1, max_length=32)
    role: str = Field(min_length=1, max_length=64)
    parent: str | None = None

    @classmethod
    def of(cls, dimension: str, role: str | None, sub_role: str | None = None) -> RoleRef | None:
        """From a ``(top-level role, sub-role)`` pair: the leaf is the sub-role when there is one."""
        if role is None:
            return None
        return cls(dimension=dimension, role=sub_role or role, parent=role if sub_role else None)

    @classmethod
    def of_node(cls, ontology: Ontology, node: RoleNode) -> RoleRef:
        parent = ontology.parent(node)
        return cls(dimension=node.dimension, role=node.code, parent=None if parent is None else parent.code)
