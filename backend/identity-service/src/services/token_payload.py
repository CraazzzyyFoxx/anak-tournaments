"""Assembly of the RBAC token payload the gateway caches per request.

This is the hottest read path in the service: every authenticated request the
gateway forwards lands here. The Redis RBAC entry is therefore treated as a
complete answer — roles, permissions, workspace memberships, workspace-scoped
RBAC and the deny overlay all live in it — so a hit costs zero database work.
An outage only means every component falls back to its query.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from shared.repository import RoleRepository, UserPermissionDenyRepository, WorkspaceMemberRepository
from src import models, schemas
from src.services.session_cache import SessionCache, session_cache

__all__ = ["TokenPayloadBuilder", "token_payloads"]


class TokenPayloadBuilder:
    """Assembles the RBAC TokenPayload the gateway caches per request."""

    def __init__(
        self,
        *,
        cache: SessionCache = session_cache,
        roles: RoleRepository = RoleRepository(),
        members: WorkspaceMemberRepository = WorkspaceMemberRepository(),
        denies: UserPermissionDenyRepository = UserPermissionDenyRepository(),
    ) -> None:
        self.cache = cache
        self.roles = roles
        self.members = members
        self.denies = denies

    async def build(
        self,
        session: AsyncSession,
        user: models.AuthUser,
        *,
        cached: dict[str, Any] | None = None,
    ) -> schemas.TokenPayload:
        """Build the payload for ``user``, preferring the RBAC cache.

        ``cached`` lets a caller that already read the entry (to decide whether
        the user needed RBAC hydration at all) hand it over instead of paying
        for a second Redis round trip on the same request.
        """
        if cached is None:
            cached = await self.cache.get_rbac(user.id)
        entry: dict[str, Any] = cached or {}

        roles: list[str] | None = entry.get("roles")
        permissions: list[dict[str, str]] | None = entry.get("permissions")
        workspace_roles_cached: dict[str, dict] | None = entry.get("workspace_roles")
        # ``None`` means "not in the cache" and must trigger a load; an empty
        # list is a real answer ("this user has no denies") and must not.
        denies: list[dict[str, Any]] | None = entry.get("denies")
        # Same distinction: v3 entries always carry the key, so its absence
        # means the entry predates membership caching, not "member of nothing".
        memberships_cached: list[list[Any]] | None = entry.get("workspaces")

        loaded_from_db = False

        if roles is None:
            roles, permissions = await self.roles.global_rbac_for_user(session, user.id)
            loaded_from_db = True
        if permissions is None:
            permissions = []

        if denies is None:
            # Loaded on the DB path too, so the deny overlay still applies when
            # Redis is unavailable — a negative grant must never fail open.
            denies = await self.load_denies(session, user.id)
            loaded_from_db = True

        if memberships_cached is None:
            memberships = await self.members.list_memberships_for_auth_user(session, user.id)
            loaded_from_db = True
        else:
            memberships = [(int(workspace_id), slug) for workspace_id, slug in memberships_cached]

        workspace_ids = [workspace_id for workspace_id, _ in memberships]

        if workspace_roles_cached is not None:
            # Cached keys are JSON object keys, hence strings.
            ws_rbac = {int(k): (v["roles"], v["permissions"]) for k, v in workspace_roles_cached.items()}
        else:
            ws_rbac = await self.roles.workspace_rbac_for_user(session, user.id, workspace_ids)
            loaded_from_db = True

        if loaded_from_db:
            # Nothing changed on a full hit, so rewriting the entry would only
            # extend its TTL — which is exactly what the 60s window is meant to
            # bound — at the cost of a round trip on every gateway request.
            await self.cache.set_rbac(
                user.id,
                roles=roles,
                permissions=permissions,
                workspaces=[[workspace_id, slug] for workspace_id, slug in memberships],
                workspace_roles={
                    str(workspace_id): {
                        "roles": ws_rbac.get(workspace_id, ([], []))[0],
                        "permissions": ws_rbac.get(workspace_id, ([], []))[1],
                    }
                    for workspace_id in workspace_ids
                },
                denies=denies,
            )

        workspaces = [
            schemas.WorkspaceMembership(
                workspace_id=workspace_id,
                slug=slug,
                rbac_roles=ws_rbac.get(workspace_id, ([], []))[0],
                rbac_permissions=ws_rbac.get(workspace_id, ([], []))[1],
            )
            for workspace_id, slug in memberships
        ]

        return schemas.TokenPayload(
            sub=user.id,
            email=user.email,
            username=user.username,
            is_superuser=user.is_superuser,
            roles=roles,
            permissions=permissions,
            workspaces=workspaces,
            denies=denies,
        )

    async def load_denies(self, session: AsyncSession, user_id: int) -> list[dict[str, Any]]:
        """Per-user denied ``(resource, action, workspace_id)`` triples.

        ``workspace_id`` is ``None`` for a global deny (blocks everywhere) or a
        concrete workspace id for a deny scoped to that workspace only. See
        ``AuthUser.is_denied`` for how the two are distinguished at check time.
        """
        return await self.denies.list_denied_triples(session, user_id)

    @staticmethod
    def linked_players(user: models.AuthUser) -> list[schemas.AuthLinkedPlayer]:
        """The 0-or-1 player linked to ``user`` via ``players.user.auth_user_id``.

        Kept as a list (rather than an optional single value) for wire-shape
        compatibility with the historical many-to-many ``auth.user_player``
        model; every returned player is, by construction, the single link, so
        ``is_primary`` is always ``True``.
        """
        player = user.player
        if player is None:
            return []
        return [
            schemas.AuthLinkedPlayer(
                player_id=player.id,
                player_name=player.name,
                is_primary=True,
                linked_at=player.created_at.isoformat(),
            )
        ]


token_payloads = TokenPayloadBuilder()
