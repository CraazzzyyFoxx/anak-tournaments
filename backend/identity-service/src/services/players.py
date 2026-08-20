"""Player linking with ownership checks.

Single-link model (identity/workspace refactor): a player↔auth-user link is
stored as ``players.user.auth_user_id`` (nullable, unique FK to ``auth.user.id``)
rather than the former ``auth.user_player`` M2M table. Because the FK is unique,
an auth user links to at most one player, so the historical ``is_primary``
bookkeeping is meaningless. The ``is_primary`` parameter is kept on the public
signatures purely as a transition shim so the RPC wire schema, gateway, and
frontend do not have to change; it is ignored internally and every
returned/linked player is treated as primary. Removing it from the wire schema
is later work.
"""

from __future__ import annotations

from collections.abc import Iterable

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.core.social import SocialProvider
from shared.models.identity.oauth import OAuthConnection
from shared.rbac import assign_default_member_role_if_roleless, workspace_names_blocking_player_unlink
from shared.repository import (
    OAuthConnectionRepository,
    SocialAccountRepository,
    UserRepository,
    WorkspaceMemberRepository,
)
from src import models, schemas

__all__ = ("PlayerLinkService", "players")


def _normalized(values: Iterable[str | None]) -> set[str]:
    return {value.strip().casefold() for value in values if value and value.strip()}


class PlayerLinkService:
    """Single-link model: ``players.user.auth_user_id``."""

    def __init__(
        self,
        *,
        players: UserRepository = UserRepository(),
        connections: OAuthConnectionRepository = OAuthConnectionRepository(),
        socials: SocialAccountRepository = SocialAccountRepository(),
        members: WorkspaceMemberRepository = WorkspaceMemberRepository(),
    ) -> None:
        self.players = players
        self.connections = connections
        self.socials = socials
        self.members = members

    # -- lookups -----------------------------------------------------------

    async def _get_oauth_connections(
        self,
        session: AsyncSession,
        auth_user_id: int,
    ) -> tuple[OAuthConnection | None, OAuthConnection | None]:
        connections = await self.connections.list_by_user_providers(
            session,
            auth_user_id=auth_user_id,
            providers=["discord", "battlenet"],
        )
        discord_conn = next((conn for conn in connections if conn.provider == "discord"), None)
        battlenet_conn = next((conn for conn in connections if conn.provider == "battlenet"), None)

        if discord_conn is None and battlenet_conn is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Link Discord or Battle.net OAuth account before linking a player",
            )

        return discord_conn, battlenet_conn

    async def _get_player(self, session: AsyncSession, player_id: int) -> models.User:
        player = await self.players.get(session, player_id)
        if player is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Player not found",
            )
        return player

    # -- ownership ---------------------------------------------------------

    async def _verify_ownership(self, session: AsyncSession, auth_user_id: int, player_id: int) -> None:
        discord_conn, battlenet_conn = await self._get_oauth_connections(session, auth_user_id)

        discord_match = False
        battlenet_match = False

        if discord_conn is not None:
            oauth_names = _normalized(
                (
                    discord_conn.username,
                    discord_conn.display_name,
                    discord_conn.email,
                    (discord_conn.provider_data or {}).get("username"),
                    (discord_conn.provider_data or {}).get("global_name"),
                )
            )
            player_discord_names = _normalized(
                await self.socials.list_handles(session, user_id=player_id, provider=SocialProvider.DISCORD)
            )
            if player_discord_names and not oauth_names.isdisjoint(player_discord_names):
                discord_match = True

        if battlenet_conn is not None:
            oauth_battletags = _normalized(
                (
                    battlenet_conn.username,
                    battlenet_conn.display_name,
                    (battlenet_conn.provider_data or {}).get("battletag"),
                    (battlenet_conn.provider_data or {}).get("battle_tag"),
                    (battlenet_conn.provider_data or {}).get("preferred_username"),
                )
            )
            player_battletags = _normalized(
                await self.socials.list_handles(session, user_id=player_id, provider=SocialProvider.BATTLENET)
            )
            if oauth_battletags and player_battletags and not oauth_battletags.isdisjoint(player_battletags):
                battlenet_match = True

        if not discord_match and not battlenet_match:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Discord or Battle.net account does not match selected player",
            )

    # -- storage -----------------------------------------------------------

    async def _link_to_auth_user(
        self,
        session: AsyncSession,
        *,
        auth_user_id: int,
        player_id: int,
    ) -> models.User:
        """Set ``players.user.auth_user_id`` for the single-link model.

        Idempotent when the player is already linked to the same auth user;
        rejects with 409 when it belongs to a different account.
        """
        player = await self._get_player(session, player_id)

        if player.auth_user_id is not None and player.auth_user_id != auth_user_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Player is already linked to another account",
            )

        player.auth_user_id = auth_user_id
        await session.flush()
        # Autofill the baseline ``member`` role for every workspace this player is
        # already anchored to (tournament participation created the member rows
        # before the account existed). Now that the row is auth-linked it becomes
        # a visible RBAC member and must not be role-less. Additive/idempotent.
        await self._autofill_member_roles(session, auth_user_id=auth_user_id, player_id=player_id)
        await session.commit()
        await session.refresh(player)

        logger.info(f"Linked player {player_id} to auth user {auth_user_id}")
        return player

    async def _autofill_member_roles(
        self,
        session: AsyncSession,
        *,
        auth_user_id: int,
        player_id: int,
    ) -> None:
        """Grant the baseline ``member`` role in each workspace where ``player_id``
        has a membership row but the (now-linked) auth user holds no role yet."""
        for workspace_id in await self.members.workspace_ids_for_player(session, player_id):
            await assign_default_member_role_if_roleless(session, user_id=auth_user_id, workspace_id=workspace_id)

    async def _unlink_from_auth_user(self, session: AsyncSession, *, player_id: int) -> None:
        """Clear ``players.user.auth_user_id`` for the single-link model.

        Refuses (409) when the auth user still holds a real workspace
        membership role: ``workspace_member`` is anchored on this player, so
        clearing the link would strand that membership row auth-less — hidden
        from the members list and unmanageable via the auth-keyed lookup. The
        409 names the blocking workspaces so the user knows which to leave
        first. Baseline ``player`` participation does not block the unlink (see
        ``workspace_names_blocking_player_unlink``).
        """
        player = await self._get_player(session, player_id)
        auth_user_id = player.auth_user_id
        if auth_user_id is None:
            return  # already unlinked — idempotent no-op
        blocking_workspaces = await workspace_names_blocking_player_unlink(session, user_id=auth_user_id)
        if blocking_workspaces:
            listed = ", ".join(blocking_workspaces)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Cannot unlink this player: the account is a member of the "
                    f"following workspace(s): {listed}. Leave those workspaces first."
                ),
            )
        player.auth_user_id = None
        await session.commit()
        logger.info(f"Unlinked player {player_id} from auth user {auth_user_id}")

    # -- self-service ------------------------------------------------------

    async def link(
        self,
        session: AsyncSession,
        current_user: models.AuthUser,
        player_id: int,
        is_primary: bool,
    ) -> models.User:
        """Link a game player to ``current_user`` after ownership verification.

        ``is_primary`` is accepted for wire compatibility but ignored (single
        link => always primary). Returns the linked ``players.user`` row.
        """
        await self._verify_ownership(session, current_user.id, player_id)
        return await self._link_to_auth_user(session, auth_user_id=current_user.id, player_id=player_id)

    async def unlink(self, session: AsyncSession, current_user: models.AuthUser, player_id: int) -> None:
        logger.info(f"Unlinking player {player_id} from user {current_user.username}")
        player = await self._get_player(session, player_id)
        if player.auth_user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Player link not found",
            )
        await self._unlink_from_auth_user(session, player_id=player_id)

    async def linked_players(self, session: AsyncSession, current_user: models.AuthUser) -> list[models.User]:
        """Return the 0-or-1 player linked to ``current_user`` via
        ``players.user.auth_user_id`` (a list, for API-shape compatibility)."""
        player = await self.players.get_by_auth_user_id(session, current_user.id)
        return [player] if player is not None else []

    # -- admin -------------------------------------------------------------

    async def admin_link(
        self,
        session: AsyncSession,
        auth_user_id: int,
        player_id: int,
        is_primary: bool,
    ) -> models.User:
        """Admin link (no ownership check). ``is_primary`` accepted but ignored."""
        return await self._link_to_auth_user(session, auth_user_id=auth_user_id, player_id=player_id)

    async def admin_unlink(self, session: AsyncSession, auth_user_id: int, player_id: int) -> None:
        """Admin unlink (no ownership check). ``auth_user_id`` accepted for
        signature compatibility; the single-link column is cleared regardless."""
        await self._unlink_from_auth_user(session, player_id=player_id)

    # -- RPC-facing wrappers ----------------------------------------------

    async def link_and_describe(
        self,
        session: AsyncSession,
        current_user: models.AuthUser,
        link_data: schemas.PlayerLinkRequest,
    ) -> schemas.PlayerLinkResponse:
        """Link a game player to the current auth user."""
        logger.info(f"Linking player {link_data.player_id} to user {current_user.username}")

        # ``is_primary`` is always True in the response (one link per auth user).
        player = await self.link(session, current_user, link_data.player_id, link_data.is_primary)
        linked_player = schemas.LinkedPlayer(
            player_id=player.id,
            player_name=player.name,
            is_primary=True,
            linked_at=player.created_at.isoformat(),
        )
        return schemas.PlayerLinkResponse(message="Player linked successfully", player=linked_player)

    async def linked_payload(
        self,
        session: AsyncSession,
        current_user: models.AuthUser,
    ) -> list[schemas.LinkedPlayer]:
        """Get all linked players for the current auth user."""
        return [
            schemas.LinkedPlayer(
                player_id=player.id,
                player_name=player.name,
                is_primary=True,
                linked_at=player.created_at.isoformat(),
            )
            for player in await self.linked_players(session, current_user)
        ]

    async def confirm_primary(
        self,
        session: AsyncSession,
        current_user: models.AuthUser,
        player_id: int,
    ) -> dict:
        """Set a linked player as primary for the current auth user.

        Single-link model: an auth user has at most one linked player
        (``players.user.auth_user_id``), so there is nothing to reassign. This is
        validate-only — it confirms ``player_id`` is the caller's single linked
        player and returns success without any mutation. The endpoint is retained
        (no route/gateway churn); the wire response is unchanged.
        """
        logger.info(f"Setting player {player_id} as primary for user {current_user.username}")

        player = await self.players.get_by_auth_user_id(session, current_user.id)
        if player is None or player.id != player_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Player link not found",
            )
        return {"message": "Primary player updated successfully"}


players = PlayerLinkService()
