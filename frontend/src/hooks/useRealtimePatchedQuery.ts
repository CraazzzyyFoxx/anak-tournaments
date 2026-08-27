"use client";

import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useRealtimeTopic } from "@/hooks/useRealtimeTopic";
import { applyResourcePatch } from "@/services/realtime-patch";
import { useRealtimeStore } from "@/stores/realtime.store";

/**
 * Patch-mode realtime hook: fold each incoming event into the cached snapshot
 * at `queryKey` via the resource's registered reducer (see
 * `registerRealtimeResource`), falling back to `invalidateQueries` when there
 * is nothing cached yet (`uncached`) or no reducer is registered
 * (`unregistered`). Also invalidates unconditionally on a
 * `reconnecting -> connected` transition, as a defense-in-depth safety net
 * against a replay gap the patch stream itself has no way to detect.
 *
 * Generalizes the inline patch logic `useDraftData.ts`'s `useDraftRealtime`
 * hand-rolls today. Unlike that hook, this one has no consumer yet — it is
 * built for the separately-approved pregame/draft patch-mode migration.
 */
export function useRealtimePatchedQuery<TData extends Record<string, unknown> = Record<string, unknown>>(
  topic: string | null | undefined,
  options: { resource: string; queryKey: QueryKey }
): void {
  const queryClient = useQueryClient();
  const { resource, queryKey } = options;

  useRealtimeTopic<TData>(
    topic,
    (event) => {
      const outcome = applyResourcePatch(queryClient, { resource, queryKey, event });
      if (outcome !== "applied") {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
    [resource, JSON.stringify(queryKey)]
  );

  // Reconnect safety-net, same rationale as useRealtimeCoalescedRefetch's
  // reconnect handling (design §4.3/§7 D9): unconditional invalidate on
  // reconnect, defense-in-depth against a retention-pruned replay gap.
  // Unlike that hook, this one does NOT route through a jitter window first —
  // there is no coalescer here to route through (patch consumers are, by
  // construction, low-fan-out enough that this wasn't flagged in review; a
  // future high-fan-out patch consumer needing jitter here too is a design
  // amendment, not a silent addition).
  const connectionState = useRealtimeStore((s) => s.connectionState);
  const prev = useRef(connectionState);
  useEffect(() => {
    if (prev.current === "reconnecting" && connectionState === "connected") {
      void queryClient.invalidateQueries({ queryKey });
    }
    prev.current = connectionState;
  }, [connectionState, queryClient, JSON.stringify(queryKey)]);
}
