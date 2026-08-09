"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Info, MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import mapService from "@/services/map.service";
import tournamentService from "@/services/tournament.service";
import type { MapRead } from "@/types/map.types";
import type { MapVetoConfig } from "@/types/tournament.types";
import { TournamentPageState } from "../_components/TournamentPageState";

interface TournamentMapsPageProps {
  tournamentId: number;
}

interface PoolGroup {
  /** Stable filter key; gamemode name, or the sentinel for maps without one. */
  key: string;
  label: string;
  maps: MapRead[];
}

const ALL_FILTER = "all";
/** Cannot collide with a gamemode name, which is always a bare proper noun. */
const UNGROUPED_FILTER = "__ungrouped__";

const PILL_BASE =
  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const PILL_ON = "border-primary bg-primary text-primary-foreground shadow-xs";
const PILL_OFF =
  "border-border/70 bg-card text-foreground hover:border-primary/50 hover:bg-accent/40";
const MAP_GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6";

/**
 * Every map id the tournament's veto configs name, anywhere.
 *
 * The union across all twelve possible cascade levels rather than one level's
 * pool. This page answers "which maps does this tournament play"; which subset a
 * single match plays, and in what order captains ban down to it, belongs to that
 * match. A per-level view here needed a stage/round picker that could not reach
 * a lower-bracket round at all, and left a tournament whose organizer wrote only
 * per-round configs — the normal shape — showing nothing until the viewer
 * guessed a round.
 *
 * A slot's candidates and its regulation reserve count exactly like a flat
 * pool's entries: all three are maps a series can land on.
 */
function collectPoolIds(configs: MapVetoConfig[]): Set<number> {
  const ids = new Set<number>();
  for (const config of configs) {
    for (const id of config.map_ids) ids.add(id);
    for (const slot of config.slots) {
      for (const id of slot.candidates) ids.add(id);
      if (slot.reserve_map_id != null) ids.add(slot.reserve_map_id);
    }
  }
  return ids;
}

export default function TournamentMapsPage({ tournamentId }: TournamentMapsPageProps) {
  const t = useTranslations();
  const [gamemodeFilter, setGamemodeFilter] = useState<string>(ALL_FILTER);

  // No `.catch(() => ({ configs: [] }))` here: swallowing the failure would make
  // a 422/500/offline read indistinguishable from "the organizer configured
  // nothing", which is the same fabrication this page exists to stop telling.
  // A failed read renders the error state below; an empty *successful* read is
  // the only thing allowed to render "not configured".
  const vetoConfigsQuery = useQuery({
    queryKey: ["public", "tournament", tournamentId, "veto-configs"],
    queryFn: () => tournamentService.getVetoConfigs(tournamentId)
  });

  // `entities: ["gamemode"]` is load-bearing: the maps endpoint only serialises
  // the gamemode relation when asked, so without it every `map.gamemode` is
  // null and the pool loses its grouping entirely. The query key carries the
  // same marker so this never shares a cache entry with a gamemode-less fetch.
  const mapsQuery = useQuery({
    queryKey: ["maps", "all", "gamemode"],
    queryFn: () =>
      mapService.getAll({ perPage: -1, sort: "name", order: "asc", entities: ["gamemode"] })
  });

  const maps = useMemo(() => {
    const raw = mapsQuery.data?.results ?? [];
    return raw.filter((map) => map.in_competitive !== false);
  }, [mapsQuery.data]);
  const configs = useMemo(() => vetoConfigsQuery.data?.configs ?? [], [vetoConfigsQuery.data]);

  /**
   * The pool as the catalogue knows it. An id the competitive catalogue cannot
   * resolve is a map retired from rotation, and nobody is going to play it, so
   * it is dropped rather than named — unlike in the veto room, where a slot's
   * candidate count is what the regulation is written against and a missing tile
   * would under-report it.
   */
  const pool = useMemo(() => {
    const ids = collectPoolIds(configs);
    return maps.filter((map) => ids.has(map.id));
  }, [configs, maps]);

  const poolGroups = useMemo<PoolGroup[]>(() => {
    const byKey = new Map<string, PoolGroup>();
    for (const map of pool) {
      const key = map.gamemode?.name ?? UNGROUPED_FILTER;
      const group = byKey.get(key);
      if (group) {
        group.maps.push(map);
      } else {
        byKey.set(key, { key, label: map.gamemode?.name ?? t("mapVeto.ungrouped"), maps: [map] });
      }
    }
    const groups = Array.from(byKey.values());
    // Alphabetical inside a group, so the page's own order does not depend on
    // the maps endpoint keeping its `sort=name`.
    for (const group of groups) {
      group.maps.sort((a, b) => a.name.localeCompare(b.name));
    }
    return groups.sort((a, b) => {
      if (a.key === UNGROUPED_FILTER) return 1;
      if (b.key === UNGROUPED_FILTER) return -1;
      if (b.maps.length !== a.maps.length) return b.maps.length - a.maps.length;
      return a.label.localeCompare(b.label);
    });
  }, [pool, t]);

  // A filter left over from a previous pool must not blank the grid: fall back
  // to "all" whenever the remembered gamemode is absent from the current pool.
  const activeFilter = poolGroups.some((group) => group.key === gamemodeFilter)
    ? gamemodeFilter
    : ALL_FILTER;
  const activeGroup =
    activeFilter === ALL_FILTER ? null : poolGroups.find((group) => group.key === activeFilter);

  if (vetoConfigsQuery.isLoading || mapsQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>
        <Card>
          <CardContent className="pt-6">
            <div className={MAP_GRID}>
              {Array.from({ length: 12 }).map((_, index) => (
                <Skeleton key={index} className="h-28 rounded-xl" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // The pool and the map catalogue are both load-bearing: without either, the
  // page cannot say anything true about the map pool. Offer a retry instead of
  // guessing.
  if (vetoConfigsQuery.isError || mapsQuery.isError) {
    return (
      <TournamentPageState
        state="initial-error"
        onRetry={() => {
          if (vetoConfigsQuery.isError) void vetoConfigsQuery.refetch();
          if (mapsQuery.isError) void mapsQuery.refetch();
        }}
      />
    );
  }

  /**
   * `image_path` is null for a map with no art, which falls back to the same
   * flat wash — there is no second tile.
   */
  const renderMapTile = (map: MapRead) => (
    <li
      key={map.id}
      className="relative flex h-28 items-end overflow-hidden rounded-xl border border-border/70 bg-card p-2.5"
    >
      {map.image_path ? (
        <div
          aria-hidden
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url("${map.image_path}")` }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-muted/60" />
      )}
      {/* Explicit scrim rather than trusting image luminance: map art ranges
          from Antarctic white to Havana night and the label must read on both. */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-background via-background/85 to-transparent"
      />
      <span className="relative z-10 line-clamp-2 text-sm font-semibold leading-tight text-foreground">
        {map.name}
      </span>
    </li>
  );

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight">{t("mapVeto.title")}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">{t("mapVeto.description")}</p>
      </header>

      {pool.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="items-center gap-2 text-center">
            <Info className="h-6 w-6 text-muted-foreground" aria-hidden />
            <CardTitle asChild>
              <h3 className="text-base font-semibold">{t("mapVeto.notConfiguredTitle")}</h3>
            </CardTitle>
            <CardDescription className="max-w-xl">
              {t("mapVeto.notConfiguredDescription")}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-col gap-3 pb-4 lg:flex-row lg:items-center lg:justify-between">
            <Badge variant="secondary" className="w-fit gap-1.5">
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              {t("mapVeto.mapsInPool", { count: pool.length })}
            </Badge>

            {poolGroups.length > 1 ? (
              <div
                role="group"
                aria-label={t("mapVeto.filterLabel")}
                className="flex flex-wrap gap-1.5"
              >
                <button
                  type="button"
                  aria-pressed={activeFilter === ALL_FILTER}
                  onClick={() => setGamemodeFilter(ALL_FILTER)}
                  className={cn(
                    PILL_BASE,
                    "px-2.5 py-1",
                    activeFilter === ALL_FILTER ? PILL_ON : PILL_OFF
                  )}
                >
                  {t("mapVeto.filterOption", {
                    gamemode: t("mapVeto.filterAll"),
                    count: pool.length
                  })}
                </button>
                {poolGroups.map((group) => (
                  <button
                    key={group.key}
                    type="button"
                    aria-pressed={activeFilter === group.key}
                    onClick={() => setGamemodeFilter(group.key)}
                    className={cn(
                      PILL_BASE,
                      "px-2.5 py-1",
                      activeFilter === group.key ? PILL_ON : PILL_OFF
                    )}
                  >
                    {t("mapVeto.filterOption", {
                      gamemode: group.label,
                      count: group.maps.length
                    })}
                  </button>
                ))}
              </div>
            ) : null}
          </CardHeader>
          <CardContent>
            {activeGroup ? (
              // A single gamemode is filtered: the pressed pill already names
              // it, so a repeated heading would be noise.
              <ul className={MAP_GRID}>{activeGroup.maps.map(renderMapTile)}</ul>
            ) : (
              // Grouped by gamemode: "Control (7) / Hybrid (8)" is how a captain
              // reasons about a pool; an alphabetical run of thirty tiles is not.
              <div className="space-y-6">
                {poolGroups.map((group) => (
                  <section key={group.key} className="space-y-2.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("mapVeto.filterOption", {
                        gamemode: group.label,
                        count: group.maps.length
                      })}
                    </h3>
                    <ul className={MAP_GRID}>{group.maps.map(renderMapTile)}</ul>
                  </section>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
