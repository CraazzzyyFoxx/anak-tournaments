/**
 * A chat room is a realtime topic plus the REST base the six endpoints hang
 * off. Both services mount the identical wire shape, so this pair is the ONLY
 * thing that differs between the pre-game room and the draft room.
 */
export interface ChatRoomDescriptor {
  topic: string;
  basePath: string;
}

export function encounterChatRoom(encounterId: number): ChatRoomDescriptor {
  return {
    topic: `encounter:${encounterId}:chat`,
    basePath: `/api/v1/encounters/${encounterId}/chat`
  };
}

/**
 * Keyed by the DRAFT SESSION, never by the tournament: a session is the draft,
 * and a re-seed is a different draft that deserves its own conversation.
 */
export function draftChatRoom(draftSessionId: number): ChatRoomDescriptor {
  return {
    topic: `draft:${draftSessionId}:chat`,
    basePath: `/api/v1/balancer/draft/sessions/${draftSessionId}/chat`
  };
}

/** The room's chat envelope (messages, settings, and who the viewer is in it) in the query cache. */
export function roomChatQueryKey(room: ChatRoomDescriptor) {
  return ["room-chat", room.topic] as const;
}
