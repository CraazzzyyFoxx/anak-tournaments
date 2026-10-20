from __future__ import annotations

import asyncio
import functools
from dataclasses import asdict
from typing import Any

from shared.core.errors import BaseAPIException as HTTPException
from shared.domain.roles import DimensionNode, Ontology, RoleNode
from shared.domain.team_format import FormatDimension, FormatRule, TeamFormat
from src.domain.balancer.config.defaults import MAX_RESULT_VARIANTS
from src.domain.balancer.result_serializer import lobby_document
from src.domain.balancer.runtime import balance_teams

#: How many balance options one mix run hands back: the deepest pager the cap
#: allows. The brute-force mix engine has already enumerated every legal split
#: by the time it trims, so what a deeper pager costs is the stored document
#: every mix read ships, not the solve.
MIX_RESULT_VARIANTS = MAX_RESULT_VARIANTS


def serialize_format_context(team_format: TeamFormat, ontology: Ontology) -> dict[str, Any]:
    """Freeze an owner's format and ontology beside the queued player snapshot."""
    return {
        "team_format": asdict(team_format),
        "dimensions": [asdict(dimension) for dimension in ontology.dimensions.values()],
        "roles": [asdict(role) for dimension in ontology.dimensions for role in ontology.roles(dimension)],
    }


def _format_kwargs(input_data: dict[str, Any]) -> dict[str, Any]:
    snapshot = input_data.get("format_context")
    if snapshot is None:
        return {}
    raw = snapshot["team_format"]
    team_format = TeamFormat(
        **{key: value for key, value in raw.items() if key not in ("dimensions", "rules")},
        dimensions=tuple(FormatDimension(**entry) for entry in raw["dimensions"]),
        rules=tuple(FormatRule(**entry) for entry in raw["rules"]),
    )
    return {
        "team_format": team_format,
        "ontology": Ontology(
            team_format.discipline,
            [DimensionNode(**entry) for entry in snapshot["dimensions"]],
            [RoleNode(**entry) for entry in snapshot["roles"]],
        ),
    }


async def run_balance(
    input_data: dict[str, Any],
    config_overrides: dict[str, Any] | None,
    progress_callback,
    role_mask: dict[str, int] | None = None,
    *,
    discipline: str | None = None,
) -> dict[str, Any]:
    """Run the tournament solver off the event loop; a ``ValueError`` from it is a 422.

    ``discipline`` names the game of a payload that carries no owner format (the synchronous API); a payload with
    a frozen ``format_context`` is its own game's.
    """
    try:
        variants = await asyncio.to_thread(
            functools.partial(
                balance_teams,
                input_data,
                config_overrides,
                progress_callback,
                role_mask,
                discipline=discipline,
                **_format_kwargs(input_data),
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
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
    # A mix that stored its own override still wins.
    mix_overrides = {"max_result_variants": MIX_RESULT_VARIANTS, **(config_overrides or {})}
    variants = await asyncio.to_thread(
        balance_teams,
        input_data,
        mix_overrides,
        progress_callback,
        role_mask,
        algorithm="mix_balancer",
        **_format_kwargs(input_data),
    )
    # Stored on the mix and shipped with every read of it: each player once,
    # each option as seat ids (see ``lobby_document``).
    return lobby_document(variants)
