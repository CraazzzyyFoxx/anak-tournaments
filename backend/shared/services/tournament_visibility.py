"""Single source of truth for hidden-tournament authorization.

A hidden tournament — and all its nested data — is visible only to workspace
admins (``AuthUser.is_workspace_admin``, superuser included) and to logged-in
users on the tournament's preview allowlist. Everyone else must never see it:
it is filtered out of listings and every direct read returns **404** (not 403,
to avoid disclosing existence).

Every tournament-scoped read across tournament-service AND app-service routes
through this module. Gate coverage is the crux of the feature — see issue #115.

Cache note: public read serializers are cashews-cached WITHOUT the viewer.
``assert_tournament_viewable`` loads the tournament fresh (uncached) and must be
called BEFORE any cached read, so an ineligible viewer is rejected before the
shared cache is consulted.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.models.identity.auth_user import AuthUser
from shared.models.tournament.preview_access import TournamentPreviewAccess
from shared.models.tournament.tournament import Tournament
from shared.services.scrim_scope import is_scrim_container

__all__ = (
    "load_preview_user_ids",
    "can_view_tournament",
    "assert_tournament_viewable",
    "admin_visible_workspace_ids",
    "visible_tournaments_predicate",
    "visible_tournament_ids_subquery",
)


async def load_preview_user_ids(session: AsyncSession, tournament_id: int) -> set[int]:
    """Auth-user ids on a tournament's preview allowlist."""
    rows = await session.execute(
        sa.select(TournamentPreviewAccess.auth_user_id).where(TournamentPreviewAccess.tournament_id == tournament_id)
    )
    return {int(r) for r in rows.scalars().all()}


def can_view_tournament(user: AuthUser | None, tournament: Tournament, preview_user_ids: set[int]) -> bool:
    """Pure predicate: may ``user`` (possibly anonymous) see ``tournament``?"""
    if not tournament.is_hidden:
        return True
    if user is None:
        return False
    if user.is_workspace_admin(tournament.workspace_id):
        return True
    return int(user.id) in preview_user_ids


async def assert_tournament_viewable(session: AsyncSession, user: AuthUser | None, tournament_id: int) -> Tournament:
    """Load a tournament and gate it, returning it when viewable.

    Raises ``HTTPException(404)`` when the viewer may not see it — including when
    it does not exist — so a hidden tournament and a missing one are
    indistinguishable to outsiders.

    One hidden tournament is READ by a wider audience than it is LISTED to: a
    workspace's scrim container (``docs/plans/2026-08-12-scrim-rooms.md``). A
    scrim room is shared by link between two captains and watched by their
    teammates, none of whom are workspace admins, and the allowlist cannot solve
    it: a room's opponent must be able to READ the room before claiming a side,
    and it is the claim that would have added them. So for a scrim container,
    membership of the owning workspace is enough.

    This is deliberately narrower than "any hidden tournament". A hidden PREVIEW
    tournament is an unpublished real one, and leaking it to every member is
    exactly what preview mode exists to prevent — that keeps the admin/allowlist
    rule. It also brings this gate in line with the realtime one, which already
    treats workspace membership as the insider signal for spectating a hidden
    tournament (``gateway/internal/acl/acl.go:allowSpectate``).

    The token is an address, not a security boundary: any member of the workspace
    can reach a scrim room, and ``visible_tournaments_predicate`` still keeps the
    container out of every listing.
    """
    tournament = await session.scalar(sa.select(Tournament).where(Tournament.id == tournament_id))
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")
    if not tournament.is_hidden:
        return tournament

    if user is not None and await is_scrim_container(session, tournament_id):
        if user.is_superuser or tournament.workspace_id in user.get_workspace_ids():
            return tournament

    preview_user_ids: set[int] = set()
    # Only the allowlist lookup is conditional; admins/superusers short-circuit
    # without the extra query.
    if user is not None and not user.is_workspace_admin(tournament.workspace_id):
        preview_user_ids = await load_preview_user_ids(session, tournament_id)
    if not can_view_tournament(user, tournament, preview_user_ids):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")
    return tournament


def admin_visible_workspace_ids(user: AuthUser) -> list[int]:
    """Workspaces (from the JWT RBAC cache) where the user is a workspace admin."""
    return [ws for ws in user.get_workspace_ids() if user.is_workspace_admin(ws)]


def visible_tournaments_predicate(user: AuthUser | None) -> sa.ColumnElement[bool]:
    """SQL predicate for list filtering. Apply to BOTH the page and count query.

    - anonymous: only non-hidden tournaments.
    - superuser: everything (``sa.true()``).
    - logged-in: non-hidden OR in an admin workspace OR on the preview allowlist.
    """
    if user is not None and user.is_superuser:
        return sa.true()
    clauses: list[sa.ColumnElement[bool]] = [Tournament.is_hidden.is_(False)]
    if user is not None:
        admin_ws = admin_visible_workspace_ids(user)
        if admin_ws:
            clauses.append(Tournament.workspace_id.in_(admin_ws))
        clauses.append(
            Tournament.id.in_(
                sa.select(TournamentPreviewAccess.tournament_id).where(
                    TournamentPreviewAccess.auth_user_id == int(user.id)
                )
            )
        )
    # Avoid the SQLAlchemy single-element or_() deprecation warning (anonymous
    # viewers produce exactly one clause).
    return clauses[0] if len(clauses) == 1 else sa.or_(*clauses)


def visible_tournament_ids_subquery(user: AuthUser | None):
    """A scalar SELECT of tournament ids the viewer may see.

    For filtering any table that carries a ``tournament_id`` (encounters,
    matches, teams, stats) WITHOUT joining ``Tournament`` into the outer query:
    ``.where(Model.tournament_id.in_(visible_tournament_ids_subquery(user)))``.

    Pass ``user=None`` for viewer-agnostic public aggregates — it reduces to
    "every non-hidden tournament", excluding all hidden ones.
    """
    return sa.select(Tournament.id).where(visible_tournaments_predicate(user))
