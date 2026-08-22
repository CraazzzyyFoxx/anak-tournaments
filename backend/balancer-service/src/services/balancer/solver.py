from __future__ import annotations

import asyncio
from typing import Any

from src.domain.balancer.runtime import balance_teams_moo


async def run_balance(
    input_data: dict[str, Any],
    config_overrides: dict[str, Any] | None,
    progress_callback,
    role_mask: dict[str, int] | None = None,
) -> dict[str, Any]:
    variants = await asyncio.to_thread(
        balance_teams_moo,
        input_data,
        config_overrides,
        progress_callback,
        role_mask,
    )
    return {"variants": variants}
