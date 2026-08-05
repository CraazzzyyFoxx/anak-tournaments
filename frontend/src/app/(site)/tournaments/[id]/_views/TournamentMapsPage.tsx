"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Info, Layers, MapPin, Swords } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import mapService from "@/services/map.service";
import tournamentService from "@/services/tournament.service";
import type { MapRead } from "@/types/map.types";
import type { MapVetoConfig } from "@/types/tournament.types";
import {
  getMapsPlayedCount,
  getVetoLevelDescriptor,
  tokenAction,
  tokenLabelKey
} from "@/app/admin/tournaments/[id]/components/mapVeto.helpers";
import { TournamentPageState } from "../_components/TournamentPageState";

interface TournamentMapsPageProps {
  tournamentId: number;
}

/**
 * Which cascade level the displayed pool actually came from, relative to the
 * viewer's stage/round selection. Surfaced verbatim so an inherited pool is
 * never mistaken for one the organizer configured for the selected round.
 */
type PoolSource = "exact" | "stage" | "tournament";

interface ResolvedPool {
  config: MapVetoConfig;
  source: PoolSource;
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

export default function TournamentMapsPage({ tournamentId }: TournamentMapsPageProps) {
  const t = useTranslations();
  const [selectedStageId, setSelectedStageId] = useState<number | null>(null);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
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

  // Stages are different: losing them only costs the scope picker, and the
  // tournament default still renders correctly without it. So this one degrades
  // rather than blocking — but it is still not swallowed, so the failure stays
  // visible to the global error handler.
  const stagesQuery = useQuery({
    queryKey: ["public", "tournament", tournamentId, "stages"],
    queryFn: () => tournamentService.getStages(tournamentId)
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
  const mapsById = useMemo(() => new Map(maps.map((map) => [map.id, map])), [maps]);
  const stages = useMemo(() => stagesQuery.data ?? [], [stagesQuery.data]);
  const stagesById = useMemo(() => new Map(stages.map((stage) => [stage.id, stage])), [stages]);
  const configs = useMemo(() => vetoConfigsQuery.data?.configs ?? [], [vetoConfigsQuery.data]);

  // Strict cascade: exact (stage + round) -> stage default -> tournament
  // default -> nothing. There is deliberately no "first config we can find"
  // fallback: presenting an arbitrary stage config as the tournament default
  // invents a rule the organizer never wrote.
  const resolved = useMemo<ResolvedPool | null>(() => {
    if (selectedStageId != null && selectedRound != null) {
      const exact = configs.find(
        (config) => config.stage_id === selectedStageId && config.round === selectedRound
      );
      if (exact) return { config: exact, source: "exact" };
    }

    if (selectedStageId != null) {
      const stageDefault = configs.find(
        (config) => config.stage_id === selectedStageId && config.round == null
      );
      if (stageDefault) return { config: stageDefault, source: "stage" };
    }

    const tournamentDefault = configs.find(
      (config) => config.stage_id == null && config.round == null
    );
    return tournamentDefault ? { config: tournamentDefault, source: "tournament" } : null;
  }, [configs, selectedStageId, selectedRound]);

  // Only ever the configured pool. An empty result is an empty pool, never a
  // licence to show the whole competitive catalogue.
  const pool = useMemo(() => {
    if (!resolved) return [];
    return resolved.config.map_ids
      .map((id) => mapsById.get(id))
      .filter((map): map is MapRead => map != null);
  }, [resolved, mapsById]);

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

  // A filter left over from a previous scope must not blank the grid: fall back
  // to "all" whenever the remembered gamemode is absent from the current pool.
  const activeFilter = poolGroups.some((group) => group.key === gamemodeFilter)
    ? gamemodeFilter
    : ALL_FILTER;
  const activeGroup =
    activeFilter === ALL_FILTER ? null : poolGroups.find((group) => group.key === activeFilter);

  /** Rounds of the selected stage that own a config instead of inheriting one. */
  const configuredRounds = useMemo(() => {
    const rounds = new Set<number>();
    if (selectedStageId == null) return rounds;
    for (const config of configs) {
      if (config.stage_id === selectedStageId && config.round != null) rounds.add(config.round);
    }
    return rounds;
  }, [configs, selectedStageId]);

  const selectedStage = selectedStageId != null ? stagesById.get(selectedStageId) : undefined;
  const roundCount = Math.max(0, selectedStage?.max_rounds ?? 0);

  const sourceLabel = useMemo(() => {
    if (!resolved) return null;
    if (resolved.source === "exact") return t("mapVeto.source.exact");
    if (resolved.source === "tournament") return t("mapVeto.source.tournament");
    const descriptor = getVetoLevelDescriptor(resolved.config, stagesById);
    const stage =
      descriptor.kind === "tournament"
        ? t("mapVeto.scope.tournamentDefault")
        : (descriptor.stageName ?? t("mapVeto.scope.unknownStage", { id: descriptor.stageId }));
    return t("mapVeto.source.stage", { stage });
  }, [resolved, stagesById, t]);

  const isInitialLoading =
    vetoConfigsQuery.isLoading || stagesQuery.isLoading || mapsQuery.isLoading;

  if (isInitialLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <div className="flex flex-wrap gap-2 pt-1">
            <Skeleton className="h-6 w-24 rounded-md" />
            <Skeleton className="h-6 w-28 rounded-md" />
            <Skeleton className="h-6 w-32 rounded-md" />
          </div>
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
      <header className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold tracking-tight">{t("mapVeto.title")}</h2>
            <p className="max-w-2xl text-sm text-muted-foreground">{t("mapVeto.description")}</p>
          </div>

          {resolved ? (
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <Badge variant="secondary" className="gap-1.5">
                <Swords className="h-3.5 w-3.5" aria-hidden />
                {t("mapVeto.format")}
                {": "}
                {t(`mapVeto.preset.${resolved.config.preset ?? "custom"}`)}
              </Badge>
              <Badge variant="outline" className="gap-1.5">
                <Layers className="h-3.5 w-3.5" aria-hidden />
                {t("mapVeto.mapsPlayed", { count: getMapsPlayedCount(resolved.config.sequence) })}
              </Badge>
              <Badge variant="outline" className="gap-1.5">
                <MapPin className="h-3.5 w-3.5" aria-hidden />
                {t("mapVeto.mapsInPool", { count: pool.length })}
              </Badge>
            </div>
          ) : null}
        </div>

        {resolved ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-xs font-semibold",
                resolved.source === "exact"
                  ? "bg-primary/15 text-primary"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {sourceLabel}
            </span>
            {poolGroups.length > 0 ? (
              <ul className="flex flex-wrap items-center gap-1.5">
                {poolGroups.map((group) => (
                  <li key={group.key}>
                    <Badge variant="outline" className="font-medium text-muted-foreground">
                      {t("mapVeto.filterOption", {
                        gamemode: group.label,
                        count: group.maps.length
                      })}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </header>

      {stages.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle asChild>
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Layers className="h-4 w-4 text-primary" aria-hidden />
                {t("mapVeto.scopeTitle")}
              </h2>
            </CardTitle>
            <CardDescription>{t("mapVeto.scopeDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              role="group"
              aria-label={t("mapVeto.stageFilterLabel")}
              className="flex flex-wrap gap-2"
            >
              <button
                type="button"
                aria-pressed={selectedStageId == null}
                onClick={() => {
                  setSelectedStageId(null);
                  setSelectedRound(null);
                }}
                className={cn(PILL_BASE, selectedStageId == null ? PILL_ON : PILL_OFF)}
              >
                {t("mapVeto.tournamentDefaultOption")}
              </button>

              {stages.map((stage) => {
                const isSelected = selectedStageId === stage.id;
                return (
                  <button
                    key={stage.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => {
                      setSelectedStageId(stage.id);
                      setSelectedRound(null);
                    }}
                    className={cn(PILL_BASE, isSelected ? PILL_ON : PILL_OFF)}
                  >
                    {stage.name}
                  </button>
                );
              })}
            </div>

            {selectedStageId != null ? (
              <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-accent/30 p-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  {t("mapVeto.roundLabel")}
                </span>
                <Select
                  value={selectedRound != null ? String(selectedRound) : "default"}
                  onValueChange={(value) =>
                    setSelectedRound(value === "default" ? null : Number(value))
                  }
                >
                  <SelectTrigger className="h-7 w-56 text-xs" aria-label={t("mapVeto.roundLabel")}>
                    <SelectValue placeholder={t("mapVeto.stageDefaultOption")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">{t("mapVeto.stageDefaultOption")}</SelectItem>
                    {/* Rounds that own a config are marked, so a viewer knows up
                        front whether a selection will show a configured pool or
                        an inherited one. */}
                    {Array.from({ length: roundCount }, (_, index) => index + 1).map((round) => (
                      <SelectItem key={round} value={String(round)}>
                        {configuredRounds.has(round)
                          ? t("mapVeto.roundOptionConfigured", { round })
                          : t("mapVeto.roundOption", { round })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {!resolved ? (
        <Card className="border-dashed">
          <CardHeader className="items-center gap-2 text-center">
            <Info className="h-6 w-6 text-muted-foreground" aria-hidden />
            <CardTitle asChild>
              <h2 className="text-base font-semibold">{t("mapVeto.notConfiguredTitle")}</h2>
            </CardTitle>
            <CardDescription className="max-w-xl">
              {t("mapVeto.notConfiguredDescription")}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-col gap-3 pb-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1.5">
                <CardTitle asChild>
                  <h2 className="text-sm font-semibold">{t("mapVeto.poolTitle")}</h2>
                </CardTitle>
                <CardDescription>{t("mapVeto.poolDescription")}</CardDescription>
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
              {pool.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
                  {t("mapVeto.poolEmpty")}
                </p>
              ) : activeGroup ? (
                // A single gamemode is filtered: the pressed pill already names
                // it, so a repeated heading would be noise.
                <ul className={MAP_GRID}>{activeGroup.maps.map(renderMapTile)}</ul>
              ) : (
                // Grouped by gamemode: "Control (6) / Hybrid (5)" is how a
                // captain reasons about a pool; an alphabetical run of 31 tiles
                // is not. The heading carries the mode, so tiles omit the badge.
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

          {resolved.config.sequence.length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle asChild>
                  <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <Swords className="h-4 w-4 text-primary" aria-hidden />
                    {t("mapVeto.sequenceTitle")}
                  </h2>
                </CardTitle>
                <CardDescription>{t("mapVeto.sequenceDescription")}</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="flex flex-wrap gap-2">
                  {resolved.config.sequence.map((token, index) => {
                    const action = tokenAction(token);
                    const label = t(`mapVeto.step.${tokenLabelKey(token)}`);
                    return (
                      <li
                        key={`${index}-${token}`}
                        className="flex items-center gap-2 rounded-lg border border-border/70 bg-card px-2.5 py-1.5"
                      >
                        <span className="sr-only">
                          {t("mapVeto.sequenceStepAria", { n: index + 1, label })}
                        </span>
                        <span
                          aria-hidden
                          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground"
                        >
                          {index + 1}
                        </span>
                        <Badge
                          aria-hidden
                          variant={
                            action === "ban"
                              ? "destructive"
                              : action === "pick"
                                ? "default"
                                : "secondary"
                          }
                          className="text-[11px]"
                        >
                          {label}
                        </Badge>
                      </li>
                    );
                  })}
                </ol>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
