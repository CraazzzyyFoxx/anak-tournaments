"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import {
  type Coalescer,
  createLeadingCoalescer,
  createTrailingCoalescer,
} from "@/hooks/tournamentRealtime.helpers";
import { useRealtimeTopic } from "@/hooks/useRealtimeTopic";
import { tournamentQueryKeys } from "@/lib/tournament-query-keys";

type StreamRealtimePayload = {
  tournament_id?: number;
  live_count?: number;
};

type UseTournamentStreamRealtimeOptions = {
  tournamentId: number | null | undefined;
  onUpdate?: (liveCount: number | null) => void;
};

const CATCH_UP_COALESCE_MS = 100;

// One poll tick fans `stream.updated` to every spectator of the tournament at
// the same instant, and a tick can emit for several tournaments back to back.
// Refetching inline would be a synchronized refetch herd on a public page — the
// worst shape of load, since spectator count is exactly what spikes when a
// tournament goes live.
//
// So the refetch is debounced with a per-client jittered delay in
// [MIN, MIN+JITTER): (1) bursts within the window collapse into one refetch,
// and (2) each client fires at its own random offset, spreading the herd in
// time instead of landing together. Same reasoning and same numbers as
// `useTournamentRealtime`.
const REALTIME_REFETCH_MIN_DELAY_MS = 250;
const REALTIME_REFETCH_JITTER_MS = 2500;

/**
 * Keeps a tournament's stream list fresh from the `tournament:{id}:streams`
 * topic.
 *
 * No patch reducer (`registerRealtimeResource`): the event is a thin signal
 * (`{tournament_id, live_count}`) and carries none of the entry fields the UI
 * renders — a title change or a viewer-count move would not be in it. A plain
 * refetch of one small key is cheaper than maintaining a reducer that would
 * have to refetch anyway.
 */
export function useTournamentStreamRealtime({
  tournamentId,
  onUpdate,
}: UseTournamentStreamRealtimeOptions): void {
  const queryClient = useQueryClient();

  const topic = tournamentId ? `tournament:${tournamentId}:streams` : null;

  // Reconnect catch-up: the topic is non-durable (the poller publishes with
  // `event_id=0` and no `realtime.workspace_event` row), so there is no replay
  // to ask for — a reconnecting client just refetches.
  const catchUp = useMemo(
    () =>
      createLeadingCoalescer(() => {
        if (tournamentId) {
          void queryClient.invalidateQueries({
            queryKey: tournamentQueryKeys.streams(tournamentId),
          });
        }
      }, CATCH_UP_COALESCE_MS),
    [queryClient, tournamentId],
  );

  useEffect(() => () => catchUp.cancel(), [catchUp]);

  // Latest values read at flush time — the flush runs from a timer, not render,
  // so it must not close over stale ones.
  const stateRef = useRef({ tournamentId, onUpdate, queryClient });
  useEffect(() => {
    stateRef.current = { tournamentId, onUpdate, queryClient };
  });

  const pendingLiveCountRef = useRef<number | null>(null);

  // Built in an effect (not render) so the ref-reading callback is never
  // constructed during render and the per-client jitter is drawn once per
  // topic rather than on every render.
  const updatesRef = useRef<Coalescer | null>(null);
  useEffect(() => {
    const delay =
      REALTIME_REFETCH_MIN_DELAY_MS + Math.floor(Math.random() * REALTIME_REFETCH_JITTER_MS);
    const coalescer = createTrailingCoalescer(() => {
      const liveCount = pendingLiveCountRef.current;
      pendingLiveCountRef.current = null;
      const { tournamentId: id, onUpdate: notify, queryClient: client } = stateRef.current;
      if (!id) {
        return;
      }
      void client.invalidateQueries({ queryKey: tournamentQueryKeys.streams(id) });
      notify?.(liveCount);
    }, delay);
    updatesRef.current = coalescer;
    return () => {
      coalescer.cancel();
      updatesRef.current = null;
      pendingLiveCountRef.current = null;
    };
  }, [topic]);

  useRealtimeTopic<StreamRealtimePayload>(
    topic,
    (event) => {
      if (
        !tournamentId ||
        event.event_type !== "stream.updated" ||
        event.data.tournament_id !== tournamentId
      ) {
        return;
      }
      pendingLiveCountRef.current =
        typeof event.data.live_count === "number" ? event.data.live_count : null;
      updatesRef.current?.schedule();
    },
    [],
    () => {
      catchUp.schedule();
    },
  );
}
