"""Eager-load option sets for draft rows.

``DraftPlayer`` no longer carries roles or ranks (``draftreg1`` deleted the
snapshot), so what has to be eager-loaded is its identity: the member behind
``user_id``, and the registration the roster engine resolves from -- with the
engine's own option set attached, so one query feeds both.

Async code must eager-load these; a lazy load would raise ``MissingGreenlet``.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import selectinload

from shared.models.balancer.draft import DraftPick, DraftPlayer, DraftTeam
from shared.services.roster import registration_load_options

__all__ = ("pick_options", "player_options", "team_options")


def player_options() -> list[Any]:
    """The member (``user_id``) plus the registration the engine reads."""
    return [
        selectinload(DraftPlayer.member),
        *(selectinload(DraftPlayer.registration).options(option) for option in registration_load_options()),
    ]


def team_options() -> list[Any]:
    """``DraftTeam.captain_user_id`` reads ``captain_member``."""
    return [selectinload(DraftTeam.captain_member)]


def pick_options() -> list[Any]:
    """``DraftPick.picked_by_user_id`` reads ``picked_by_member``."""
    return [selectinload(DraftPick.picked_by_member)]
