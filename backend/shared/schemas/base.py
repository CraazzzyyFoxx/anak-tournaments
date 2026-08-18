"""Minimal read-model primitives shared by every service's ``schemas`` package.

Identical ``BaseRead``/``LookupItem``/``Score`` definitions used to be
copy-pasted verbatim into app-service, tournament-service, balancer-service,
parser-service, and stream-service. They carry no per-service behavior, so
there is exactly one definition here; each service's local ``schemas/base.py``
re-exports the subset it needs.

Not for analytics-service: its ``BaseRead`` mixin (``id`` + ``created_at`` +
``updated_at``, ``from_attributes=True``) is a different, legitimately local
shape and must not be conflated with this one.
"""

from pydantic import BaseModel

__all__ = ("BaseRead", "LookupItem", "Score")


class BaseRead(BaseModel):
    id: int


class LookupItem(BaseModel):
    id: int
    name: str


class Score(BaseModel):
    home: int
    away: int
