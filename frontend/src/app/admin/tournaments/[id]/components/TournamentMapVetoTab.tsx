"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Gamepad2,
  Layers,
  LoaderCircle,
  MapPin,
  Pencil,
  Plus,
  RotateCcw,
  Shield,
  Trash2,
  X
} from "lucide-react";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { TONE_CLASS } from "@/components/admin/tone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/notify";
import adminService from "@/services/admin.service";
import mapService from "@/services/map.service";
import type { MapRead } from "@/types/map.types";
import type {
  MapVetoConfig,
  MapVetoConfigUpsertInput,
  Stage,
  VetoPreset,
  VetoSequenceToken
} from "@/types/tournament.types";
import {
  BO3_SEQUENCE,
  BO5_SEQUENCE,
  buildBo1Sequence,
  buildToken,
  getFormatSlots,
  getVetoLevelLabel,
  getVetoPresetLabel,
  tokenAction,
  tokenLabel,
  tokenSide,
  validateVetoConfigForm,
  type VetoLevelType,
  type VetoStepAction,
  type VetoStepSide
} from "./mapVeto.helpers";

interface TournamentMapVetoTabProps {
  tournamentId: number;
  stages: Stage[];
  canManage: boolean;
}

interface VetoConfigFormState {
  levelType: VetoLevelType;
  stageId: number | null;
  round: number | null;
  mapIds: number[];
  sequence: VetoSequenceToken[];
  preset: VetoPreset;
  turnTimerSeconds: number | null;
}

const emptyFormState: VetoConfigFormState = {
  levelType: "tournament",
  stageId: null,
  round: null,
  mapIds: [],
  sequence: [],
  preset: "bo3",
  turnTimerSeconds: 30
};

function getConfigFormState(config: MapVetoConfig): VetoConfigFormState {
  return {
    levelType:
      config.stage_id == null ? "tournament" : config.round == null ? "stage" : "stage_round",
    stageId: config.stage_id,
    round: config.round,
    mapIds: [...config.map_ids],
    sequence: [...config.sequence],
    preset: config.preset ?? "custom",
    turnTimerSeconds: config.turn_timer_seconds
  };
}

function MapPoolCard({
  map,
  selectionIndex,
  disabled,
  onToggle
}: {
  map: MapRead;
  selectionIndex: number;
  disabled: boolean;
  onToggle: () => void;
}) {
  const selected = selectionIndex >= 0;
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "relative flex h-24 flex-col justify-between overflow-hidden rounded-xl border p-2 text-left transition-all",
        selected
          ? "border-primary bg-primary/10 ring-2 ring-primary/40 shadow-sm"
          : "border-border/70 bg-card hover:border-primary/50 hover:bg-accent/40",
        disabled && "cursor-not-allowed opacity-60"
      )}
    >
      {map.image_path ? (
        <div
          aria-hidden
          className="absolute inset-0 bg-cover bg-center opacity-30 transition-opacity group-hover:opacity-40"
          style={{ backgroundImage: `url("${map.image_path}")` }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-muted/40" />
      )}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent"
      />

      <div className="relative z-10 flex items-center justify-between gap-1">
        {map.gamemode?.name ? (
          <Badge variant="outline" className="bg-background/80 text-[10px] backdrop-blur-xs">
            {map.gamemode.name}
          </Badge>
        ) : (
          <span />
        )}
        {selected ? (
          <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-semibold tabular-nums text-primary-foreground shadow-xs">
            {selectionIndex + 1}
          </span>
        ) : null}
      </div>

      <span className="relative z-10 truncate text-xs font-semibold text-foreground">
        {map.name}
      </span>
    </button>
  );
}

export function TournamentMapVetoTab({
  tournamentId,
  stages,
  canManage
}: TournamentMapVetoTabProps) {
  const queryClient = useQueryClient();
  const configsQueryKey = ["admin", "tournament", tournamentId, "veto-configs"] as const;

  // Selected Scope State: levelType, stageId, round
  const [selectedLevelType, setSelectedLevelType] = useState<VetoLevelType>("tournament");
  const [selectedStageId, setSelectedStageId] = useState<number | null>(null);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);

  // Gamemode Filter for Map Pool View
  const [activeGamemodeFilter, setActiveGamemodeFilter] = useState<string>("all");

  const [formState, setFormState] = useState<VetoConfigFormState>(emptyFormState);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [configPendingDelete, setConfigPendingDelete] = useState<MapVetoConfig | null>(null);

  const configsQuery = useQuery({
    queryKey: configsQueryKey,
    queryFn: () => adminService.listVetoConfigs(tournamentId)
  });

  const mapsQuery = useQuery({
    queryKey: ["maps", "all"],
    queryFn: () => mapService.getAll({ perPage: -1, sort: "name", order: "asc" })
  });

  const maps = useMemo(() => {
    const raw = mapsQuery.data?.results ?? [];
    return raw.filter((map) => map.in_competitive !== false);
  }, [mapsQuery.data]);
  const mapsById = useMemo(() => new Map(maps.map((map) => [map.id, map])), [maps]);
  const stagesById = useMemo(() => new Map(stages.map((stage) => [stage.id, stage])), [stages]);

  const gamemodesList = useMemo(() => {
    const set = new Set<string>();
    for (const map of maps) {
      if (map.gamemode?.name) set.add(map.gamemode.name);
    }
    return Array.from(set).sort();
  }, [maps]);

  const sortedStages = useMemo(
    () => [...stages].sort((left, right) => left.order - right.order),
    [stages]
  );

  const configs = useMemo(() => {
    const rows = configsQuery.data?.configs ?? [];
    return [...rows].sort((left, right) => {
      if (left.stage_id == null || right.stage_id == null) {
        return (left.stage_id == null ? 0 : 1) - (right.stage_id == null ? 0 : 1);
      }
      if (left.stage_id !== right.stage_id) {
        const leftOrder = stagesById.get(left.stage_id)?.order ?? left.stage_id;
        const rightOrder = stagesById.get(right.stage_id)?.order ?? right.stage_id;
        return leftOrder - rightOrder;
      }
      return (left.round ?? 0) - (right.round ?? 0);
    });
  }, [configsQuery.data, stagesById]);

  // Find exact config matching the current selected level
  const activeLevelConfig = useMemo(() => {
    return configs.find((config) => {
      if (selectedLevelType === "tournament") {
        return config.stage_id == null && config.round == null;
      }
      if (selectedLevelType === "stage") {
        return config.stage_id === selectedStageId && config.round == null;
      }
      if (selectedLevelType === "stage_round") {
        return config.stage_id === selectedStageId && config.round === selectedRound;
      }
      return false;
    });
  }, [configs, selectedLevelType, selectedStageId, selectedRound]);

  // Sync active config to formState when level selection changes
  useMemo(() => {
    if (activeLevelConfig) {
      setFormState(getConfigFormState(activeLevelConfig));
    } else {
      // Default initial form state for empty level
      setFormState({
        levelType: selectedLevelType,
        stageId: selectedStageId,
        round: selectedRound,
        mapIds: maps.map((m) => m.id),
        sequence: [...BO3_SEQUENCE],
        preset: "bo3",
        turnTimerSeconds: 30
      });
    }
    setFormError(undefined);
  }, [activeLevelConfig, selectedLevelType, selectedStageId, selectedRound, maps]);

  const upsertMutation = useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: (data: MapVetoConfigUpsertInput) =>
      adminService.upsertVetoConfig(tournamentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configsQueryKey });
      notify.success("Конфигурация вето успешно сохранена");
      setFormError(undefined);
    },
    onError: (error: Error) => {
      setFormError(error.message);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (configId: number) => adminService.deleteVetoConfig(configId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configsQueryKey });
      setConfigPendingDelete(null);
      notify.success("Конфигурация вето удалена (используется дефолт)");
    }
  });

  const selectLevel = (levelType: VetoLevelType, stageId: number | null, round: number | null) => {
    setSelectedLevelType(levelType);
    setSelectedStageId(stageId);
    setSelectedRound(round);
  };

  const patchForm = (patch: Partial<VetoConfigFormState>) => {
    setFormState((previous) => ({ ...previous, ...patch }));
  };

  const toggleMap = (mapId: number) => {
    setFormState((previous) => {
      const selected = previous.mapIds.includes(mapId);
      const mapIds = selected
        ? previous.mapIds.filter((id) => id !== mapId)
        : [...previous.mapIds, mapId];
      const sequence =
        previous.preset === "bo1" && mapIds.length > 0
          ? buildBo1Sequence(mapIds.length)
          : previous.sequence;
      return { ...previous, mapIds, sequence };
    });
  };

  const applyPreset = (preset: Exclude<VetoPreset, "custom">) => {
    setFormState((previous) => {
      const sequence =
        preset === "bo1"
          ? buildBo1Sequence(previous.mapIds.length)
          : preset === "bo3"
            ? [...BO3_SEQUENCE]
            : [...BO5_SEQUENCE];
      return { ...previous, preset, sequence };
    });
  };

  const patchSequence = (mutate: (steps: VetoSequenceToken[]) => VetoSequenceToken[]) => {
    setFormState((previous) => ({
      ...previous,
      preset: "custom",
      sequence: mutate([...previous.sequence])
    }));
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    patchSequence((steps) => {
      const target = index + direction;
      if (target < 0 || target >= steps.length) return steps;
      const [step] = steps.splice(index, 1);
      steps.splice(target, 0, step);
      return steps;
    });
  };

  const updateStep = (index: number, action: VetoStepAction, side: VetoStepSide) => {
    patchSequence((steps) => {
      steps[index] = buildToken(action, side);
      return steps;
    });
  };

  const validationErrors = validateVetoConfigForm(formState.sequence, formState.mapIds);
  const canSave = validationErrors.length === 0 && !upsertMutation.isPending && canManage;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    upsertMutation.mutate({
      stage_id: selectedStageId,
      round: selectedRound,
      map_ids: formState.mapIds,
      sequence: formState.sequence,
      turn_timer_seconds: formState.turnTimerSeconds,
      preset: formState.preset
    });
  };

  // Filtered maps display
  const filteredMaps = useMemo(() => {
    if (activeGamemodeFilter === "all") return maps;
    return maps.filter((map) => map.gamemode?.name === activeGamemodeFilter);
  }, [maps, activeGamemodeFilter]);

  const currentLevelTitle = useMemo(() => {
    if (selectedLevelType === "tournament") return "Общий дефолт турнира";
    const stage = stagesById.get(selectedStageId ?? -1);
    const stageName = stage?.name ?? `Стадия #${selectedStageId}`;
    if (selectedLevelType === "stage") return `Дефолт стадии: ${stageName}`;
    return `Стадия: ${stageName} · Раунд ${selectedRound}`;
  }, [selectedLevelType, selectedStageId, selectedRound, stagesById]);

  const presetButtons: {
    preset: Exclude<VetoPreset, "custom">;
    label: string;
    description: string;
    minPool: number;
  }[] = [
    { preset: "bo1", label: "Bo1", description: "Best of 1 (1 карта)", minPool: 2 },
    { preset: "bo3", label: "Bo3", description: "Best of 3 (3 карты)", minPool: BO3_SEQUENCE.length },
    { preset: "bo5", label: "Bo5", description: "Best of 5 (5 карт)", minPool: BO5_SEQUENCE.length }
  ];

  const formatSlots = useMemo(() => getFormatSlots(formState.preset), [formState.preset]);

  return (
    <div className="space-y-6">
      {/* ── Top Header ────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle asChild>
              <h1 className="text-xl font-bold tracking-tight">Конструктор пула карт и мап-вето</h1>
            </CardTitle>
            <CardDescription>
              Настройка доступных карт, игровых режимов и последовательности вето для стадий и раундов турнирной сетки.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="flex items-center gap-1">
              <Layers className="h-3.5 w-3.5" aria-hidden />
              Стадий: {stages.length}
            </Badge>
            <Badge variant="secondary" className="flex items-center gap-1">
              <Shield className="h-3.5 w-3.5 text-primary" aria-hidden />
              Сконфигурировано: {configs.length}
            </Badge>
            <Badge variant="outline" className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              Карт в базе: {maps.length}
            </Badge>
          </div>
        </CardHeader>
      </Card>

      {/* ── Stage & Round Grid Navigation ────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle asChild>
            <h2 className="text-base font-semibold">Структура стадий и раундов сетки</h2>
          </CardTitle>
          <CardDescription>
            Выберите стадию или конкретный раунд сетки для настройки персонального пула карт.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Level selection tabs */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant={selectedLevelType === "tournament" ? "default" : "outline"}
              size="sm"
              onClick={() => selectLevel("tournament", null, null)}
              className="flex items-center gap-2"
            >
              <Shield className="h-4 w-4" aria-hidden />
              Дефолт турнира
              {configs.some((c) => c.stage_id == null) ? (
                <span className="size-2 rounded-full bg-success" />
              ) : null}
            </Button>

            {sortedStages.map((stage) => {
              const isStageSelected =
                (selectedLevelType === "stage" || selectedLevelType === "stage_round") &&
                selectedStageId === stage.id;
              const hasStageConfig = configs.some(
                (c) => c.stage_id === stage.id && c.round == null
              );

              return (
                <Button
                  key={stage.id}
                  variant={isStageSelected ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => selectLevel("stage", stage.id, null)}
                  className="flex items-center gap-2"
                >
                  <Layers className="h-4 w-4" aria-hidden />
                  {stage.name}
                  {hasStageConfig ? (
                    <span className="size-2 rounded-full bg-success" />
                  ) : null}
                </Button>
              );
            })}
          </div>

          {/* Rounds grid for the active stage */}
          {selectedStageId != null ? (
            <div className="rounded-xl border border-border/70 bg-accent/20 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Раунды стадии: {stagesById.get(selectedStageId)?.name}
                </span>
                <Button
                  variant={selectedRound == null && selectedLevelType === "stage" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => selectLevel("stage", selectedStageId, null)}
                  className="text-xs"
                >
                  Дефолт для всей стадии
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
                {Array.from({ length: stagesById.get(selectedStageId)?.max_rounds ?? 5 }).map(
                  (_, index) => {
                    const roundNum = index + 1;
                    const isRoundSelected =
                      selectedLevelType === "stage_round" &&
                      selectedStageId === selectedStageId &&
                      selectedRound === roundNum;

                    const roundConfig = configs.find(
                      (c) => c.stage_id === selectedStageId && c.round === roundNum
                    );

                    return (
                      <button
                        key={roundNum}
                        type="button"
                        onClick={() => selectLevel("stage_round", selectedStageId, roundNum)}
                        className={cn(
                          "flex flex-col items-start justify-between rounded-lg border p-2.5 text-left transition-all",
                          isRoundSelected
                            ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                            : roundConfig
                              ? "border-success/50 bg-success/5 hover:border-success"
                              : "border-border/60 bg-card hover:border-primary/50"
                        )}
                      >
                        <div className="flex w-full items-center justify-between">
                          <span className="text-xs font-bold">Раунд {roundNum}</span>
                          {roundConfig ? (
                            <Badge variant="outline" className="text-[10px] border-success text-success">
                              {getVetoPresetLabel(roundConfig.preset)}
                            </Badge>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">Наследование</span>
                          )}
                        </div>
                        <span className="mt-2 text-[11px] text-muted-foreground">
                          {roundConfig
                            ? `${roundConfig.map_ids.length} карт в пуле`
                            : "Использует дефолт"}
                        </span>
                      </button>
                    );
                  }
                )}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ── Active Level Workspace & Form ───────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="border-primary/30">
          <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg font-semibold">{currentLevelTitle}</CardTitle>
                <Badge variant={activeLevelConfig ? "default" : "secondary"}>
                  {activeLevelConfig ? "Индивидуальный конфиг" : "Новая конфигурация"}
                </Badge>
              </div>
              <CardDescription>
                Укажите формат матча, привязку игровых режимов к слотам карт и сформируйте пул.
              </CardDescription>
            </div>

            {canManage && activeLevelConfig ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setConfigPendingDelete(activeLevelConfig)}
                className="flex items-center gap-1.5"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Удалить конфиг уровня
              </Button>
            ) : null}
          </CardHeader>

          <CardContent className="space-y-6 pt-6">
            {/* Format & Match Parameters */}
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-3">
                <Label className="text-sm font-semibold">Формат серии (Preset)</Label>
                <div className="grid grid-cols-3 gap-2">
                  {presetButtons.map(({ preset, label, description, minPool }) => (
                    <Button
                      key={preset}
                      type="button"
                      variant={formState.preset === preset ? "default" : "outline"}
                      disabled={formState.mapIds.length < minPool}
                      onClick={() => applyPreset(preset)}
                      className={cn(
                        "flex flex-col items-center justify-center h-auto py-2.5 text-center transition-all",
                        formState.preset === preset
                          ? "border-primary ring-2 ring-primary/40 font-bold"
                          : "border-border/70"
                      )}
                    >
                      <span className="text-sm font-semibold">{label}</span>
                      <span className="text-[10px] text-muted-foreground">{description}</span>
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Label htmlFor="turn-timer" className="text-sm font-semibold">
                  Таймер на ход (секунд)
                </Label>
                <NumberInput
                  id="turn-timer"
                  value={formState.turnTimerSeconds}
                  onValueChange={(val) => patchForm({ turnTimerSeconds: val })}
                  min={1}
                  integer
                  placeholder="30"
                  className="max-w-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Индикатор для капитанской комнаты вето (таймер обратного отсчета).
                </p>
              </div>
            </div>
            {/* Map Slots & Recommended Gamemodes Structure */}
            <div className="space-y-3 rounded-xl border border-border/70 bg-card p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Gamepad2 className="h-4 w-4 text-primary" aria-hidden />
                    Слоты карт и привязка к игровым режимам (Gamemode Slots)
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Стандартный Overwatch порядок сыгранных карт в матче серии {formState.preset.toUpperCase()}.
                  </p>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-5">
                {formatSlots.map((slot) => (
                  <div
                    key={slot.slotNumber}
                    className="flex flex-col gap-1 rounded-lg border border-border/70 bg-accent/30 p-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold">{slot.label}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {slot.suggestedGamemode}
                      </Badge>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      Режим: <strong className="text-foreground">{slot.suggestedGamemode}</strong>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Map Pool Filter & Selection */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Пул карт турнира</h3>
                  <p className="text-xs text-muted-foreground">
                    Отметьте карты, доступные капитанам для бана и пика (выбрано: {formState.mapIds.length}).
                  </p>
                </div>

                {/* Gamemode Quick Filters */}
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    variant={activeGamemodeFilter === "all" ? "default" : "outline"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setActiveGamemodeFilter("all")}
                  >
                    Все ({maps.length})
                  </Button>
                  {gamemodesList.map((gm) => {
                    const count = maps.filter((m) => m.gamemode?.name === gm).length;
                    return (
                      <Button
                        key={gm}
                        type="button"
                        variant={activeGamemodeFilter === gm ? "default" : "outline"}
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setActiveGamemodeFilter(gm)}
                      >
                        {gm} ({count})
                      </Button>
                    );
                  })}
                </div>
              </div>
              {mapsQuery.isLoading ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6">
                  {Array.from({ length: 12 }).map((_, index) => (
                    <Skeleton key={index} className="h-24 rounded-xl" />
                  ))}
                </div>
              ) : filteredMaps.length === 0 ? (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Карты выбранного игрового режима не найдены.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 md:grid-cols-6">
                  {filteredMaps.map((map) => (
                    <MapPoolCard
                      key={map.id}
                      map={map}
                      selectionIndex={formState.mapIds.indexOf(map.id)}
                      disabled={!canManage || upsertMutation.isPending}
                      onToggle={() => toggleMap(map.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Veto Sequence Timeline */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Последовательность мап-вето</h3>
                  <p className="text-xs text-muted-foreground">
                    Порядок банов и пиков команд перед началом матча.
                  </p>
                </div>
                <Badge variant={formState.preset === "custom" ? "default" : "outline"}>
                  {getVetoPresetLabel(formState.preset)}
                </Badge>
              </div>

              {formState.sequence.length === 0 ? (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Последовательность шагов пуста.
                </p>
              ) : (
                <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {formState.sequence.map((token, index) => {
                    const action = tokenAction(token);
                    const side = tokenSide(token);
                    return (
                      <li
                        key={index}
                        className="flex items-center gap-2 rounded-xl border border-border/70 bg-card p-2.5 shadow-2xs"
                      >
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold tabular-nums">
                          {index + 1}
                        </span>
                        <Select
                          value={action}
                          onValueChange={(val: string) =>
                            updateStep(index, val as VetoStepAction, side ?? "first")
                          }
                          disabled={!canManage}
                        >
                          <SelectTrigger className="h-8 w-24 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ban">БАН</SelectItem>
                            <SelectItem value="pick">ПИК</SelectItem>
                            <SelectItem value="decider">Десайдер</SelectItem>
                          </SelectContent>
                        </Select>

                        {action !== "decider" ? (
                          <Select
                            value={side ?? "first"}
                            onValueChange={(val: string) =>
                              updateStep(index, action, val as VetoStepSide)
                            }
                            disabled={!canManage}
                          >
                            <SelectTrigger className="h-8 flex-1 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="first">1-я команда</SelectItem>
                              <SelectItem value="second">2-я команда</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="flex-1 text-xs text-muted-foreground">
                            Авто-решающая
                          </span>
                        )}

                        {canManage ? (
                          <div className="flex items-center gap-0.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-6"
                              disabled={index === 0}
                              onClick={() => moveStep(index, -1)}
                            >
                              <ArrowUp className="h-3 w-3" aria-hidden />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-6"
                              disabled={index === formState.sequence.length - 1}
                              onClick={() => moveStep(index, 1)}
                            >
                              <ArrowDown className="h-3 w-3" aria-hidden />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-6 text-destructive"
                              onClick={() =>
                                patchSequence((steps) => {
                                  steps.splice(index, 1);
                                  return steps;
                                })
                              }
                            >
                              <X className="h-3 w-3" aria-hidden />
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              )}

              {canManage ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => patchSequence((steps) => [...steps, "ban_first"])}
                  className="flex items-center gap-1.5"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Добавить шаг
                </Button>
              ) : null}
            </div>

            {/* Validation & Save Footer */}
            {validationErrors.length > 0 ? (
              <div
                aria-live="polite"
                className="space-y-1 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {validationErrors.map((err) => (
                  <p key={err} className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    {err}
                  </p>
                ))}
              </div>
            ) : (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Check className="h-4 w-4 text-success" aria-hidden />
                Последовательность вето и пул карт прошли валидацию.
              </p>
            )}

            {formError ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>Ошибка сохранения: {formError}</span>
              </div>
            ) : null}

            {canManage ? (
              <div className="flex items-center justify-end gap-3 border-t border-border/60 pt-4">
                <Button
                  type="submit"
                  disabled={!canSave}
                  size="lg"
                  className="flex items-center gap-2"
                >
                  {upsertMutation.isPending ? (
                    <>
                      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                      Сохранение...
                    </>
                  ) : (
                    "Сохранить конфигурацию вето"
                  )}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </form>

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={Boolean(configPendingDelete)}
        onOpenChange={(open) => {
          if (!open) setConfigPendingDelete(null);
        }}
        onConfirm={() => {
          if (configPendingDelete) {
            deleteMutation.mutate(configPendingDelete.id);
          }
        }}
        title="Удалить конфигурацию вето"
        description={
          configPendingDelete
            ? `Конфигурация для "${getVetoLevelLabel(configPendingDelete, stagesById)}" будет удалена. Раунды будут наследовать вето-конфиг со следующего уровня.`
            : ""
        }
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}
