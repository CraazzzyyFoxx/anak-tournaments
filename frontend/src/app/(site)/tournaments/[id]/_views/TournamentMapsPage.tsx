"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Gamepad2,
  Layers,
  MapPin,
  Shield,
  Sparkles,
  Swords
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import mapService from "@/services/map.service";
import tournamentService from "@/services/tournament.service";
import type { MapRead } from "@/types/map.types";
import type { MapVetoConfig, Stage, VetoPreset, VetoSequenceToken } from "@/types/tournament.types";
import {
  getFormatSlots,
  getVetoPresetLabel,
  tokenAction,
  tokenLabel
} from "@/app/admin/tournaments/[id]/components/mapVeto.helpers";

interface TournamentMapsPageProps {
  tournamentId: number;
}

export default function TournamentMapsPage({ tournamentId }: TournamentMapsPageProps) {
  const [selectedStageId, setSelectedStageId] = useState<number | null>(null);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [activeGamemodeFilter, setActiveGamemodeFilter] = useState<string>("all");

  // Query veto configs (public or admin fallback)
  const vetoConfigsQuery = useQuery({
    queryKey: ["public", "tournament", tournamentId, "veto-configs"],
    queryFn: () => tournamentService.getVetoConfigs(tournamentId).catch(() => ({ configs: [] }))
  });

  const stagesQuery = useQuery({
    queryKey: ["public", "tournament", tournamentId, "stages"],
    queryFn: () => tournamentService.getStages(tournamentId).catch(() => [])
  });

  const mapsQuery = useQuery({
    queryKey: ["maps", "all"],
    queryFn: () => mapService.getAll({ perPage: -1, sort: "name", order: "asc" })
  });

  const maps = useMemo(() => mapsQuery.data?.results ?? [], [mapsQuery.data]);
  const mapsById = useMemo(() => new Map(maps.map((map) => [map.id, map])), [maps]);
  const stages = useMemo(() => stagesQuery.data ?? [], [stagesQuery.data]);
  const stagesById = useMemo(() => new Map(stages.map((stage) => [stage.id, stage])), [stages]);
  const configs = useMemo(() => vetoConfigsQuery.data?.configs ?? [], [vetoConfigsQuery.data]);

  const gamemodesList = useMemo(() => {
    const set = new Set<string>();
    for (const map of maps) {
      if (map.gamemode?.name) set.add(map.gamemode.name);
    }
    return Array.from(set).sort();
  }, [maps]);

  // Resolve active config for current selection
  const activeConfig = useMemo(() => {
    if (configs.length === 0) return null;

    // Exact stage + round
    if (selectedStageId != null && selectedRound != null) {
      const match = configs.find((c) => c.stage_id === selectedStageId && c.round === selectedRound);
      if (match) return match;
    }

    // Stage default
    if (selectedStageId != null) {
      const match = configs.find((c) => c.stage_id === selectedStageId && c.round == null);
      if (match) return match;
    }

    // Tournament default
    return configs.find((c) => c.stage_id == null) ?? configs[0] ?? null;
  }, [configs, selectedStageId, selectedRound]);

  const activeMapPool = useMemo(() => {
    if (!activeConfig) return maps;
    if (activeConfig.map_ids.length === 0) return maps;
    return activeConfig.map_ids
      .map((id: number) => mapsById.get(id))
      .filter((m: MapRead | undefined): m is MapRead => m != null);
  }, [activeConfig, maps, mapsById]);

  const filteredPool = useMemo(() => {
    if (activeGamemodeFilter === "all") return activeMapPool;
    return activeMapPool.filter((m: MapRead) => m.gamemode?.name === activeGamemodeFilter);
  }, [activeMapPool, activeGamemodeFilter]);
  const preset = (activeConfig?.preset ?? "bo3") as VetoPreset;
  const formatSlots = useMemo(() => getFormatSlots(preset), [preset]);

  return (
    <div className="space-y-6">
      {/* ── Overview Header ─────────────────────────────────────────────────── */}
      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-card via-card to-primary/5">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" aria-hidden />
              <CardTitle className="text-xl font-bold">Официальный мап-пул турнира</CardTitle>
            </div>
            <CardDescription>
              Карты, привязка игровых режимов по слотам и правила мап-вето для участников и зрителей.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              Карт в пуле: {activeMapPool.length}
            </Badge>
            <Badge variant="secondary" className="flex items-center gap-1">
              <Gamepad2 className="h-3.5 w-3.5 text-primary" aria-hidden />
              Формат: {getVetoPresetLabel(preset)}
            </Badge>
          </div>
        </CardHeader>
      </Card>

      {/* ── Stage & Round Filter ───────────────────────────────────────────── */}
      {stages.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" aria-hidden />
              Выбор стадии и раунда турнира
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedStageId(null);
                  setSelectedRound(null);
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all",
                  selectedStageId == null
                    ? "border-primary bg-primary text-primary-foreground shadow-xs"
                    : "border-border/70 bg-card hover:border-primary/50"
                )}
              >
                <Shield className="h-3.5 w-3.5" aria-hidden />
                Дефолт турнира
              </button>

              {stages.map((stage) => {
                const isSelected = selectedStageId === stage.id;
                return (
                  <button
                    key={stage.id}
                    type="button"
                    onClick={() => {
                      setSelectedStageId(stage.id);
                      setSelectedRound(null);
                    }}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground shadow-xs"
                        : "border-border/70 bg-card hover:border-primary/50"
                    )}
                  >
                    <Layers className="h-3.5 w-3.5" aria-hidden />
                    {stage.name}
                  </button>
                );
              })}
            </div>

            {selectedStageId != null ? (
              <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-accent/30 p-2 text-xs">
                <span className="font-semibold text-muted-foreground">Раунд:</span>
                <Select
                  value={selectedRound != null ? String(selectedRound) : "default"}
                  onValueChange={(val) =>
                    setSelectedRound(val === "default" ? null : Number(val))
                  }
                >
                  <SelectTrigger className="h-7 w-44 text-xs">
                    <SelectValue placeholder="Дефолт стадии" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Дефолт стадии</SelectItem>
                    {Array.from({
                      length: stagesById.get(selectedStageId)?.max_rounds ?? 5
                    }).map((_, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>
                        Раунд {i + 1}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* ── Gamemode Match Slots ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Swords className="h-4 w-4 text-primary" aria-hidden />
            Порядок игровых режимов по слотам серии ({preset.toUpperCase()})
          </CardTitle>
          <CardDescription>
            Официальный Overwatch порядок выбора карт в рамках серии.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2.5 sm:grid-cols-3 md:grid-cols-5">
            {formatSlots.map((slot) => (
              <div
                key={slot.slotNumber}
                className="flex flex-col gap-1 rounded-xl border border-primary/20 bg-primary/5 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">{slot.label}</span>
                  <Badge variant="outline" className="text-[10px] bg-background">
                    {slot.suggestedGamemode}
                  </Badge>
                </div>
                <span className="mt-1 text-xs text-muted-foreground">
                  Режим: <strong className="text-foreground">{slot.suggestedGamemode}</strong>
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Active Map Pool Cards Grid ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pb-3">
          <div>
            <CardTitle className="text-sm font-semibold">Карты в пуле ({activeMapPool.length})</CardTitle>
            <CardDescription>Доступные карты для бана и пика капитанами.</CardDescription>
          </div>

          {/* Gamemode filter pills */}
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setActiveGamemodeFilter("all")}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-all",
                activeGamemodeFilter === "all"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border/70 bg-card hover:border-primary/50"
              )}
            >
              Все ({activeMapPool.length})
            </button>
            {gamemodesList.map((gm: string) => {
              const count = activeMapPool.filter((m: MapRead) => m.gamemode?.name === gm).length;
              return (
                <button
                  key={gm}
                  type="button"
                  onClick={() => setActiveGamemodeFilter(gm)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs font-medium transition-all",
                    activeGamemodeFilter === gm
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/70 bg-card hover:border-primary/50"
                  )}
                >
                  {gm} ({count})
                </button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent>
          {mapsQuery.isLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
          ) : filteredPool.length === 0 ? (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              Карты для данного фильтра не найдены.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
              {filteredPool.map((map: MapRead) => (
                <div
                  key={map.id}
                  className="relative flex h-28 flex-col justify-between overflow-hidden rounded-xl border border-border/70 bg-card p-2.5 transition-all hover:border-primary/50 hover:shadow-xs"
                >
                  {map.image_path ? (
                    <div
                      aria-hidden
                      className="absolute inset-0 bg-cover bg-center opacity-30"
                      style={{ backgroundImage: `url("${map.image_path}")` }}
                    />
                  ) : (
                    <div aria-hidden className="absolute inset-0 bg-muted/40" />
                  )}
                  <div
                    aria-hidden
                    className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent"
                  />

                  <div className="relative z-10">
                    {map.gamemode?.name ? (
                      <Badge variant="outline" className="bg-background/80 text-[10px] backdrop-blur-xs">
                        {map.gamemode.name}
                      </Badge>
                    ) : null}
                  </div>

                  <span className="relative z-10 truncate text-xs font-bold text-foreground">
                    {map.name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Veto Rules Timeline ────────────────────────────────────────────── */}
      {activeConfig?.sequence && activeConfig.sequence.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Последовательность мап-вето</CardTitle>
            <CardDescription>
              Правила вычеркивания и выбора карт капитанами перед матчем.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-wrap gap-2">
              {activeConfig.sequence.map((token: VetoSequenceToken, index: number) => {
                const action = tokenAction(token);
                return (
                  <li
                    key={index}
                    className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-card px-3 py-1.5 text-xs font-semibold"
                  >
                    <span className="size-4 flex items-center justify-center rounded-full bg-muted text-[10px]">
                      {index + 1}
                    </span>
                    <Badge
                      variant={action === "ban" ? "destructive" : action === "pick" ? "default" : "secondary"}
                      className="text-[10px]"
                    >
                      {tokenLabel(token)}
                    </Badge>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
