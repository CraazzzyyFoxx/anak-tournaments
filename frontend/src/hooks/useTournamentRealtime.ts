"use client";

import { useEffect, useEffectEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  applyTournamentRealtimeUpdate,
  parseTournamentRealtimeMessage,
  type TournamentChangedReason,
} from "@/hooks/tournamentRealtime.helpers";

type UseTournamentRealtimeOptions = {
  tournamentId: number | null | undefined;
  workspaceId?: number | null;
  onUpdate?: (reason: TournamentChangedReason) => void;
  onStructureChanged?: () => void;
};

export function buildTournamentWebSocketUrl(
  tournamentId: number,
  tournamentBase = process.env.NEXT_PUBLIC_TOURNAMENT_API_URL,
  origin = typeof window !== "undefined" ? window.location.origin : "http://localhost"
): string {
  if (tournamentBase) {
    const url = new URL(tournamentBase, origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/$/, "")}/tournaments/${tournamentId}/ws`;
    url.search = "";
    return url.toString();
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/tournament/tournaments/${tournamentId}/ws`;
}

export function useTournamentRealtime({
  tournamentId,
  workspaceId,
  onUpdate,
  onStructureChanged,
}: UseTournamentRealtimeOptions): void {
  const queryClient = useQueryClient();
  const handleRealtimeUpdate = useEffectEvent((reason: TournamentChangedReason) => {
    onUpdate?.(reason);
    if (reason === "structure_changed") {
      onStructureChanged?.();
    }
  });

  useEffect(() => {
    if (!tournamentId) {
      return;
    }

    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      socket = new WebSocket(buildTournamentWebSocketUrl(tournamentId));

      socket.onmessage = (event) => {
        const message = parseTournamentRealtimeMessage(event.data, tournamentId);

        if (!message) {
          return;
        }

        applyTournamentRealtimeUpdate(
          queryClient,
          tournamentId,
          workspaceId,
          message.reason
        );
        handleRealtimeUpdate(message.reason);
      };

      socket.onclose = () => {
        socket = null;
        if (!closed) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [queryClient, tournamentId, workspaceId]);
}
