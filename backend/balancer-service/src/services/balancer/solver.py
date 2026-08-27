from __future__ import annotations

import asyncio
from typing import Any

from src.domain.balancer.runtime import balance_teams, balance_teams_tournament


async def run_balance(
    input_data: dict[str, Any],
    config_overrides: dict[str, Any] | None,
    progress_callback,
    role_mask: dict[str, int] | None = None,
) -> dict[str, Any]:
    variants = await asyncio.to_thread(
        balance_teams_tournament,
        input_data,
        config_overrides,
        progress_callback,
        role_mask,
    )
    return {"variants": variants}


async def run_mix_balance(
    input_data: dict[str, Any],
    config_overrides: dict[str, Any] | None,
    progress_callback,
    role_mask: dict[str, int] | None = None,
) -> dict[str, Any]:
    """Pickup-mix entry point: pins the mix_balancer backend.

    Mixes are always exactly 2 teams (see ``domain/balancer/backends/mix_balancer.py``),
    so this is the one call site allowed to request it; tournament balancing
    (``run_balance`` above) stays on ``tournament_balancer``.
    """
    variants = await asyncio.to_thread(
        balance_teams,
        input_data,
        config_overrides,
        progress_callback,
        role_mask,
        algorithm="mix_balancer",
    )
    return {"variants": variants}
