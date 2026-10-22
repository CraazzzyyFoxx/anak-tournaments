"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { PickBanItemLike } from "@/components/pick-ban/PickBanGrid";
import { useCatalogEntities } from "@/hooks/useCatalogEntities";
import { useRealtimeTopic } from "@/hooks/useRealtimeTopic";
import { encounterQueryKeys } from "@/lib/encounters/query-keys";
import pickBanService from "@/services/pickBan.service";
import type { PickBanState } from "@/types/tournament.types";

const POLL_MS = 4000;

/** Over either way: the bans finished, or a host cancelled the room and the match plays without them. */
function roomDone(state: PickBanState | null | undefined): boolean {
  return state?.is_complete === true || state?.session?.status === "cancelled";
}

/**
 * A mix match's hero ban room: its state (the tournament room's key, so the shared board's own writes refresh it),
 * its live signal and the game's heroes. Polls until the room is done -- the clock settles server-side and a missed
 * signal must not freeze a phone on "their turn".
 */
export function useMixBanRoom(encounterId: number, discipline: string) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => [...encounterQueryKeys.pregameHeroState(encounterId)], [encounterId]);
  const stateQuery = useQuery({
    queryKey,
    queryFn: () => pickBanService.getPickBanState("hero", encounterId),
    refetchInterval: (query) => {
      const state = query.state.data;
      return roomDone(state) || state?.session?.paused_at != null ? false : POLL_MS;
    },
  });
  useRealtimeTopic(`encounter:${encounterId}:pick-ban:hero`, () => {
    void queryClient.invalidateQueries({ queryKey });
  });
  const heroes = useCatalogEntities(discipline, "character");
  const heroesById = useMemo(() => {
    const byId: Record<number, PickBanItemLike | undefined> = {};
    for (const hero of heroes.data ?? []) byId[hero.id] = hero;
    return byId;
  }, [heroes.data]);
  const state = stateQuery.data ?? null;
  return { queryKey, state, done: roomDone(state), heroesById };
}
