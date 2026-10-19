"""Public balancer config read over typed RPC.

``GET /api/balancer/config?discipline=<code>`` -> ``rpc.balancer.config`` (no auth). Validates the payload through
``BalancerConfigResponse`` to mirror the HTTP ``response_model`` serialization exactly. The role weights it draws are the
named game's (no ``discipline``: every role neutral); an uninstalled code is 404 ``discipline_not_installed``.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

from shared.disciplines import DISCIPLINES
from shared.rpc import common as c
from shared.schemas.rpc import rpc_error, rpc_ok
from src.schemas import BalancerConfigResponse
from src.services.balancer import jobs

# The public config payload is derived purely from process constants (presets,
# defaults, limits, the installed games' declarations), so validate + dump it
# once per game per process instead of on every request.
_config_payloads: dict[str | None, dict[str, Any]] = {}


def _get_config_payload(discipline: str | None) -> dict[str, Any]:
    if discipline not in _config_payloads:
        _config_payloads[discipline] = BalancerConfigResponse.model_validate(jobs.get_config(discipline)).model_dump(
            mode="json"
        )
    return _config_payloads[discipline]


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.balancer.config")
    async def _config(data: dict, msg: RabbitMessage) -> dict:
        discipline = c.q1(data, "discipline")
        if discipline is not None and discipline not in DISCIPLINES:
            return rpc_error("not_found", f"discipline_not_installed: {discipline!r}")
        try:
            return rpc_ok(_get_config_payload(discipline))
        except Exception:  # pragma: no cover - defensive worker guard
            logger.exception("balancer rpc failed: config")
            return rpc_error("internal", "internal error")
