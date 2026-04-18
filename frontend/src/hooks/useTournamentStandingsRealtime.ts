"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

type TournamentRecalculatedMessage = {
  type: "tournament:recalculated";
  data?: {
    tournament_id?: number;
  };
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

export function useTournamentStandingsRealtime(tournamentId: number | null | undefined): void {
  const queryClient = useQueryClient();

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
        let message: TournamentRecalculatedMessage;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }

        if (
          message.type !== "tournament:recalculated" ||
          message.data?.tournament_id !== tournamentId
        ) {
          return;
        }

        queryClient.invalidateQueries({ queryKey: ["standings", tournamentId] });
        queryClient.invalidateQueries({ queryKey: ["standings-table", tournamentId] });
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
  }, [queryClient, tournamentId]);
}
