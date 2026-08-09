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
import type { MapVetoConfig, Stage } from "@/types/tournament.types";
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
 * Candidates a slot needs to be bannable down to one map. Mirrors the server's
 * `SLOT_CANDIDATE_FLOOR`, which refuses fewer at upsert and re-checks at session
 * creation, because a slot's candidate rows carry `map_id` FKs that cascade from
 * `overwatch.map`: deleting a map can drop a stored slot under the floor with no
 * upsert running.
 */
const SLOT_CANDIDATE_FLOOR = 2;

/** One map a config names, resolved against the catalogue when it can be. */
interface PoolEntry {
  id: number;
  /** Null when the competitive catalogue carries no map with this id. */
  map: MapRead | null;
}

/** One map of a series: a slot with its candidates, or a flat config's pool. */
interface LevelRow {
  /** The slot's own `position`, or null for a flat config's single pool. */
  position: number | null;
  candidates: PoolEntry[];
  /** The map the regulation plays on a draw, or null when none is named. */
  reserve: PoolEntry | null;
}

interface LevelView {
  key: string;
  /** Signed round, or null for a whole-stage / tournament-wide level. */
  round: number | null;
  /** "Round 1", "Lower R2", or the whole-stage / tournament-wide level's name. */
  label: string;
  /** Which half of the bracket the level sits in; drives the optional heading. */
  half: "upper" | "lower" | "none";
  rows: LevelRow[];
}

interface StageView {
  key: string;
  /** Null for the tournament-wide level, which belongs to no stage. */
  title: string | null;
  levels: LevelView[];
}

/**
 * Every map id the tournament's veto configs name, anywhere.
 *
 * The union across every cascade level rather than one level's pool. The page
 * used to show one level at a time, reached through a stage/round picker that
 * could not name a lower-bracket round at all, and a tournament whose organizer
 * wrote only per-round configs — the normal shape — showed nothing until the
 * viewer guessed a round. The per-round breakdown below answers "what does round
 * N play"; this answers "what does the tournament play".
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

/**
 * Every configured level, grouped by stage and ordered the way it is played.
 *
 * A flat enumeration of what the organizer wrote, with no inheritance reasoning:
 * a level appears here when it carries a config of its own, and a round that
 * inherits simply has no entry. Resolving the cascade instead would put the same
 * pool under a dozen headings and re-introduce the scope machinery this page was
 * rid of.
 *
 * Round order is play order, not numeric order: upper rounds ascend, then lower
 * rounds by depth, so `-1` reads before `-2`.
 */
function buildStageViews(
  configs: MapVetoConfig[],
  stagesById: Map<number, Stage>,
  mapsById: Map<number, MapRead>,
  label: {
    tournament: string;
    wholeStage: string;
    round: (round: number) => string;
    unknownStage: (id: number) => string;
  }
): StageView[] {
  const entry = (id: number): PoolEntry => ({ id, map: mapsById.get(id) ?? null });
  const rowsOf = (config: MapVetoConfig): LevelRow[] => {
    if (config.mode !== "slots") {
      // One pool for every map of the series, so one row and no slot number.
      return [{ position: null, candidates: config.map_ids.map(entry), reserve: null }];
    }
    // Sorted on `position` rather than trusted from the wire, the same way the
    // admin editor and the veto room sort them: `position` is the play order and
    // nothing else here reconstructs it.
    return [...config.slots]
      .sort((left, right) => left.position - right.position)
      .map((slot) => ({
        position: slot.position,
        candidates: slot.candidates.map(entry),
        reserve: slot.reserve_map_id != null ? entry(slot.reserve_map_id) : null
      }));
  };

  const byStage = new Map<number | null, MapVetoConfig[]>();
  for (const config of configs) {
    const stageId = config.stage_id ?? null;
    const bucket = byStage.get(stageId);
    if (bucket) bucket.push(config);
    else byStage.set(stageId, [config]);
  }

  const views: StageView[] = [];
  for (const [stageId, stageConfigs] of byStage) {
    const levels: LevelView[] = stageConfigs.map((config) => {
      const round = config.round ?? null;
      const wholeScopeLabel = stageId == null ? label.tournament : label.wholeStage;
      return {
        key: `${stageId ?? "tournament"}:${round ?? "whole"}`,
        round,
        label: round == null ? wholeScopeLabel : label.round(round),
        half: round == null ? "none" : round > 0 ? "upper" : "lower",
        rows: rowsOf(config)
      };
    });
    // The stage-wide level first, then the upper bracket in order, then the
    // lower bracket by depth.
    const rank = (level: LevelView) => (level.round == null ? 0 : level.round > 0 ? 1 : 2);
    levels.sort(
      (left, right) =>
        rank(left) - rank(right) || Math.abs(left.round ?? 0) - Math.abs(right.round ?? 0)
    );

    views.push({
      key: String(stageId ?? "tournament"),
      title:
        stageId == null ? null : (stagesById.get(stageId)?.name ?? label.unknownStage(stageId)),
      levels
    });
  }

  // The tournament-wide level first — it is the one that applies everywhere —
  // then stages in the order they are played. A stage the stages read does not
  // carry sorts last rather than pretending to an order it has no field for.
  const stageOrder = (view: StageView) =>
    view.title === null ? -1 : (stagesById.get(Number(view.key))?.order ?? Number.MAX_SAFE_INTEGER);
  return views.sort(
    (left, right) => stageOrder(left) - stageOrder(right) || left.key.localeCompare(right.key)
  );
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

  // Stages are read for their names and their order only, so this one degrades
  // rather than blocking: a stage the read does not carry is named by its id and
  // sorts last. Deliberately not swallowed, so the failure still reaches the
  // global error handler.
  const stagesQuery = useQuery({
    queryKey: ["public", "tournament", tournamentId, "stages"],
    queryFn: () => tournamentService.getStages(tournamentId)
  });

  const maps = useMemo(() => {
    const raw = mapsQuery.data?.results ?? [];
    return raw.filter((map) => map.in_competitive !== false);
  }, [mapsQuery.data]);
  const configs = useMemo(() => vetoConfigsQuery.data?.configs ?? [], [vetoConfigsQuery.data]);
  const stagesById = useMemo(
    () => new Map((stagesQuery.data ?? []).map((stage) => [stage.id, stage])),
    [stagesQuery.data]
  );
  const mapsById = useMemo(() => new Map(maps.map((map) => [map.id, map])), [maps]);

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

  const stageViews = useMemo(
    () =>
      buildStageViews(configs, stagesById, mapsById, {
        tournament: t("mapVeto.scope.tournamentDefault"),
        wholeStage: t("mapVeto.wholeStage"),
        round: (round) =>
          round < 0
            ? // The same label the bracket view gives this round, so the two
              // surfaces name it identically.
              t("bracket.lowerRound", { n: String(-round) })
            : t("bracket.round", { n: String(round) }),
        unknownStage: (id) => t("mapVeto.scope.unknownStage", { id })
      }),
    [configs, stagesById, mapsById, t]
  );

  // A filter left over from a previous pool must not blank the grid: fall back
  // to "all" whenever the remembered gamemode is absent from the current pool.
  const activeFilter = poolGroups.some((group) => group.key === gamemodeFilter)
    ? gamemodeFilter
    : ALL_FILTER;
  const activeGroup =
    activeFilter === ALL_FILTER ? null : poolGroups.find((group) => group.key === activeFilter);

  if (vetoConfigsQuery.isLoading || mapsQuery.isLoading || stagesQuery.isLoading) {
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

  /**
   * A candidate the competitive catalogue cannot resolve, named the way the veto
   * room names it. Kept here and dropped from the pool above on purpose: the pool
   * answers "which maps get played", and a map retired from rotation does not,
   * while a round's rows reproduce the regulation, where a slot's candidate count
   * is what the rules are written against and a missing chip under-reports it.
   */
  const entryName = (entry: PoolEntry) =>
    entry.map?.name ?? t("encounters.veto.room.maps.mapNumber", { id: entry.id });

  const renderLevel = (level: LevelView) => (
    <div key={level.key} className="space-y-2 rounded-lg border border-border/70 bg-card/40 p-3">
      <h5 className="text-sm font-semibold">{level.label}</h5>
      {/* Ordered, because the order is the answer: a slot's number is the map of
          the series it decides, and a series only reaches the later ones. */}
      <ol className="space-y-2">
        {level.rows.map((row, index) => (
          <li
            key={row.position ?? index}
            className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3"
          >
            <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:w-24">
              {row.position != null
                ? t("encounters.veto.room.slot.label", { n: row.position })
                : t("mapVeto.roundPoolShared")}
            </span>
            <div className="flex flex-1 flex-wrap items-baseline gap-1.5">
              {row.candidates.map((candidate, candidateIndex) => (
                // The same map legitimately appears in more than one slot and even
                // twice in one, so the key carries the position it is listed at.
                <span
                  key={`${candidate.id}-${candidateIndex}`}
                  className="rounded-md border border-border/70 bg-background px-2 py-0.5 text-xs font-medium"
                >
                  {entryName(candidate)}
                </span>
              ))}
              {row.position != null && row.candidates.length < SLOT_CANDIDATE_FLOOR ? (
                <span className="text-xs text-destructive">
                  {t("mapVeto.slotUnderfilled", { n: row.position })}
                </span>
              ) : null}
              {row.reserve ? (
                <span className="text-xs text-muted-foreground">
                  {t("encounters.veto.room.slot.reserve", { map: entryName(row.reserve) })}
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );

  const renderStageView = (view: StageView) => {
    const hasLower = view.levels.some((level) => level.half === "lower");
    const halves = [
      { half: "none" as const, heading: null },
      // Headings only where they discriminate: a stage with one bracket would be
      // announced "Upper bracket" for a distinction it does not have.
      { half: "upper" as const, heading: hasLower ? t("mapVeto.roundGroupUpper") : null },
      { half: "lower" as const, heading: hasLower ? t("mapVeto.roundGroupLower") : null }
    ];
    return (
      <section key={view.key} className="space-y-3">
        {view.title ? (
          <h4 className="text-xs font-semibold uppercase tracking-wider text-primary">
            {view.title}
          </h4>
        ) : null}
        {halves.map(({ half, heading }) => {
          const levels = view.levels.filter((level) => level.half === half);
          if (levels.length === 0) return null;
          return (
            <div key={half} className="space-y-2">
              {heading ? (
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {heading}
                </p>
              ) : null}
              {levels.map(renderLevel)}
            </div>
          );
        })}
      </section>
    );
  };

  return (
    // No heading here: the tournament page already names the tournament and this
    // tab, and the cards below say what each block is.
    <div className="space-y-6">
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
        <>
          <Card role="group" aria-label={t("mapVeto.poolTitle")}>
            <CardHeader className="flex flex-col gap-3 pb-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle asChild>
                  <h3 className="text-sm font-semibold">{t("mapVeto.poolTitle")}</h3>
                </CardTitle>
                <Badge variant="secondary" className="gap-1.5">
                  <MapPin className="h-3.5 w-3.5" aria-hidden />
                  {t("mapVeto.mapsInPool", { count: pool.length })}
                </Badge>
              </div>

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
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("mapVeto.filterOption", {
                          gamemode: group.label,
                          count: group.maps.length
                        })}
                      </h4>
                      <ul className={MAP_GRID}>{group.maps.map(renderMapTile)}</ul>
                    </section>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* The pool above says what the tournament plays; this says when. Only
              levels the organizer configured appear — a round that inherits has
              no entry of its own, and resolving the cascade here would print the
              same pool under a dozen headings. */}
          {stageViews.length > 0 ? (
            <Card role="group" aria-label={t("mapVeto.roundsTitle")}>
              <CardHeader className="pb-4">
                <CardTitle asChild>
                  <h3 className="text-sm font-semibold">{t("mapVeto.roundsTitle")}</h3>
                </CardTitle>
                <CardDescription>{t("mapVeto.slotPoolDescription")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">{stageViews.map(renderStageView)}</CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
