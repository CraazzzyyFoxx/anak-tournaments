"""Who somebody is inside a pre-game room's chat.

The encounter half of ``shared.services.chat.ChatAccess``: a domain question
only ("captain of a side, organizer of the owning workspace, or just
watching?"). Whether a spectator may actually READ, and whether this account is
muted, are room policy and belong to ``ChatService``.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from shared.services.chat import SPECTATOR_ROLE, ChatMembership, ChatRoom, ChatService
from shared.services.tournament.display_name import tournament_display_name
from shared.services.tournament.visibility import ensure_tournament_viewable
from src import models
from src.core import auth
from src.services import visibility_resolvers
from src.services.encounter.captain import captain_service
from src.services.encounter.ffa import ffa_encounter_service

__all__ = ("EncounterChatAccess", "encounter_chat_service")

#: Spectators never author a message, so nothing snapshots their name and a
#: query to resolve one would be pure waste.
_SPECTATOR = ChatMembership(role=SPECTATOR_ROLE, display_name="", can_write=False, can_moderate=False)


class EncounterChatAccess:
    async def resolve(
        self,
        session: AsyncSession,
        auth_user: models.AuthUser | None,
        room: ChatRoom,
    ) -> ChatMembership:
        # Format-agnostic: a lobby has a pre-game room too, and its chat is not
        # a series feature.
        encounter = await captain_service.load_encounter_any_format(session, room.ref_id)
        # Before anything else: an outsider must not learn that a hidden
        # tournament's encounter exists, chat setting or not.
        tournament_id = await visibility_resolvers.visibility_resolvers_service.tournament_id_for_encounter(
            session, encounter.id
        )
        await ensure_tournament_viewable(session, auth_user, tournament_id)

        if auth_user is None:
            return _SPECTATOR

        # An encounter has no sides, so "which side are you?" has no answer:
        # the seated participations are the whole roster, and captaining one of
        # them is one membership whether the encounter seats two or twenty.
        side = "captain" if await ffa_encounter_service.is_participant_captain(session, auth_user, encounter) else None
        if side:
            return ChatMembership(
                role=side,
                display_name=await tournament_display_name(session, auth_user=auth_user, tournament_id=tournament_id),
                can_write=True,
                can_moderate=False,
            )

        workspace_id = await auth.get_encounter_workspace_id(session, encounter.id)
        # Organizer staff, NOT the workspace roster: every registrant gets a
        # ``workspace_member`` row (``RegistrationService._anchor_registration_member``)
        # and the token's ``workspaces`` list is built from those rows, so
        # membership would hand moderation (and a closed room's lobby code) to
        # every player. ``has_admin_panel_access`` is the scoped organizer gate:
        # superuser, a global admin-panel role, or a non-read grant in THIS
        # workspace -- a read-only ``member``/``player`` and a mix ``host`` are out.
        if auth_user.has_admin_panel_access(workspace_id):
            return ChatMembership(
                role="staff",
                display_name=await tournament_display_name(session, auth_user=auth_user, tournament_id=tournament_id),
                can_write=True,
                can_moderate=True,
            )

        return _SPECTATOR


encounter_chat_service = ChatService(EncounterChatAccess())
