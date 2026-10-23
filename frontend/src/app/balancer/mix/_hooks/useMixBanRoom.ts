"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { PickBanItemLike } from "@/components/pick-ban/PickBanGrid";
import { CHARACTER_PICK_BAN_KIND } from "@/components/pick-ban/pick-ban-model";
import { useCatalogEntities } from "@/hooks/useCatalogEntities";
import { useRealtimeTopic } from "@/hooks/useRealtimeTopic";
import { encounterQueryKeys } from "@/lib/encounters/query-keys";
import pickBanService from "@/services/pickBan.service";
import { useRealtimeStore } from "@/stores/realtime.store";
import type { PickBanState } from "@/types/tournament.types";

const POLL_MS = 4000;
/** A held room changes only when a host resumes it; while the live signal is down, look in now and then. */
const PAUSED_FALLBACK_MS = 30_000;

/** Over either way: the bans finished, or a host cancelled the room and the match plays without them. */
function roomDone(state: PickBanState | null | undefined): boolean {
  return state?.is_complete === true || state?.session?.status === "cancelled";
}

/**
 * A mix match's hero ban room: its state (the tournament room's key, so the shared board's own writes refresh it),
 * its live signal and the game's heroes. Polls until the room is done -- the clock settles server-side and a missed
 * signal must not freeze a phone on "their turn". A held room waits for the signal instead, and the room re-reads on
 * subscribing: a fresh topic replays nothing, so a resume made between the first read and the subscription would
 * otherwise never arrive (the tournament room's `usePregameRoomData` does the same). No match (`null`): no read, no
 * subscription, no hero catalogue.
 */
export function useMixBanRoom(encounterId: number | null, discipline: string) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => [...encounterQueryKeys.pregameHeroState(encounterId ?? 0)], [encounterId]);
  const topic = encounterId == null ? null : `encounter:${encounterId}:pick-ban:hero`;
  const realtimeReady = useRealtimeStore(
    (store) => store.connectionState === "connected" && (topic == null || !store.topicErrors[topic]),
  );
  const stateQuery = useQuery({
    queryKey,
    queryFn: () => pickBanService.getPickBanState(CHARACTER_PICK_BAN_KIND, encounterId as number),
    enabled: encounterId != null,
    refetchInterval: (query) => {
      const state = query.state.data;
      if (roomDone(state)) return false;
      if (state?.session?.paused_at != null) return realtimeReady ? false : PAUSED_FALLBACK_MS;
      return POLL_MS;
    },
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey });
  useRealtimeTopic(topic, refresh, [], refresh);
  const heroes = useCatalogEntities(encounterId == null ? null : discipline, "character");
  const heroesById = useMemo(() => {
    const byId: Record<number, PickBanItemLike | undefined> = {};
    for (const hero of heroes.data ?? []) byId[hero.id] = hero;
    return byId;
  }, [heroes.data]);
  return { queryKey, state: stateQuery.data ?? null, heroesById };
}
