from __future__ import annotations

from typing import Any

from src.core.config import AlgorithmConfig


class MixturaBalancerSolver:
    def __init__(self, *, gateway) -> None:
        self._gateway = gateway

    async def solve(
        self,
        input_data: dict[str, Any],
        config_overrides: dict[str, Any],
        progress_callback,
    ) -> dict[str, Any]:
        max_solutions = int(config_overrides.get("max_result_variants", AlgorithmConfig().max_result_variants))
        mixtura_queue = config_overrides.get("mixtura_queue", AlgorithmConfig().mixtura_queue)
        variants = await self._gateway.run(
            input_data=input_data,
            config_overrides=config_overrides,
            max_solutions=max_solutions,
            mixtura_queue=mixtura_queue,
        )
        return {"variants": variants}
