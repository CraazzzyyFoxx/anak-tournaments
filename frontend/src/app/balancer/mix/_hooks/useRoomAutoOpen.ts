"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { mixRoomHref, playsInRoom } from "@/app/balancer/mix/pickup-chrome";
import type { CustomGameLobby } from "@/services/custom-game.service";

/**
 * Takes a seated player into their lobby's room when its draft or its bans and picks begin, once per phase: the
 * phase is the draft session or the started match, and it is remembered in `sessionStorage` before the push, so
 * coming back to the overview does not bounce them into the room again. A writer runs the mix from the overview and
 * is never moved. `lobby` is the one the viewer's seat names (`MixSelfSeat.current_lobby`, which covers a drafting
 * lobby's pool), `undefined` while they have no seat.
 */
export function useRoomAutoOpen(gameId: number, lobby: CustomGameLobby | undefined, canWrite: boolean): void {
  const router = useRouter();
  const lobbyIndex = lobby?.lobby_index;
  const phase =
    canWrite || lobby == null || !playsInRoom(lobby.state)
      ? null
      : lobby.state === "pregame"
        ? `pregame:${lobby.live_encounter_id}`
        : `draft:${lobby.draft_session_id}`;
  useEffect(() => {
    if (phase == null || lobbyIndex == null) return;
    const key = `mix-room-nav:${gameId}:${lobbyIndex}:${phase}`;
    try {
      if (window.sessionStorage.getItem(key) != null) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      // Storage blocked: nothing would stop the bounce on the way back, so the player stays on the overview.
      return;
    }
    router.push(mixRoomHref(gameId, lobbyIndex));
  }, [gameId, lobbyIndex, phase, router]);
}
