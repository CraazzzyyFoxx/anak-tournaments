from __future__ import annotations

import asyncio
from typing import Any

from src.cpsat_bridge import run_cpsat


class CpsatBalanceSolver:
    async def solve(
        self,
        input_data: dict[str, Any],
        config_overrides: dict[str, Any],
        progress_callback,
    ) -> dict[str, Any]:
        max_solutions = int(config_overrides.get("max_result_variants", 3))
        variants = await asyncio.to_thread(run_cpsat, input_data, max_solutions)
        return {"variants": variants}
