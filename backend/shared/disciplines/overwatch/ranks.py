"""Overwatch's native rank layer (D87, spec §8.5): the newest OverFast snapshot of every Battle.net account a player
owns, the best per role. ``overwatch_rank.*`` and the collector that fills it are the module's data and task; the
collector still runs inside stats-service until P5 re-homes module tasks (D94)."""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from shared.services import rank_snapshots

__all__ = ("best_rank_per_role", "native_ranks")


def best_rank_per_role(accounts: Mapping[int, Mapping[str, Mapping[str, int]]]) -> dict[int, dict[str, int]]:
    """``{user_id: {battle_tag: {role: rank}}}`` -> ``{user_id: {role: best rank}}``: smurfs are one player."""
    out: dict[int, dict[str, int]] = {}
    for user_id, by_tag in accounts.items():
        by_role: dict[str, int] = {}
        for ranks in by_tag.values():
            for role, value in ranks.items():
                previous = by_role.get(role)
                if previous is None or value > previous:
                    by_role[role] = value
        if by_role:
            out[user_id] = by_role
    return out


async def native_ranks(session: AsyncSession, user_ids: Sequence[int]) -> dict[int, dict[str, int]]:
    # Looked up on the module at call time, so a test patches ``rank_snapshots`` itself.
    return best_rank_per_role(await rank_snapshots.fetch_latest_ow_ranks_by_account(session, list(user_ids)))
