"""Single source of truth for "what rank does a player have on a given role".

Rank is a function of ``(player, role)``: the per-role catalogue
(``DraftPlayer.role_ranks``) is authoritative, with ``rank_value`` (the
primary-role default) as the fallback when a role has no specific entry.

A role-less roster (every slot ``flex``) has no role for rank to be a function
of: nobody is assigned one, so no single role's rank can stand for the player
and their strongest -- :func:`max_role_rank` -- does instead. :func:`slot_rank`
is the shape-aware entry point every writer and reader goes through, so the
frozen pick, the team export and the board snapshot cannot disagree about the
rank a flex draft shows.
"""

from __future__ import annotations

from shared.core.enums import HeroClass
from shared.domain.roster_shape import RosterShape
from shared.models.balancer.draft import DraftPlayer


def role_rank(player: DraftPlayer, role: HeroClass | str | None) -> int | None:
    """Return the player's rank for ``role``, falling back to ``rank_value``."""
    if role is None:
        return player.rank_value
    key = role.slot_code if isinstance(role, HeroClass) else str(role)
    value = (player.role_ranks or {}).get(key)
    return value if value is not None else player.rank_value


def max_role_rank(player: DraftPlayer) -> int | None:
    """The player's best rank across every role they carry one for.

    ``rank_value`` joins the candidates instead of only serving as a fallback:
    it is what :func:`role_rank` answers for any role missing from the
    catalogue, so leaving it out could return a maximum below a rank the player
    demonstrably has on a playable role.
    """
    candidates = (*(player.role_ranks or {}).values(), player.rank_value)
    return max((value for value in candidates if value is not None), default=None)


def slot_rank(player: DraftPlayer, role: HeroClass | str | None, shape: RosterShape) -> int | None:
    """The rank that represents ``player`` on their roster slot under ``shape``.

    Role slots keep rank role-specific; a role-less roster makes it the maximum.
    ``role=None`` is the honest input for a player holding no role yet -- a pool
    card, or a captain seeded straight into a roster.
    """
    return role_rank(player, role) if shape.has_role_slots else max_role_rank(player)
