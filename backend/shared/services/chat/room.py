"""What a chat room IS: a kind, a referent, a realtime topic, a default."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from shared.services.realtime import Scope

__all__ = ("CHAT_DOMAIN", "ChatRoom", "ChatRoomKind")

CHAT_DOMAIN = "chat"


class ChatRoomKind(StrEnum):
    #: ``ref_id`` is ``tournament.encounter.id`` -- the pre-game room.
    ENCOUNTER = "encounter"
    #: ``ref_id`` is ``draft.session.id``, NOT the tournament. A session
    #: is the draft: re-seeding deletes one and creates another, and those are
    #: two different events with two different conversations.
    DRAFT = "draft"


#: Whether people who are merely watching may READ the room, before an organizer
#: says otherwise. A draft is a show viewers and casters follow; a pre-game room
#: is where the captains exchange the custom-lobby code, and a lobby code anyone
#: can read is an open door for griefers. Overridable per room.
_SPECTATORS_CAN_READ_DEFAULT: dict[ChatRoomKind, bool] = {
    ChatRoomKind.ENCOUNTER: False,
    ChatRoomKind.DRAFT: True,
}


@dataclass(frozen=True, slots=True)
class ChatRoom:
    kind: ChatRoomKind
    ref_id: int

    @classmethod
    def encounter(cls, encounter_id: int) -> ChatRoom:
        return cls(ChatRoomKind.ENCOUNTER, int(encounter_id))

    @classmethod
    def draft(cls, draft_session_id: int) -> ChatRoom:
        return cls(ChatRoomKind.DRAFT, int(draft_session_id))

    @property
    def scope(self) -> Scope:
        if self.kind is ChatRoomKind.ENCOUNTER:
            return Scope.encounter(self.ref_id)
        return Scope.draft(self.ref_id)

    @property
    def topic(self) -> str:
        """``encounter:{id}:chat`` / ``draft:{session_id}:chat``.

        Deliberately not a sub-topic of the room's public one
        (``draft:{session_id}:board``): that topic is public spectating and is
        what the gateway keys presence off. The chat is gated separately, so it
        is its own topic with its own ACL rule.
        """
        return self.scope.domain_topic(CHAT_DOMAIN)

    @property
    def spectators_can_read_default(self) -> bool:
        return _SPECTATORS_CAN_READ_DEFAULT[self.kind]
