"use client";

import { useEffect, useEffectEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  applyTournamentRealtimeUpdate,
  parseTournamentRealtimeMessage,
} from "@/hooks/tournamentRealtime.helpers";

type UseTournamentRealtimeOptions = {
  tournamentId: number | null | undefined;
  workspaceId?: number | null;
  onStructureChanged?: () => void;
};

function buildTournamentWebSocketUrl(tournamentId: number): string {
  const appBase = process.env.NEXT_PUBLIC_API_URL;

  if (appBase) {
    const url = new URL(appBase);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/$/, "")}/tournaments/${tournamentId}/ws`;
    url.search = "";
    return url.toString();
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/v1/tournaments/${tournamentId}/ws`;
}

export function useTournamentRealtime({
  tournamentId,
  workspaceId,
  onStructureChanged,
}: UseTournamentRealtimeOptions): void {
  const queryClient = useQueryClient();
  const handleStructureChanged = useEffectEvent(() => {
    onStructureChanged?.();
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
          message.reason,
          handleStructureChanged
        );
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
