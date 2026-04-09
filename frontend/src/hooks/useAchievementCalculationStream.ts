"use client";

import { useCallback, useRef, useState } from "react";
import type { CalculationLogEntry } from "@/types/admin.types";

export interface CalculationStreamState {
  connected: boolean;
  running: boolean;
  error: string | null;
  logs: CalculationLogEntry[];
  progress: { current: number; total: number } | null;
}

const INITIAL_STATE: CalculationStreamState = {
  connected: false,
  running: false,
  error: null,
  logs: [],
  progress: null,
};

export function useAchievementCalculationStream() {
  const [state, setState] = useState<CalculationStreamState>(INITIAL_STATE);
  const esRef = useRef<EventSource | null>(null);

  const stop = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setState((s) => ({ ...s, connected: false, running: false }));
  }, []);

  const start = useCallback(
    async (slugs?: string[], tournamentId?: number, workspaceId?: number | null) => {
      // Close any existing connection
      esRef.current?.close();
      esRef.current = null;

      // Reset state
      setState({ ...INITIAL_STATE, running: true });

      // Get access token from cookie
      let token: string | undefined;
      try {
        const Cookies = (await import("js-cookie")).default;
        token = Cookies.get("aqt_access_token");
      } catch {
        // js-cookie not available
      }

      if (!token) {
        setState((s) => ({
          ...s,
          error: "Not authenticated",
          running: false,
        }));
        return;
      }

      // Build URL
      const params = new URLSearchParams();
      params.set("token", token);
      if (slugs && slugs.length > 0) {
        params.set("slugs", slugs.join(","));
      }
      if (tournamentId !== undefined && tournamentId !== null) {
        params.set("tournament_id", String(tournamentId));
      }
      if (workspaceId !== undefined && workspaceId !== null) {
        params.set("workspace_id", String(workspaceId));
      }

      const url = `/api/parser/admin/achievements/calculate/stream?${params.toString()}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        setState((s) => ({ ...s, connected: true, error: null }));
      };

      es.addEventListener("log", (event) => {
        try {
          const data: CalculationLogEntry = JSON.parse(event.data);
          setState((s) => {
            const logs = [...s.logs, data];
            let progress = s.progress;

            if (data.type === "start" && data.total !== undefined) {
              progress = { current: 0, total: data.total };
            } else if (data.type === "progress" && data.status === "done") {
              progress = progress
                ? { ...progress, current: progress.current + 1 }
                : null;
            } else if (data.type === "progress" && data.status === "error") {
              progress = progress
                ? { ...progress, current: progress.current + 1 }
                : null;
            }

            const isComplete = data.type === "complete";
            const isError = data.type === "error" && !data.slug;

            return {
              ...s,
              logs,
              progress,
              running: !isComplete && !isError,
              connected: !isComplete && !isError,
              error: isError ? (data.message ?? "Calculation error") : s.error,
            };
          });

          // Auto-close on complete or top-level error
          if (data.type === "complete" || (data.type === "error" && !data.slug)) {
            es.close();
            esRef.current = null;
          }
        } catch {
          // ignore malformed event
        }
      });

      es.onerror = () => {
        setState((s) => ({
          ...s,
          connected: false,
          error: s.running ? "Connection lost" : s.error,
          running: false,
        }));
        es.close();
        esRef.current = null;
      };
    },
    [],
  );

  return { state, start, stop };
}
