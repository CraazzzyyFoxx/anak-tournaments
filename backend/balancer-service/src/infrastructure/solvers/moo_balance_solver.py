from __future__ import annotations

import asyncio
from typing import Any

from src.application.balancer.runtime_service import balance_teams_moo


class MooBalanceSolver:
    async def solve(
        self,
        input_data: dict[str, Any],
        config_overrides: dict[str, Any],
        progress_callback,
    ) -> dict[str, Any]:
        variants = await asyncio.to_thread(balance_teams_moo, input_data, config_overrides, progress_callback)
        return {"variants": variants}
