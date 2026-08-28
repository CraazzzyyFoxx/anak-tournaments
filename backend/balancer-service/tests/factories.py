"""Shared ``Player`` test-double builder for balancer-service.

Every balancer test module used to hand-roll its own ``make_player``/``MASK``
pair with the same 1/2/2 Tank/Damage/Support role mask and the same
``name=f"P{uuid}"`` convention, diverging only in whether ``ratings`` or
``preferences`` was the required argument. Centralized here so the mapping
onto ``src.domain.balancer.entities.Player`` only needs to match once.
"""

from __future__ import annotations

from src.domain.balancer.entities import Player

#: Default Tank/Damage/Support role mask shared by every test that doesn't
#: care about a custom roster shape.
DEFAULT_MASK: dict[str, int] = {"Tank": 1, "Damage": 2, "Support": 2}


def make_player(
    uuid: str,
    ratings: dict[str, int] | None = None,
    preferences: list[str] | None = None,
    *,
    extra_roles: list[str] | None = None,
    is_flex: bool = False,
    mask: dict[str, int] | None = None,
) -> Player:
    """Build a ``Player`` test double.

    Pass ``ratings`` directly (``preferences`` defaults to its keys), or pass
    only ``preferences`` to derive ratings automatically: preferred roles get
    2000, ``extra_roles`` (playable but not preferred -- used for flex
    coverage) get 1500.
    """
    if ratings is None:
        if preferences is None:
            raise ValueError("make_player requires ratings or preferences")
        ratings = dict.fromkeys(preferences, 2000)
        for role in extra_roles or []:
            ratings.setdefault(role, 1500)
    elif extra_roles:
        raise ValueError("extra_roles only applies when deriving ratings from preferences")
    if preferences is None:
        preferences = list(ratings.keys())
    return Player(
        name=f"P{uuid}",
        ratings=ratings,
        preferences=preferences,
        uuid=uuid,
        mask=mask or DEFAULT_MASK,
        is_flex=is_flex,
    )
