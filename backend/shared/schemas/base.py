"""Minimal read-model primitives shared by every service's ``schemas`` package.

``BaseRead``/``LookupItem`` carry no per-service behavior, so there is exactly
one definition here; each service's local ``schemas/base.py`` re-exports the
subset it needs.

Not for analytics-service: its ``BaseRead`` mixin (``id`` + ``created_at`` +
``updated_at``, ``from_attributes=True``) is a different, legitimately local
shape and must not be conflated with this one.
"""

from pydantic import BaseModel

__all__ = ("BaseRead", "LookupItem")


class BaseRead(BaseModel):
    id: int


class LookupItem(BaseModel):
    id: int
    name: str
