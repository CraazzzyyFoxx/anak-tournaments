"""Who runs a draft, and who may act for any of its teams, by owner (spec §9.6).

A tournament's draft is run by its workspace's ``team.create`` holders, and its workspace admins pick for any team;
a mix lobby's draft by the mix's hosts (host, co-hosts, superuser) in both roles. Captains act for their own team
through the engine's captain check, never through here.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.models.draft import DraftSession, DraftTeam
from shared.rpc.identity import ensure_workspace_permission
from shared.services.mix_hosts import is_mix_host

__all__ = ("acts_for_any_team", "ensure_organizer", "ensure_team_actor")


async def ensure_organizer(session: AsyncSession, user: Any, draft: DraftSession, action: str = "create") -> None:
    """403 unless ``user`` runs this draft: the tournament workspace's ``team.<action>``, or a host of the mix."""
    if draft.tournament_id is not None:
        ensure_workspace_permission(user, draft.workspace_id, "team", action)
    elif not await is_mix_host(session, user, draft.custom_game_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only the mix's host or a co-host runs this draft"
        )


async def acts_for_any_team(session: AsyncSession, user: Any, draft: DraftSession) -> bool:
    """Whether ``user`` may pick for whichever team is on the clock: a tournament's workspace admin, a mix's host."""
    if draft.tournament_id is not None:
        return user.is_workspace_admin(draft.workspace_id)
    return await is_mix_host(session, user, draft.custom_game_id)


async def ensure_team_actor(
    session: AsyncSession, user: Any, draft: DraftSession, team: DraftTeam, action: str
) -> None:
    """A team's own captain, else whoever runs the draft. Team-scoped data (the fit column, the pick queue) is the
    captain's; an organizer reaches it through the rights they already hold. Nobody else."""
    if team.captain_auth_user_id is not None and team.captain_auth_user_id == user.id:
        return
    await ensure_organizer(session, user, draft, action)
