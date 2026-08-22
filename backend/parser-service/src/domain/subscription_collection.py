"""Pure, session-free primitives for subscription collection sweeps.

See ``backend/ARCHITECTURE.md``'s "domain/ boundary" — no ``AsyncSession``,
``await``, or ``asyncio`` anywhere in this module.
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = ("TournamentTarget",)


@dataclass(frozen=True, slots=True)
class TournamentTarget:
    """One tournament the collector should sweep, with the rule it must check.

    ``providers`` comes from the form's own requirement rather than a hardcoded
    list: resolving a provider the tournament does not require costs a provider
    call, persists an entitlement nobody reads, and — now that attempts are
    logged — buries the real history under ``provider_not_configured`` noise.
    """

    tournament_id: int
    workspace_id: int
    providers: tuple[str, ...]


def _chunked(items: list[int], size: int) -> list[list[int]]:
    return [items[i : i + size] for i in range(0, len(items), size)]
