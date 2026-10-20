"""Normalize stored solver slot keys; an open slot is not a catalog role."""

from __future__ import annotations

__all__ = ("role_slot_code",)


def role_slot_code(role_name: str) -> str:
    """Canonicalize a slot key without a game-specific role enum."""
    return role_name.strip().lower()
