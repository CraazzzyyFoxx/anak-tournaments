"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Layers,
  LoaderCircle,
  MapPin,
  Plus,
  Shield,
  Trash2,
  X
} from "lucide-react";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
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
  BO2_SEQUENCE,
  BO3_SEQUENCE,
  BO5_SEQUENCE,
  buildBo1Sequence,
  buildToken,
  getMapsPlayedCount,
  getVetoLevelDescriptor,
  tokenAction,
  tokenLabelKey,
  tokenSide,
  validateVetoConfigForm,
  type VetoLevelDescriptor,
  type VetoLevelType,
  type VetoStepAction,
  type VetoStepSide
} from "./mapVeto.helpers";

interface TournamentMapVetoTabProps {
  tournamentId: number;
  stages: Stage[];
  canManage: boolean;
}

/** Pool filter showing every map, regardless of game mode. */
const ALL_FILTER = "all";
/** Pool filter bucket for maps whose gamemode relation is missing. */
const UNGROUPED_FILTER = "__ungrouped__";

/**
 * Smallest pool a preset can run in: a sequence may never be longer than the
 * pool it draws from (the backend enforces the same rule on upsert). Bo1 bans
 * down to one map, so two is enough; the fixed presets need one map per step.
 */
const PRESET_MIN_POOL: Record<Exclude<VetoPreset, "custom">, number> = {
  bo1: 2,
  bo2: BO2_SEQUENCE.length,
  bo3: BO3_SEQUENCE.length,
  bo5: BO5_SEQUENCE.length
};

const SIZED_PRESETS = ["bo1", "bo2", "bo3", "bo5"] as const;

interface GamemodeGroup {
  /** Filter value: the gamemode name, or the ungrouped sentinel. */
  key: string;
  /** Null when the map carries no gamemode; callers translate a placeholder. */
  name: string | null;
  maps: MapRead[];
}

/** What the form hands back on submit; the parent adds the scope columns. */
interface VetoFormValues {
  mapIds: number[];
  sequence: VetoSequenceToken[];
  preset: VetoPreset;
  turnTimerSeconds: number | null;
}

function buildPresetSequence(
  preset: Exclude<VetoPreset, "custom">,
  poolSize: number
): VetoSequenceToken[] {
  switch (preset) {
    case "bo1":
      return buildBo1Sequence(poolSize);
    case "bo2":
      return [...BO2_SEQUENCE];
    case "bo3":
      return [...BO3_SEQUENCE];
    default:
      return [...BO5_SEQUENCE];
  }
}

function MapPoolTile({
  map,
  gamemodeLabel,
  ariaLabel,
  selectionIndex,
  disabled,
  onToggle
}: {
  map: MapRead;
  gamemodeLabel: string;
  ariaLabel: string;
  /** Position in the persisted pool order, or -1 when unselected. */
  selectionIndex: number;
  disabled: boolean;
  onToggle: () => void;
}) {
  const selected = selectionIndex >= 0;
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "group relative flex h-24 flex-col justify-between overflow-hidden rounded-xl border p-2 text-left transition-colors",
        selected
          ? "border-primary bg-primary/10 shadow-sm ring-2 ring-primary/40"
          : "border-border/70 bg-card hover:border-primary/50",
        disabled && "cursor-not-allowed"
      )}
    >
      {map.image_path ? (
        <div
          aria-hidden
          className="absolute inset-0 bg-cover bg-center opacity-25 transition-opacity group-hover:opacity-40"
          style={{ backgroundImage: `url("${map.image_path}")` }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-muted/40" />
      )}
      {/* Explicit scrim: map art luminance varies wildly, so the label cannot
          rely on the image staying dark enough behind it. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-background via-background/85 to-background/30"
      />

      <div className="relative z-10 flex items-start justify-between gap-1">
        <Badge variant="outline" className="bg-background/85 text-[10px]">
          {gamemodeLabel}
        </Badge>
        {selected ? (
          <span
            aria-hidden
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold tabular-nums text-primary-foreground shadow-xs"
          >
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

/**
 * One cascade level's editor. Every field is seeded once from `config` in a
 * `useState` initializer — the parent remounts this component with a fresh
 * `key` when the scope or the saved config changes, so there is never a
 * render-phase write resetting an organizer's in-progress edits.
 */
function VetoConfigForm({
  config,
  maps,
  canManage,
  isSaving,
  saveError,
  scopeLabel,
  onSave,
  onRequestDelete
}: {
  config: MapVetoConfig | null;
  maps: MapRead[];
  canManage: boolean;
  isSaving: boolean;
  saveError?: string;
  scopeLabel: string;
  onSave: (values: VetoFormValues) => void;
  /** Null when there is nothing to delete or the viewer cannot manage. */
  onRequestDelete: (() => void) | null;
}) {
  const t = useTranslations();
  const turnTimerId = useId();

  const [mapIds, setMapIds] = useState<number[]>(() =>
    config ? [...config.map_ids] : maps.map((map) => map.id)
  );
  const [sequence, setSequence] = useState<VetoSequenceToken[]>(() =>
    config ? [...config.sequence] : [...BO3_SEQUENCE]
  );
  const [preset, setPreset] = useState<VetoPreset>(() =>
    config ? config.preset ?? "custom" : "bo3"
  );
  const [turnTimerSeconds, setTurnTimerSeconds] = useState<number | null>(() =>
    config ? config.turn_timer_seconds : 30
  );
  const [gamemodeFilter, setGamemodeFilter] = useState<string>(ALL_FILTER);

  const groups = useMemo<GamemodeGroup[]>(() => {
    const byKey = new Map<string, GamemodeGroup>();
    for (const map of maps) {
      const name = map.gamemode?.name ?? null;
      const key = name ?? UNGROUPED_FILTER;
      const group = byKey.get(key);
      if (group) {
        group.maps.push(map);
      } else {
        byKey.set(key, { key, name, maps: [map] });
      }
    }
    return [...byKey.values()].sort((left, right) => {
      if (left.name === null) return 1;
      if (right.name === null) return -1;
      return left.name.localeCompare(right.name);
    });
  }, [maps]);

  const visibleGroups = useMemo(
    () =>
      gamemodeFilter === ALL_FILTER
        ? groups
        : groups.filter((group) => group.key === gamemodeFilter),
    [groups, gamemodeFilter]
  );
  const visibleMaps = useMemo(
    () => visibleGroups.flatMap((group) => group.maps),
    [visibleGroups]
  );

  /** Pool order is persisted, so selection is a position, not a boolean. */
  const selectionOrder = useMemo(
    () => new Map(mapIds.map((id, index) => [id, index])),
    [mapIds]
  );
  const visibleSelectedCount = visibleMaps.reduce(
    (total, map) => (selectionOrder.has(map.id) ? total + 1 : total),
    0
  );

  /**
   * Bo1 is the one preset whose length depends on the pool, so any pool change
   * has to rebuild its sequence. Computed outside the state updater to keep
   * both writes pure.
   */
  const applyMapIds = (compute: (current: number[]) => number[]) => {
    const next = compute(mapIds);
    setMapIds(next);
    if (preset === "bo1" && next.length > 0) {
      setSequence(buildBo1Sequence(next.length));
    }
  };

  const selectVisible = () => {
    const missing = visibleMaps
      .filter((map) => !selectionOrder.has(map.id))
      .map((map) => map.id);
    applyMapIds((current) => [...current, ...missing]);
  };

  const clearVisible = () => {
    const visible = new Set(visibleMaps.map((map) => map.id));
    applyMapIds((current) => current.filter((id) => !visible.has(id)));
  };

  const applyPreset = (next: Exclude<VetoPreset, "custom">) => {
    setPreset(next);
    setSequence(buildPresetSequence(next, mapIds.length));
  };

  /** Any hand edit means the sequence no longer matches a named preset. */
  const patchSequence = (mutate: (steps: VetoSequenceToken[]) => VetoSequenceToken[]) => {
    setPreset("custom");
    setSequence((current) => mutate([...current]));
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

  const presetOptions = SIZED_PRESETS.map((option) => {
    const minPool = PRESET_MIN_POOL[option];
    const blocked = mapIds.length < minPool;
    return {
      preset: option,
      blocked,
      // Stated, not merely implied: a greyed-out button with no reason is the
      // most confusing thing on the page.
      reason: blocked
        ? t("mapVetoAdmin.formatRequiresPool", {
            preset: t(`mapVeto.preset.${option}`),
            count: minPool
          })
        : null
    };
  });
  const blockedPresets = presetOptions.filter((option) => option.blocked);

  const issues = validateVetoConfigForm(sequence, mapIds);
  const canSave = canManage && issues.length === 0 && !isSaving;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    onSave({ mapIds, sequence, preset, turnTimerSeconds });
  };

  const renderTile = (map: MapRead) => {
    const gamemodeLabel = map.gamemode?.name ?? t("mapVetoAdmin.ungrouped");
    return (
      <MapPoolTile
        key={map.id}
        map={map}
        gamemodeLabel={gamemodeLabel}
        ariaLabel={t("mapVetoAdmin.poolToggleAria", { map: map.name, gamemode: gamemodeLabel })}
        selectionIndex={selectionOrder.get(map.id) ?? -1}
        disabled={!canManage || isSaving}
        onToggle={() =>
          applyMapIds((current) =>
            current.includes(map.id)
              ? current.filter((id) => id !== map.id)
              : [...current, map.id]
          )
        }
      />
    );
  };

  return (
    <form onSubmit={handleSubmit}>
      <Card className="border-primary/30">
        <CardHeader className="flex flex-col gap-3 border-b border-border/60 pb-4 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle asChild>
                <h2 className="text-lg font-semibold">{scopeLabel}</h2>
              </CardTitle>
              <Badge variant={config ? "default" : "secondary"}>
                {config ? t("mapVetoAdmin.levelExisting") : t("mapVetoAdmin.levelNew")}
              </Badge>
            </div>
            <CardDescription>{t("mapVetoAdmin.levelDescription")}</CardDescription>
          </div>

          {onRequestDelete ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onRequestDelete}
              className="shrink-0 gap-1.5"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              {t("mapVetoAdmin.deleteLevel")}
            </Button>
          ) : null}
        </CardHeader>

        <CardContent className="space-y-8 pt-6">
          {!canManage ? (
            <p className="rounded-xl border border-border/70 bg-accent/30 p-3 text-sm text-muted-foreground">
              {t("mapVetoAdmin.readOnly")}
            </p>
          ) : null}

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">{t("mapVetoAdmin.formatLabel")}</h3>
              <div
                role="group"
                aria-label={t("mapVetoAdmin.formatLabel")}
                className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              >
                {presetOptions.map(({ preset: option, blocked, reason }) => {
                  const active = preset === option;
                  return (
                    <Button
                      key={option}
                      type="button"
                      variant={active ? "default" : "outline"}
                      aria-pressed={active}
                      aria-label={reason ?? undefined}
                      title={reason ?? undefined}
                      disabled={!canManage || blocked}
                      onClick={() => applyPreset(option)}
                      className={cn(
                        "h-auto flex-col gap-0.5 px-2 py-2.5 text-center",
                        active ? "ring-2 ring-primary/40" : "border-border/70"
                      )}
                    >
                      <span className="text-sm font-semibold">
                        {t(`mapVeto.preset.${option}`)}
                      </span>
                      <span
                        className={cn(
                          "text-[10px]",
                          active ? "text-primary-foreground/80" : "text-muted-foreground"
                        )}
                      >
                        {t(`mapVetoAdmin.presetDescription.${option}`)}
                      </span>
                    </Button>
                  );
                })}
              </div>
              {blockedPresets.length > 0 ? (
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {blockedPresets.map(({ preset: option, reason }) => (
                    <li key={option}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="space-y-3">
              <Label htmlFor={turnTimerId} className="text-sm font-semibold">
                {t("mapVetoAdmin.turnTimerLabel")}
              </Label>
              <div className="flex items-center gap-2">
                <NumberInput
                  id={turnTimerId}
                  value={turnTimerSeconds}
                  onValueChange={setTurnTimerSeconds}
                  min={1}
                  integer
                  disabled={!canManage}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">
                  {t("mapVetoAdmin.turnTimerUnit")}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{t("mapVetoAdmin.turnTimerHint")}</p>
            </div>
          </div>

          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-0.5">
                <h3 className="text-sm font-semibold">{t("mapVetoAdmin.poolTitle")}</h3>
                <p className="text-xs text-muted-foreground">
                  {t("mapVetoAdmin.poolDescription")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="tabular-nums">
                  {t("mapVetoAdmin.poolSelected", { count: mapIds.length })}
                </Badge>
                {canManage ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={visibleSelectedCount === visibleMaps.length}
                      onClick={selectVisible}
                    >
                      {t("mapVetoAdmin.poolSelectAll")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={visibleSelectedCount === 0}
                      onClick={clearVisible}
                    >
                      {t("mapVetoAdmin.poolClear")}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>

            <div
              role="group"
              aria-label={t("mapVetoAdmin.filterLabel")}
              className="flex flex-wrap gap-1.5"
            >
              <Button
                type="button"
                size="sm"
                variant={gamemodeFilter === ALL_FILTER ? "default" : "outline"}
                aria-pressed={gamemodeFilter === ALL_FILTER}
                onClick={() => setGamemodeFilter(ALL_FILTER)}
                className="h-7 px-2.5 text-xs"
              >
                {t("mapVetoAdmin.filterOption", {
                  gamemode: t("mapVetoAdmin.filterAll"),
                  count: maps.length
                })}
              </Button>
              {groups.map((group) => (
                <Button
                  key={group.key}
                  type="button"
                  size="sm"
                  variant={gamemodeFilter === group.key ? "default" : "outline"}
                  aria-pressed={gamemodeFilter === group.key}
                  onClick={() => setGamemodeFilter(group.key)}
                  className="h-7 px-2.5 text-xs"
                >
                  {t("mapVetoAdmin.filterOption", {
                    gamemode: group.name ?? t("mapVetoAdmin.ungrouped"),
                    count: group.maps.length
                  })}
                </Button>
              ))}
            </div>

            {visibleMaps.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                {t("mapVetoAdmin.poolEmpty")}
              </p>
            ) : gamemodeFilter === ALL_FILTER ? (
              <div className="space-y-4">
                {visibleGroups.map((group) => (
                  <div key={group.key} className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("mapVetoAdmin.filterOption", {
                        gamemode: group.name ?? t("mapVetoAdmin.ungrouped"),
                        count: group.maps.length
                      })}
                    </h4>
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 md:grid-cols-6">
                      {group.maps.map(renderTile)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 md:grid-cols-6">
                {visibleMaps.map(renderTile)}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-0.5">
                <h3 className="text-sm font-semibold">{t("mapVetoAdmin.sequenceTitle")}</h3>
                <p className="text-xs text-muted-foreground">
                  {t("mapVetoAdmin.sequenceDescription")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={preset === "custom" ? "secondary" : "outline"}>
                  {t(`mapVeto.preset.${preset}`)}
                </Badge>
                <Badge variant="outline" className="tabular-nums">
                  {t("mapVeto.mapsPlayed", { count: getMapsPlayedCount(sequence) })}
                </Badge>
              </div>
            </div>

            {sequence.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                {t("mapVetoAdmin.sequenceEmpty")}
              </p>
            ) : (
              <ol className="space-y-2">
                {sequence.map((token, index) => {
                  const action = tokenAction(token);
                  const side = tokenSide(token);
                  const step = index + 1;
                  return (
                    <li
                      key={index}
                      className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card p-2.5 shadow-2xs"
                    >
                      <span
                        aria-hidden
                        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums"
                      >
                        {step}
                      </span>
                      <span className="sr-only">
                        {t("mapVetoAdmin.sequenceStep", { n: step })}
                      </span>

                      {canManage ? (
                        <>
                          <Select
                            value={action}
                            onValueChange={(value: string) =>
                              patchSequence((steps) => {
                                steps[index] = buildToken(
                                  value as VetoStepAction,
                                  side ?? "first"
                                );
                                return steps;
                              })
                            }
                          >
                            <SelectTrigger
                              aria-label={t("mapVetoAdmin.actionLabel", { n: step })}
                              className="h-8 w-32 text-xs"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ban">{t("mapVetoAdmin.action.ban")}</SelectItem>
                              <SelectItem value="pick">{t("mapVetoAdmin.action.pick")}</SelectItem>
                              <SelectItem value="decider">
                                {t("mapVetoAdmin.action.decider")}
                              </SelectItem>
                            </SelectContent>
                          </Select>

                          {action === "decider" ? (
                            <span className="text-xs text-muted-foreground">
                              {t("mapVetoAdmin.deciderAuto")}
                            </span>
                          ) : (
                            <Select
                              value={side ?? "first"}
                              onValueChange={(value: string) =>
                                patchSequence((steps) => {
                                  steps[index] = buildToken(action, value as VetoStepSide);
                                  return steps;
                                })
                              }
                            >
                              <SelectTrigger
                                aria-label={t("mapVetoAdmin.sideLabel", { n: step })}
                                className="h-8 w-36 text-xs"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="first">
                                  {t("mapVetoAdmin.side.first")}
                                </SelectItem>
                                <SelectItem value="second">
                                  {t("mapVetoAdmin.side.second")}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          )}

                          <div className="ml-auto flex items-center gap-0.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              aria-label={t("mapVetoAdmin.moveStepUp", { n: step })}
                              disabled={index === 0}
                              onClick={() => moveStep(index, -1)}
                            >
                              <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              aria-label={t("mapVetoAdmin.moveStepDown", { n: step })}
                              disabled={index === sequence.length - 1}
                              onClick={() => moveStep(index, 1)}
                            >
                              <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7 text-destructive"
                              aria-label={t("mapVetoAdmin.removeStep", { n: step })}
                              onClick={() =>
                                patchSequence((steps) => {
                                  steps.splice(index, 1);
                                  return steps;
                                })
                              }
                            >
                              <X className="h-3.5 w-3.5" aria-hidden />
                            </Button>
                          </div>
                        </>
                      ) : (
                        // Read-only: a resolved label beats a row of dead selects.
                        <span className="text-xs font-medium">
                          {t(`mapVeto.step.${tokenLabelKey(token)}`)}
                        </span>
                      )}
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
                className="gap-1.5"
              >
                <Plus className="h-4 w-4" aria-hidden />
                {t("mapVetoAdmin.addStep")}
              </Button>
            ) : null}
          </section>

          {/* The live region has to exist before the issues do. */}
          <div aria-live="polite">
            {issues.length > 0 ? (
              <div className="space-y-1.5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <p className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                  {t("mapVetoAdmin.validationTitle")}
                </p>
                <ul className="list-inside list-disc space-y-0.5">
                  {issues.map((issue) => (
                    <li key={issue.key}>
                      {t(`mapVetoAdmin.validation.${issue.key}`, issue.values)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {saveError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{t("mapVetoAdmin.saveError", { message: saveError })}</span>
            </div>
          ) : null}

          {canManage ? (
            <div className="sticky bottom-0 -mx-6 -mb-6 flex items-center justify-end gap-3 rounded-b-xl border-t border-border/60 bg-card px-6 py-4">
              <Button type="submit" size="lg" disabled={!canSave} className="gap-2">
                {isSaving ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                    {t("mapVetoAdmin.saving")}
                  </>
                ) : (
                  t("mapVetoAdmin.save")
                )}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </form>
  );
}

export function TournamentMapVetoTab({
  tournamentId,
  stages,
  canManage
}: TournamentMapVetoTabProps) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const configsQueryKey = ["admin", "tournament", tournamentId, "veto-configs"] as const;

  const [levelType, setLevelType] = useState<VetoLevelType>("tournament");
  const [stageId, setStageId] = useState<number | null>(null);
  const [round, setRound] = useState<number | null>(null);
  const [configPendingDelete, setConfigPendingDelete] = useState<MapVetoConfig | null>(null);

  const configsQuery = useQuery({
    queryKey: configsQueryKey,
    queryFn: () => adminService.listVetoConfigs(tournamentId)
  });

  // The gamemode relation is only serialized when asked for; without
  // `entities` every `map.gamemode` comes back null and the grouping,
  // the filters and the tile badges all silently vanish. The key carries
  // the token so this never shares a cache entry with a gamemode-less fetch.
  const mapsQuery = useQuery({
    queryKey: ["maps", "all", "gamemode"],
    queryFn: () =>
      mapService.getAll({ perPage: -1, sort: "name", order: "asc", entities: ["gamemode"] })
  });

  const maps = useMemo(
    () => (mapsQuery.data?.results ?? []).filter((map) => map.in_competitive !== false),
    [mapsQuery.data]
  );
  const configs = useMemo(() => configsQuery.data?.configs ?? [], [configsQuery.data]);
  const stagesById = useMemo(() => new Map(stages.map((stage) => [stage.id, stage])), [stages]);
  const sortedStages = useMemo(
    () => [...stages].sort((left, right) => left.order - right.order),
    [stages]
  );

  /** The config sitting exactly on the selected level — not an inherited one. */
  const activeConfig = useMemo(() => {
    if (levelType === "tournament") {
      return configs.find((config) => config.stage_id == null && config.round == null) ?? null;
    }
    if (levelType === "stage") {
      return configs.find((config) => config.stage_id === stageId && config.round == null) ?? null;
    }
    return configs.find((config) => config.stage_id === stageId && config.round === round) ?? null;
  }, [configs, levelType, stageId, round]);

  const describeScope = (descriptor: VetoLevelDescriptor): string => {
    if (descriptor.kind === "tournament") return t("mapVeto.scope.tournamentDefault");
    const stage =
      descriptor.stageName ?? t("mapVeto.scope.unknownStage", { id: descriptor.stageId });
    if (descriptor.kind === "stage") return t("mapVeto.scope.stage", { stage });
    return t("mapVeto.scope.stageRound", { stage, round: descriptor.round });
  };

  const scopeLabel = describeScope(
    getVetoLevelDescriptor(
      {
        stage_id: levelType === "tournament" ? null : stageId,
        round: levelType === "stage_round" ? round : null
      },
      stagesById
    )
  );

  const upsertMutation = useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: (data: MapVetoConfigUpsertInput) =>
      adminService.upsertVetoConfig(tournamentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configsQueryKey });
      notify.success(t("mapVetoAdmin.saved"));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (configId: number) => adminService.deleteVetoConfig(configId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configsQueryKey });
      setConfigPendingDelete(null);
      notify.success(t("mapVetoAdmin.deleted"));
    }
  });

  const selectLevel = (
    nextLevelType: VetoLevelType,
    nextStageId: number | null,
    nextRound: number | null
  ) => {
    // A save error belongs to the level it was raised on.
    upsertMutation.reset();
    setLevelType(nextLevelType);
    setStageId(nextStageId);
    setRound(nextRound);
  };

  const handleSave = (values: VetoFormValues) => {
    upsertMutation.mutate({
      stage_id: levelType === "tournament" ? null : stageId,
      round: levelType === "stage_round" ? round : null,
      map_ids: values.mapIds,
      sequence: values.sequence,
      turn_timer_seconds: values.turnTimerSeconds,
      preset: values.preset
    });
  };

  const activeStage = stageId == null ? null : stagesById.get(stageId) ?? null;
  const activeStageName =
    stageId == null ? null : activeStage?.name ?? t("mapVeto.scope.unknownStage", { id: stageId });
  const roundsTitle =
    activeStageName == null ? "" : t("mapVetoAdmin.roundsTitle", { stage: activeStageName });
  const roundCount = activeStage != null && activeStage.max_rounds > 0 ? activeStage.max_rounds : 0;

  const hasTournamentConfig = configs.some(
    (config) => config.stage_id == null && config.round == null
  );

  // Seeding the form happens exactly once per mount, so it must not mount
  // before both the config it seeds from and the map catalogue have arrived.
  const dataReady = configsQuery.isSuccess && mapsQuery.isSuccess;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="text-xl font-bold tracking-tight">{t("mapVetoAdmin.title")}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("mapVetoAdmin.description")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="gap-1 tabular-nums">
            <Layers className="h-3.5 w-3.5" aria-hidden />
            {t("mapVetoAdmin.stats.stages", { count: stages.length })}
          </Badge>
          <Badge variant="secondary" className="gap-1 tabular-nums">
            <Shield className="h-3.5 w-3.5" aria-hidden />
            {t("mapVetoAdmin.stats.configured", { count: configs.length })}
          </Badge>
          <Badge variant="outline" className="gap-1 tabular-nums">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            {t("mapVetoAdmin.stats.maps", { count: maps.length })}
          </Badge>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle asChild>
            <h2 className="text-base font-semibold">{t("mapVetoAdmin.scopeTitle")}</h2>
          </CardTitle>
          <CardDescription>{t("mapVetoAdmin.scopeDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            role="group"
            aria-label={t("mapVetoAdmin.scopeTitle")}
            className="flex flex-wrap gap-2"
          >
            <Button
              type="button"
              variant={levelType === "tournament" ? "default" : "outline"}
              size="sm"
              aria-pressed={levelType === "tournament"}
              onClick={() => selectLevel("tournament", null, null)}
              className="gap-2"
            >
              <Shield className="h-4 w-4" aria-hidden />
              {t("mapVetoAdmin.tournamentDefault")}
              {hasTournamentConfig ? (
                <>
                  <span aria-hidden className="size-2 shrink-0 rounded-full bg-success" />
                  <span className="sr-only">{t("mapVetoAdmin.hasOwnConfig")}</span>
                </>
              ) : null}
            </Button>

            {sortedStages.map((stage) => {
              const isStageActive = levelType !== "tournament" && stageId === stage.id;
              const isStageDefaultSelected = levelType === "stage" && stageId === stage.id;
              const hasStageConfig = configs.some(
                (config) => config.stage_id === stage.id && config.round == null
              );
              return (
                <Button
                  key={stage.id}
                  type="button"
                  variant={
                    isStageDefaultSelected ? "default" : isStageActive ? "secondary" : "outline"
                  }
                  size="sm"
                  aria-pressed={isStageDefaultSelected}
                  onClick={() => selectLevel("stage", stage.id, null)}
                  className="gap-2"
                >
                  <Layers className="h-4 w-4" aria-hidden />
                  {stage.name}
                  {hasStageConfig ? (
                    <>
                      <span aria-hidden className="size-2 shrink-0 rounded-full bg-success" />
                      <span className="sr-only">{t("mapVetoAdmin.hasOwnConfig")}</span>
                    </>
                  ) : null}
                </Button>
              );
            })}
          </div>

          {stageId != null ? (
            <div className="space-y-3 rounded-xl border border-border/70 bg-accent/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {roundsTitle}
                </h3>
                <Button
                  type="button"
                  size="sm"
                  variant={levelType === "stage" ? "default" : "ghost"}
                  aria-pressed={levelType === "stage"}
                  onClick={() => selectLevel("stage", stageId, null)}
                  className="h-7 text-xs"
                >
                  {t("mapVetoAdmin.stageDefaultButton")}
                </Button>
              </div>

              {roundCount > 0 ? (
                <div
                  role="group"
                  aria-label={roundsTitle}
                  className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5"
                >
                  {Array.from({ length: roundCount }, (_, index) => index + 1).map(
                    (roundNumber) => {
                      const isRoundSelected =
                        levelType === "stage_round" && round === roundNumber;
                      const roundConfig = configs.find(
                        (config) => config.stage_id === stageId && config.round === roundNumber
                      );
                      return (
                        <button
                          key={roundNumber}
                          type="button"
                          aria-pressed={isRoundSelected}
                          onClick={() => selectLevel("stage_round", stageId, roundNumber)}
                          className={cn(
                            "flex flex-col items-start justify-between rounded-lg border p-2.5 text-left transition-colors",
                            isRoundSelected
                              ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                              : roundConfig
                                ? "border-success/50 bg-success/5 hover:border-success"
                                : "border-border/60 bg-card hover:border-primary/50"
                          )}
                        >
                          <div className="flex w-full items-center justify-between gap-1">
                            <span className="text-xs font-semibold">
                              {t("mapVetoAdmin.roundLabel", { round: roundNumber })}
                            </span>
                            {roundConfig ? (
                              <Badge
                                variant="outline"
                                className="border-success/60 text-[10px] text-success"
                              >
                                {t(`mapVeto.preset.${roundConfig.preset ?? "custom"}`)}
                              </Badge>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">
                                {t("mapVetoAdmin.roundInherits")}
                              </span>
                            )}
                          </div>
                          <span className="mt-2 text-[11px] text-muted-foreground">
                            {roundConfig
                              ? t("mapVetoAdmin.roundPoolSize", {
                                  count: roundConfig.map_ids.length
                                })
                              : t("mapVetoAdmin.roundUsesDefault")}
                          </span>
                          {roundConfig ? (
                            <span className="sr-only">{t("mapVetoAdmin.hasOwnConfig")}</span>
                          ) : null}
                        </button>
                      );
                    }
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {dataReady ? (
        <VetoConfigForm
          key={`${levelType}:${stageId ?? "-"}:${round ?? "-"}:${activeConfig?.id ?? "new"}`}
          config={activeConfig}
          maps={maps}
          canManage={canManage}
          isSaving={upsertMutation.isPending}
          saveError={upsertMutation.error?.message}
          scopeLabel={scopeLabel}
          onSave={handleSave}
          onRequestDelete={
            canManage && activeConfig ? () => setConfigPendingDelete(activeConfig) : null
          }
        />
      ) : (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      )}

      <DeleteConfirmDialog
        open={configPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfigPendingDelete(null);
        }}
        onConfirm={() => {
          if (configPendingDelete) {
            deleteMutation.mutate(configPendingDelete.id);
          }
        }}
        title={t("mapVetoAdmin.deleteTitle")}
        description={
          configPendingDelete
            ? t("mapVetoAdmin.deleteDescription", {
                level: describeScope(getVetoLevelDescriptor(configPendingDelete, stagesById))
              })
            : ""
        }
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}
