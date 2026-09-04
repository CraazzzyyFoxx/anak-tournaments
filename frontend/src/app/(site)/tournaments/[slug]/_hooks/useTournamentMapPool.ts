"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import mapService from "@/services/map.service";
import pickBanService from "@/services/pickBan.service";
import tournamentService from "@/services/tournament.service";
import type { MapRead } from "@/types/map.types";
import type { PickBanConfig } from "@/types/tournament.types";

export type MapPoolGroup = {
  /** Game mode name (Control, Hybrid…); "—" when the catalogue names none. */
  gamemode: string;
  maps: MapRead[];
};

export type MapPoolView = {
  byGamemode: MapPoolGroup[];
  total: number;
};

export type MapPoolStageView = {
  stageId: number;
  title: string;
  pool: MapPoolView;
};

export type TournamentMapPool = {
  /** Every map any veto config of the tournament names, grouped by game mode. */
  pool: MapPoolView;
  /**
   * Per-stage pools, present only when at least two stages carry pools that
   * differ from each other. When every stage plays the same maps (the common
   * case) this is `null` and `pool` is the whole story.
   */
  stages: MapPoolStageView[] | null;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => void;
};

export const mapPoolQueryKeys = {
  configs: (tournamentId: number) =>
    ["public", "tournament", tournamentId, "pick-ban-configs"] as const,
  maps: ["maps", "all", "gamemode"] as const,
  stages: (tournamentId: number) => ["public", "tournament", tournamentId, "stages"] as const
};

/** Every map id the given veto configs name, anywhere: pool, slots, reserves. */
export function collectPoolIds(configs: PickBanConfig[]): Set<number> {
  const ids = new Set<number>();
  for (const config of configs) {
    for (const id of config.item_ids) ids.add(id);
    for (const slot of config.slots) {
      for (const id of slot.candidates) ids.add(id);
      if (slot.reserve_item_id != null) ids.add(slot.reserve_item_id);
    }
  }
  return ids;
}

export function groupByGamemode(maps: MapRead[]): MapPoolView {
  const buckets = new Map<string, MapRead[]>();
  for (const map of maps) {
    const key = map.gamemode?.name ?? "—";
    const bucket = buckets.get(key);
    if (bucket) bucket.push(map);
    else buckets.set(key, [map]);
  }
  const byGamemode = [...buckets.entries()]
    .map(([gamemode, list]) => ({
      gamemode,
      maps: [...list].sort((a, b) => a.name.localeCompare(b.name))
    }))
    .sort((a, b) => a.gamemode.localeCompare(b.gamemode));
  return { byGamemode, total: maps.length };
}

/**
 * The tournament's map pool, derived from its pick-ban configs.
 *
 * There is no "map pool" entity: the pool is whatever the veto configuration
 * can produce. The tournament-wide pool is the union across every config; a
 * stage's pool is the union of its own configs plus the tournament-default
 * ones that apply to it when it has none of its own.
 */
export function useTournamentMapPool(tournamentId: number): TournamentMapPool {
  // No `.catch(() => ({ configs: [] }))` here: a failed read must stay
  // distinguishable from "the organizer configured nothing".
  const configsQuery = useQuery({
    queryKey: mapPoolQueryKeys.configs(tournamentId),
    queryFn: () => pickBanService.listPublicConfigs(tournamentId)
  });
  // `entities: ["gamemode"]` is load-bearing: the maps endpoint only serialises
  // the gamemode relation when asked, and the pool is grouped by it.
  const mapsQuery = useQuery({
    queryKey: mapPoolQueryKeys.maps,
    queryFn: () =>
      mapService.getAll({ perPage: -1, sort: "name", order: "asc", entities: ["gamemode"] })
  });
  const stagesQuery = useQuery({
    queryKey: mapPoolQueryKeys.stages(tournamentId),
    queryFn: () => tournamentService.getStages(tournamentId)
  });

  const derived = useMemo(() => {
    const configs = configsQuery.data?.configs ?? [];
    const maps = (mapsQuery.data?.results ?? []).filter((map) => map.in_competitive !== false);
    const mapsById = new Map(maps.map((map) => [map.id, map]));
    const resolve = (ids: Set<number>) =>
      [...ids].map((id) => mapsById.get(id)).filter((map): map is MapRead => map !== undefined);

    const pool = groupByGamemode(resolve(collectPoolIds(configs)));

    const tournamentWide = configs.filter((config) => config.stage_id == null);
    const stages = [...(stagesQuery.data ?? [])].sort((a, b) => a.order - b.order);
    const perStage: MapPoolStageView[] = stages.map((stage) => {
      const own = configs.filter((config) => config.stage_id === stage.id);
      const effective = own.length > 0 ? own : tournamentWide;
      return {
        stageId: stage.id,
        title: stage.name,
        pool: groupByGamemode(resolve(collectPoolIds(effective)))
      };
    });
    const signature = (view: MapPoolView) =>
      view.byGamemode.map((g) => g.maps.map((m) => m.id).join(",")).join("|");
    const differ =
      perStage.length > 1 && new Set(perStage.map((s) => signature(s.pool))).size > 1;

    return { pool, stages: differ ? perStage : null };
  }, [configsQuery.data, mapsQuery.data, stagesQuery.data]);

  return {
    ...derived,
    isPending: configsQuery.isPending || mapsQuery.isPending,
    isError: configsQuery.isError || mapsQuery.isError,
    isFetching: configsQuery.isFetching || mapsQuery.isFetching,
    refetch: () => {
      void configsQuery.refetch();
      void mapsQuery.refetch();
    }
  };
}
