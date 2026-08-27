"""Effective tournament ranks for a registration's roles.

``registration_role.rank_value`` is only the strongest of three layers -- the
number the organiser typed, then the workspace canon, then the latest OW
snapshot (``TOURNAMENT_ORDER``). An empty ``rank_value`` therefore *inherits*
rather than reading as "unranked", which is the whole point: while this resolver
was stubbed out it answered ``none`` for every blank role, and canon-ranked
players silently fell out of the balancer pool.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.division_grid import DivisionGrid
from shared.domain.member_rank import ResolvedRank, pick_rank
from shared.services.member_rank import TOURNAMENT_ORDER, member_rank_service
from src import models

__all__ = (
    "resolve_registration_ranks",
    "resolved_value_map",
)


def _registration_layer(roles: Mapping[str, int | None]) -> dict[str, ResolvedRank]:
    """The layer a registration owns outright. Independent of any member anchor:
    the organiser's number is the registration's own, only the *inherited* layers
    need an identity."""
    return {role: pick_rank([("registration", value)]) for role, value in roles.items()}


async def _players_by_member(
    session: AsyncSession, *, workspace_id: int, member_ids: Sequence[int]
) -> dict[int, int | None]:
    """``{workspace_member_id: players.user.id}`` -- what the OW layer keys on.

    Queried rather than read off an eager-loaded ``workspace_member``: a caller
    that forgot the loader would otherwise lose the OW fallback with no error
    anywhere, and the cost is one indexed ``IN`` beside the rank reads
    ``member_rank_service.resolve`` already issues. The workspace filter makes a
    member belonging to another tenant resolve to nothing.
    """
    rows = await session.execute(
        sa.select(models.WorkspaceMember.id, models.WorkspaceMember.player_id).where(
            models.WorkspaceMember.workspace_id == workspace_id,
            models.WorkspaceMember.id.in_(list(member_ids)),
        )
    )
    return {member_id: player_id for member_id, player_id in rows.all()}


async def resolve_registration_ranks(
    session: AsyncSession,
    registrations: Sequence[Any],
    *,
    workspace_id: int | None,
    grid: DivisionGrid | None = None,
) -> dict[int, dict[str, ResolvedRank]]:
    """``{registration_id: {role: ResolvedRank}}`` under ``TOURNAMENT_ORDER``.

    ``workspace_id`` is the registrations' tournament's workspace; ``None`` means
    the caller had no tournament in hand, and guessing a tenancy is worse than
    answering from the registration alone. A registration with no
    ``workspace_member_id`` answers from its own layer for the same reason --
    there is no identity to inherit the canon or an OW snapshot through.

    Callers pass one tournament's registrations, so a workspace member appears at
    most once here -- the partial unique index on ``(tournament_id,
    workspace_member_id)`` is what makes the member-keyed maps below unambiguous.
    """
    own: dict[int, dict[str, int | None]] = {}
    member_of: dict[int, int] = {}
    for registration in registrations:
        registration_id = getattr(registration, "id", None)
        if registration_id is None:
            continue
        roles: dict[str, int | None] = {}
        for role in getattr(registration, "roles", None) or []:
            code = getattr(role, "role", None)
            if code:
                roles[code] = getattr(role, "rank_value", None)
        own[registration_id] = roles
        member_id = getattr(registration, "workspace_member_id", None)
        if member_id is not None and roles:
            member_of[registration_id] = member_id

    if workspace_id is None or not member_of:
        return {registration_id: _registration_layer(roles) for registration_id, roles in own.items()}

    resolved = await member_rank_service.resolve(
        session,
        workspace_id=workspace_id,
        members=await _players_by_member(session, workspace_id=workspace_id, member_ids=list(member_of.values())),
        roles=sorted({code for registration_id in member_of for code in own[registration_id]}),
        order=TOURNAMENT_ORDER,
        registration_ranks={
            (member_id, code): value
            for registration_id, member_id in member_of.items()
            for code, value in own[registration_id].items()
            if value is not None
        },
        grid=grid,
    )

    out: dict[int, dict[str, ResolvedRank]] = {}
    for registration_id, roles in own.items():
        # The own layer doubles as the fallback, so a member the workspace filter
        # rejected cannot blank out the number the organiser typed.
        fallback = _registration_layer(roles)
        member_id = member_of.get(registration_id)
        out[registration_id] = (
            fallback
            if member_id is None
            else {code: resolved.get((member_id, code), rank) for code, rank in fallback.items()}
        )
    return out


async def resolved_value_map(
    session: AsyncSession,
    registration: Any,
    *,
    workspace_id: int | None,
    grid: DivisionGrid | None = None,
) -> dict[str, int | None]:
    """``{role: effective rank}`` for one registration -- what the ready/incomplete
    balancer status is computed from."""
    by_id = await resolve_registration_ranks(session, [registration], workspace_id=workspace_id, grid=grid)
    return {role: rank.value for role, rank in by_id.get(getattr(registration, "id", None), {}).items()}
