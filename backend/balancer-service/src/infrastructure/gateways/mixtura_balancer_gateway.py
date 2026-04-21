from __future__ import annotations

import json
from typing import Any

from src.mixtura_balancer_adapter import from_mixtura_response, to_mixtura_request


class MixturaBalancerGateway:
    def __init__(self, *, broker) -> None:
        self._broker = broker

    async def run(
        self,
        *,
        input_data: dict[str, Any],
        config_overrides: dict[str, Any],
        max_solutions: int,
        mixtura_queue: str,
    ) -> list[dict[str, Any]]:
        request_payload = to_mixtura_request(input_data, config_overrides)
        msg = await self._broker.request(request_payload, queue=mixtura_queue, timeout=600)
        if msg is None:
            raise RuntimeError("mixtura-balancer returned no response (timeout or queue unavailable)")

        raw_body: bytes = msg.body if isinstance(msg.body, bytes) else bytes(msg.body)
        envelope = json.loads(raw_body.decode("utf-8"))
        status_code = envelope.get("status", 0)
        if status_code != 200:
            error_msg = envelope.get("message", {})
            if isinstance(error_msg, dict):
                error_msg = error_msg.get("message", str(error_msg))
            raise RuntimeError(f"mixtura-balancer error (status={status_code}): {error_msg}")

        draft_balances: dict = envelope.get("message", envelope)
        return from_mixtura_response(
            draft_balances=draft_balances,
            input_data=input_data,
            config_overrides=config_overrides,
            max_solutions=max_solutions,
        )
