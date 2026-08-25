"""Attach registrations to workspace_player. Tournament ranks stay on the role."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from shared.division_grid import DivisionGrid
from shared.domain.workspace_player import ResolvedRank
from shared.services.workspace_player import workspace_player_service
from src import models

__all__ = (
    "attach_workspace_player",
    "resolve_registration_ranks",
    "resolved_value_map",
)


def _player_id_for(registration: Any) -> int | None:
    member = getattr(registration, "workspace_member", None)
    if member is not None and getattr(member, "player_id", None) is not None:
        return member.player_id
    return None


async def attach_workspace_player(
    session: AsyncSession,
    registration: models.BalancerRegistration,
    *,
    workspace_id: int | None,
    player_id: int | None = None,
    display_name: str | None = None,
) -> Any | None:
    if not workspace_id or not registration.battle_tag:
        return None
    wp = await workspace_player_service.upsert(
        session,
        workspace_id=workspace_id,
        battle_tag=registration.battle_tag,
        display_name=display_name if display_name is not None else registration.display_name,
    )
    registration.workspace_player_id = wp.id
    link_player_id = player_id if player_id is not None else _player_id_for(registration)
    if link_player_id is not None:
        wp = await workspace_player_service.link(
            session,
            workspace_player_id=wp.id,
            player_id=link_player_id,
            workspace_member_id=getattr(registration, "workspace_member_id", None),
        )
        registration.workspace_player_id = wp.id
    return wp


def _resolved_for_role(role: Any) -> ResolvedRank:
    value = getattr(role, "rank_value", None)
    if value is None:
        return ResolvedRank(None, "none")
    return ResolvedRank(value, "override")

async def resolve_registration_ranks(
    session: AsyncSession,
    registrations: Sequence[Any],
    *,
    grid: DivisionGrid | None = None,
) -> dict[int, dict[str, ResolvedRank]]:
    del session, grid
    out: dict[int, dict[str, ResolvedRank]] = {}
    for reg in registrations:
        rid = getattr(reg, "id", None)
        if rid is None:
            continue
        per_role: dict[str, ResolvedRank] = {}
        for role in getattr(reg, "roles", None) or []:
            code = getattr(role, "role", None)
            if not code:
                continue
            per_role[code] = _resolved_for_role(role)
        out[rid] = per_role
    return out


async def resolved_value_map(
    session: AsyncSession,
    registration: Any,
    *,
    grid: DivisionGrid | None = None,
) -> dict[str, int | None]:
    by_id = await resolve_registration_ranks(session, [registration], grid=grid)
    return {role: rr.value for role, rr in by_id.get(getattr(registration, "id", None), {}).items()}
