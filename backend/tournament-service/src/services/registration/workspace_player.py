"""Attach registrations to workspace_player and resolve ranks for reads."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from types import SimpleNamespace
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from shared.division_grid import DivisionGrid
from shared.domain.workspace_player import ResolvedRank
from shared.services.workspace_player import workspace_player_service
from src import models

__all__ = (
    "attach_workspace_player",
    "clear_role_rank_values",
    "incoming_role_ranks",
    "resolve_registration_ranks",
    "resolved_value_map",
    "write_follow_ranks",
)


def incoming_role_ranks(roles: Sequence[Any] | None) -> dict[str, int]:
    out: dict[str, int] = {}
    for role in roles or []:
        if isinstance(role, Mapping):
            code, value = role.get("role"), role.get("rank_value")
        else:
            code, value = getattr(role, "role", None), getattr(role, "rank_value", None)
        if code and value is not None:
            out[str(code)] = int(value)
    return out


def clear_role_rank_values(roles: Sequence[Any] | None) -> None:
    for role in roles or []:
        if hasattr(role, "rank_value"):
            role.rank_value = None


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


async def write_follow_ranks(
    session: AsyncSession,
    registration: models.BalancerRegistration,
    ranks: Mapping[str, int],
    *,
    only_empty: bool = False,
) -> dict[str, int]:
    if not ranks or not registration.workspace_player_id:
        return {}
    return await workspace_player_service.set_ranks(
        session,
        workspace_player_id=registration.workspace_player_id,
        ranks=ranks,
        only_empty=only_empty,
    )


def _resolved_for_role(registration: Any, role: Any, batch: ResolvedRank | None) -> ResolvedRank:
    if getattr(registration, "balancer_profile_overridden_at", None) is not None and getattr(
        role, "rank_value", None
    ) is not None:
        return ResolvedRank(role.rank_value, "override")
    if batch is not None:
        return batch
    if getattr(role, "rank_value", None) is not None:
        return ResolvedRank(role.rank_value, "override")
    return ResolvedRank(None, "none")


async def resolve_registration_ranks(
    session: AsyncSession,
    registrations: Sequence[Any],
    *,
    grid: DivisionGrid | None = None,
) -> dict[int, dict[str, ResolvedRank]]:
    by_wp: dict[int, Any] = {}
    for reg in registrations:
        wpid = getattr(reg, "workspace_player_id", None)
        if wpid is None:
            continue
        player_id = _player_id_for(reg)
        existing = by_wp.get(wpid)
        if existing is None:
            by_wp[wpid] = SimpleNamespace(id=wpid, player_id=player_id)
        elif existing.player_id is None and player_id is not None:
            existing.player_id = player_id
    roles = sorted(
        {
            getattr(role, "role")
            for reg in registrations
            for role in (getattr(reg, "roles", None) or [])
            if getattr(role, "role", None)
        }
    )
    batch = await workspace_player_service.resolve_ranks(
        session, players=list(by_wp.values()), roles=roles, grid=grid
    )
    out: dict[int, dict[str, ResolvedRank]] = {}
    for reg in registrations:
        rid = getattr(reg, "id", None)
        if rid is None:
            continue
        wpid = getattr(reg, "workspace_player_id", None)
        per_role: dict[str, ResolvedRank] = {}
        for role in getattr(reg, "roles", None) or []:
            code = getattr(role, "role", None)
            if not code:
                continue
            hit = batch.get((wpid, code)) if wpid is not None else None
            per_role[code] = _resolved_for_role(reg, role, hit)
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
