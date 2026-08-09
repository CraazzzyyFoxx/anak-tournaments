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
import { Input } from "@/components/ui/input";
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
import { DEFAULT_BEST_OF, bestOfMessageKey, buildSequenceForBestOf, hasPerRoundBestOf, parseStageBestOf, resolveBestOf } from "@/lib/best-of";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/notify";
import adminService from "@/services/admin.service";
import mapService from "@/services/map.service";
import type { MapRead } from "@/types/map.types";
import type {
  FirstBanRotation,
  MapVetoConfig,
  MapVetoConfigSlotUpsertInput,
  MapVetoConfigUpsertInput,
  MapVetoMode,
  Stage,
  VetoPreset,
  VetoSequenceToken
} from "@/types/tournament.types";
import {
  buildToken,
  getMapsPlayedCount,
  getVetoLevelDescriptor,
  matchesMapName,
  tokenAction,
  tokenLabelKey,
  tokenSide,
  validateVetoConfigForm,
  type VetoLevelDescriptor,
  type VetoLevelType,
  type VetoStepAction,
  type VetoStepSide,
  type VetoValidationIssue
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

interface GamemodeGroup {
  /** Filter value: the gamemode name, or the ungrouped sentinel. */
  key: string;
  /** Null when the map carries no gamemode; callers translate a placeholder. */
  name: string | null;
  maps: MapRead[];
}

/** What the form hands back on submit; the parent adds the scope columns. */
interface VetoFormValues {
  /** Which pool shape the fields below describe. */
  mode: MapVetoMode;
  /** Flat mode only; the slot-mode payload sends an empty list instead. */
  mapIds: number[];
  /** Flat mode only; a slot config's steps are derived from its slots. */
  sequence: VetoSequenceToken[];
  /** Slot mode only, in play order; the server derives positions 1..N from it. */
  slots: MapVetoConfigSlotUpsertInput[];
  preset: VetoPreset;
  /** Slot mode only, but sent on every save: see the parent's `handleSave`. */
  firstBanRotation: FirstBanRotation;
  turnTimerSeconds: number | null;
}

/**
 * Series length for the selected scope, as the bracket defines it.
 *
 * The veto does not own this. The generator resolves
 * `Stage.settings_json.best_of` into `Encounter.best_of`, and the veto session
 * rebuilds its steps from that value unless the config is explicitly custom —
 * so this editor can only report the configured length, never set it.
 *
 * `bestOf` is the representative length: what the generated preview and the
 * saved fallback sequence are built for. A single round resolves exactly; a
 * whole stage uses its default; the tournament default spans stages that may
 * each run a different length, so it can only fall back to Bo3.
 */
type BracketFormat =
  | { scope: "round"; round: number; bestOf: number }
  | {
      scope: "stage";
      bestOf: number;
      /** Non-null only when the rounds do not all play the same length. */
      perRound: { round: number; bestOf: number }[] | null;
      /** The stage's final-round override, elimination stages only. */
      finalBestOf: number | null;
      /** Rounds this scope covers, for the copy that says how many share it. */
      roundCount: number;
    }
  | { scope: "tournament"; bestOf: number };

/**
 * Whether slot mode is offerable, and why not when it is not.
 *
 * Written against the `scope` discriminator rather than against `bestOf`: every
 * variant carries a number, `tournament` included — it falls back to
 * `DEFAULT_BEST_OF` — so a numeric test would open slot mode exactly where the
 * series length is unknowable (design Decision 12). Slots are the maps of one
 * series, so a scope spanning series of different lengths has no slot count.
 */
type SlotsAvailability =
  | { available: true }
  | {
      available: false;
      reasonKey: "poolShapeSlotsUnavailableStage" | "poolShapeSlotsUnavailableTournament";
    };

function resolveSlotsAvailability(format: BracketFormat): SlotsAvailability {
  switch (format.scope) {
    case "round":
      return { available: true };
    case "stage":
      return format.perRound === null && format.finalBestOf === null
        ? { available: true }
        : { available: false, reasonKey: "poolShapeSlotsUnavailableStage" };
    case "tournament":
      return { available: false, reasonKey: "poolShapeSlotsUnavailableTournament" };
  }
}

/** Sentinel for "no reserve": a Radix Select item cannot carry an empty value. */
const RESERVE_NONE = "none";

/** Which sequence a level runs: the bracket's, or one the organizer authored. */
type VetoOrderMode = "bracket" | "custom";

/**
 * One exclusive pick, rendered as labelled cards with a hint under each label.
 *
 * Used twice, by the pool shape and by the step order. Design Decision 23 keeps
 * those two separate rather than merging them into one three-way group: slots
 * change what the pool *is* rather than the order of its steps, and
 * `ck_map_veto_config_slots_not_custom` forbids the slots-plus-custom pair a
 * merged group would offer.
 */
function ChoiceCardGroup<T extends string>({
  title,
  options,
  value,
  disabled,
  onChange
}: {
  title: string;
  /**
   * Labels and hints arrive resolved, so this component stays locale-agnostic.
   * `disabled` per option is how a gated choice stays visible: the caller
   * renders the reason beside the group rather than dropping the card.
   */
  options: readonly { value: T; label: string; hint: string; disabled?: boolean }[];
  value: T;
  disabled: boolean;
  onChange: (next: T) => void;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div role="group" aria-label={title} className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const active = value === option.value;
          return (
            <Button
              key={option.value}
              type="button"
              variant={active ? "default" : "outline"}
              aria-pressed={active}
              disabled={disabled || option.disabled === true}
              onClick={() => onChange(option.value)}
              className={cn(
                "h-auto flex-col items-start gap-1 whitespace-normal px-3 py-2.5 text-left",
                active ? "ring-2 ring-primary/40" : "border-border/70"
              )}
            >
              <span className="text-sm font-semibold">{option.label}</span>
              <span
                className={cn(
                  "text-[11px] font-normal",
                  active ? "text-primary-foreground/80" : "text-muted-foreground"
                )}
              >
                {option.hint}
              </span>
            </Button>
          );
        })}
      </div>
    </section>
  );
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
 * One slot's editor: candidates in play order, plus an optional reserve.
 *
 * The gamemode filter and the name query are the card's own state, not the
 * form's. A group round is gamemode-homogeneous per *slot*, so "filter to
 * Control, select the three" is two gestures per card — and a card filtered to
 * Control while its neighbour shows Escort is the whole point of Decision 24.
 */
function SlotCard({
  slot,
  position,
  maps,
  groups,
  disabled,
  onToggleCandidate,
  onSelectVisible,
  onReserveChange
}: {
  slot: MapVetoConfigSlotUpsertInput;
  /** 1-based play order — the position the server derives from list order. */
  position: number;
  maps: MapRead[];
  /** Gamemode buckets over the whole catalogue, so the filter counts are stable. */
  groups: GamemodeGroup[];
  disabled: boolean;
  onToggleCandidate: (mapId: number) => void;
  /** Every map the card currently shows; the caller adds the missing ones. */
  onSelectVisible: (mapIds: number[]) => void;
  onReserveChange: (mapId: number | null) => void;
}) {
  const t = useTranslations();
  const nameFilterId = useId();
  const [gamemodeFilter, setGamemodeFilter] = useState<string>(ALL_FILTER);
  const [nameQuery, setNameQuery] = useState("");

  const slotLabel = t("mapVetoAdmin.slotLabel", { n: position });
  const candidateIndex = new Map(slot.candidates.map((id, index) => [id, index]));

  const inGamemode =
    gamemodeFilter === ALL_FILTER
      ? maps
      : maps.filter((map) => (map.gamemode?.name ?? UNGROUPED_FILTER) === gamemodeFilter);
  const visibleMaps = inGamemode.filter((map) => matchesMapName(map.name, nameQuery));
  const visibleIds = visibleMaps.map((map) => map.id);
  const allVisibleChosen = visibleIds.every((id) => candidateIndex.has(id));

  /**
   * Composition reads the candidates, not the filter: a stray Push map among
   * three Control ones is what the chips exist to show without counting tiles.
   */
  const composition = groups
    .map((group) => ({
      key: group.key,
      gamemode: group.name ?? t("mapVetoAdmin.ungrouped"),
      count: group.maps.reduce((total, map) => (candidateIndex.has(map.id) ? total + 1 : total), 0)
    }))
    .filter((entry) => entry.count > 0);

  /**
   * A slot's reserve must not be one of its own candidates: it would either be
   * banned there and then reinstated as that slot's replay map, or be the
   * survivor, making the replay the very map that drew. Withholding them from
   * the picker beats rejecting the choice afterwards.
   */
  const reserveOptions = maps.filter((map) => !candidateIndex.has(map.id));

  return (
    <div
      role="group"
      aria-label={slotLabel}
      className="space-y-3 rounded-xl border border-border/70 bg-accent/10 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold">{slotLabel}</h4>
          <Badge variant="secondary" className="tabular-nums">
            {t("mapVetoAdmin.slotCandidates", { count: slot.candidates.length })}
          </Badge>
          {composition.map((entry) => (
            <Badge key={entry.key} variant="outline" className="tabular-nums">
              {t("mapVeto.filterOption", { gamemode: entry.gamemode, count: entry.count })}
            </Badge>
          ))}
        </div>
        {/* Present but disabled rather than hidden: it sits in the card header,
            and dropping it mid-save would shift every tile below it. */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || allVisibleChosen}
          onClick={() => onSelectVisible(visibleIds)}
        >
          {t("mapVetoAdmin.poolSelectAll")}
        </Button>
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

      <div className="space-y-1.5">
        <Label htmlFor={nameFilterId} className="text-xs font-medium text-muted-foreground">
          {t("mapVetoAdmin.slotNameFilterLabel", { slot: position })}
        </Label>
        <Input
          id={nameFilterId}
          value={nameQuery}
          onChange={(event) => setNameQuery(event.target.value)}
          placeholder={t("mapVetoAdmin.slotNameFilterPlaceholder")}
          className="h-8 max-w-xs text-xs"
        />
      </div>

      {visibleMaps.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
          {nameQuery.trim() === ""
            ? t("mapVetoAdmin.poolEmpty")
            : t("mapVetoAdmin.slotNameFilterEmpty", { query: nameQuery })}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 md:grid-cols-6">
          {visibleMaps.map((map) => {
            const gamemodeLabel = map.gamemode?.name ?? t("mapVetoAdmin.ungrouped");
            return (
              <MapPoolTile
                key={map.id}
                map={map}
                gamemodeLabel={gamemodeLabel}
                ariaLabel={t("mapVetoAdmin.slotToggleAria", {
                  map: map.name,
                  gamemode: gamemodeLabel,
                  slot: position
                })}
                selectionIndex={candidateIndex.get(map.id) ?? -1}
                disabled={disabled}
                onToggle={() => onToggleCandidate(map.id)}
              />
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={slot.reserve_map_id == null ? RESERVE_NONE : String(slot.reserve_map_id)}
          disabled={disabled}
          onValueChange={(value: string) =>
            onReserveChange(value === RESERVE_NONE ? null : Number(value))
          }
        >
          <SelectTrigger
            aria-label={t("mapVetoAdmin.slotReserveLabel", { slot: position })}
            className="h-8 w-56 text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={RESERVE_NONE}>{t("mapVetoAdmin.slotReserveNone")}</SelectItem>
            {reserveOptions.map((map) => (
              <SelectItem key={map.id} value={String(map.id)}>
                {map.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
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
  bracketFormat,
  onSave,
  onRequestDelete
}: {
  config: MapVetoConfig | null;
  maps: MapRead[];
  canManage: boolean;
  isSaving: boolean;
  saveError?: string;
  scopeLabel: string;
  bracketFormat: BracketFormat;
  onSave: (values: VetoFormValues) => void;
  /** Null when there is nothing to delete or the viewer cannot manage. */
  onRequestDelete: (() => void) | null;
}) {
  const t = useTranslations();
  const turnTimerId = useId();

  const [mapIds, setMapIds] = useState<number[]>(() =>
    config ? [...config.map_ids] : maps.map((map) => map.id)
  );
  /**
   * The organizer's authored steps, kept in state even while the bracket drives
   * the sequence — toggling the mode back restores hand work instead of
   * regenerating over it.
   */
  const [customSequence, setCustomSequence] = useState<VetoSequenceToken[]>(() => {
    if (config && config.sequence.length > 0) return [...config.sequence];
    return buildSequenceForBestOf(
      bracketFormat.bestOf,
      config ? config.map_ids.length : maps.length
    );
  });
  /**
   * Only an explicit `custom` opts a level out of the bracket. A legacy `bo*`
   * label and a NULL preset are both bracket-driven: the server regenerates
   * their steps from `Encounter.best_of`, so the editor must not pretend the
   * stored template is a choice the organizer made.
   */
  const [orderMode, setOrderMode] = useState<VetoOrderMode>(() =>
    config?.preset === "custom" ? "custom" : "bracket"
  );
  const [turnTimerSeconds, setTurnTimerSeconds] = useState<number | null>(() =>
    config ? config.turn_timer_seconds : 30
  );
  const [poolShape, setPoolShape] = useState<MapVetoMode>(() => config?.mode ?? "pool");
  /**
   * One slot per map of the series, as the bracket resolves it for this scope.
   * Not editable: the veto does not decide how long a series is, and the gate
   * above is what keeps this number meaningful.
   */
  const slotCount = bracketFormat.bestOf;
  /**
   * Slot candidates in play order, held across a pool-shape toggle for the same
   * reason `customSequence` survives an order-mode toggle: a mis-click must not
   * discard up to fifteen selections that cannot be undone.
   *
   * Seeded through `position` and written back as list order, because the two
   * spellings differ: the read carries an explicit position per slot while the
   * upsert derives positions 1..N from the array. Converting once, here, is what
   * keeps them from disagreeing.
   *
   * Exactly `slotCount` entries: a shorter stored config gains empty cards to
   * fill, a longer one is cut to what the bracket plays. Either disagreement is
   * named by `slotCountMismatchWarning`, which reads the stored length so it
   * still has both numbers to report.
   */
  const [slotDraft, setSlotDraft] = useState<MapVetoConfigSlotUpsertInput[]>(() => {
    const stored = [...(config?.slots ?? [])]
      .sort((left, right) => left.position - right.position)
      .map((slot) => ({ candidates: [...slot.candidates], reserve_map_id: slot.reserve_map_id }));
    return Array.from(
      { length: slotCount },
      (_, index) => stored[index] ?? { candidates: [], reserve_map_id: null }
    );
  });
  const [firstBanRotation, setFirstBanRotation] = useState<FirstBanRotation>(
    () => config?.first_ban_rotation ?? "fixed"
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

  const selectVisible = () => {
    const missing = visibleMaps
      .filter((map) => !selectionOrder.has(map.id))
      .map((map) => map.id);
    setMapIds((current) => [...current, ...missing]);
  };

  const clearVisible = () => {
    const visible = new Set(visibleMaps.map((map) => map.id));
    setMapIds((current) => current.filter((id) => !visible.has(id)));
  };

  /**
   * One slot, replaced rather than mutated: the draft array identity is what
   * tells React the cards changed.
   */
  const patchSlot = (
    index: number,
    mutate: (slot: MapVetoConfigSlotUpsertInput) => MapVetoConfigSlotUpsertInput
  ) => {
    setSlotDraft((current) => current.map((slot, at) => (at === index ? mutate(slot) : slot)));
  };

  /**
   * `withoutReserveClash` is the other direction of the reserve rule: the picker
   * never offers a candidate, but promoting the current reserve into the
   * candidate list would create the pair the upsert refuses, so it drops.
   */
  const withoutReserveClash = (
    candidates: number[],
    reserveMapId: number | null | undefined
  ): MapVetoConfigSlotUpsertInput => ({
    candidates,
    reserve_map_id:
      reserveMapId != null && candidates.includes(reserveMapId) ? null : reserveMapId ?? null
  });

  const toggleCandidate = (index: number, mapId: number) => {
    patchSlot(index, (slot) =>
      withoutReserveClash(
        slot.candidates.includes(mapId)
          ? slot.candidates.filter((id) => id !== mapId)
          : [...slot.candidates, mapId],
        slot.reserve_map_id
      )
    );
  };

  const selectVisibleInSlot = (index: number, visibleIds: number[]) => {
    patchSlot(index, (slot) =>
      withoutReserveClash(
        [...slot.candidates, ...visibleIds.filter((id) => !slot.candidates.includes(id))],
        slot.reserve_map_id
      )
    );
  };

  const setSlotReserve = (index: number, mapId: number | null) => {
    patchSlot(index, (slot) => ({ ...slot, reserve_map_id: mapId }));
  };

  /** Custom mode only: a generated sequence has no hand-edited counterpart. */
  const patchSequence = (mutate: (steps: VetoSequenceToken[]) => VetoSequenceToken[]) => {
    setCustomSequence((current) => mutate([...current]));
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

  /**
   * In bracket mode the steps are not state: they are regenerated from the
   * scope's series length and the current pool, exactly as the server
   * regenerates them per match.
   */
  const generatedSequence = useMemo(
    () => buildSequenceForBestOf(bracketFormat.bestOf, mapIds.length),
    [bracketFormat.bestOf, mapIds.length]
  );
  const isSlotMode = poolShape === "slots";
  const isCustom = orderMode === "custom";
  const sequence = isCustom ? customSequence : generatedSequence;
  const editable = canManage && isCustom;

  const slotsAvailability = resolveSlotsAvailability(bracketFormat);
  /**
   * A stored slot config keeps the option live even where the gate is shut: its
   * slots already exist, and locking the way back would strand them behind one
   * mis-click on the flat card. What the gate prevents is opting *into* slots
   * where the slot count has no meaning.
   */
  const slotsLocked = !slotsAvailability.available && config?.mode !== "slots";
  /**
   * The stored slot count against what the bracket now plays. Read from the
   * saved config, not from the draft: the draft is already `slotCount` long, so
   * comparing it to `slotCount` could never disagree. A bracket regeneration can
   * change a round's best-of without changing its number, which is how a
   * previously correct config ends up here.
   */
  const storedSlotCount = config?.slots.length ?? 0;
  const slotCountMismatch = storedSlotCount > 0 && storedSlotCount !== slotCount;

  /**
   * Only the lengths the stage editor offers have a translated Bo label; a stage
   * configured to anything else still deserves a readable figure over a missing
   * message key.
   */
  const bestOfLabel = (bestOf: number) => {
    const key = bestOfMessageKey(bestOf);
    return key ? t(key) : `Bo${bestOf}`;
  };

  const mapsPlayed = getMapsPlayedCount(sequence);
  /**
   * A custom order deliberately overrides the bracket, so a disagreement is
   * worth stating but must never block saving. The tournament default has no
   * single expected length to disagree with.
   */
  const mismatch =
    isCustom && bracketFormat.scope !== "tournament" && mapsPlayed !== bracketFormat.bestOf
      ? { played: mapsPlayed, expected: bracketFormat.bestOf }
      : null;

  /**
   * Mode-aware: the two shapes share no rule, so the validator takes the shape
   * rather than a flat pair. Slot mode used to skip validation entirely, which
   * left Save enabled into a draft the upsert rejects.
   */
  const issues: VetoValidationIssue[] = isSlotMode
    ? validateVetoConfigForm({ mode: "slots", slots: slotDraft })
    : validateVetoConfigForm({ mode: "pool", sequence, mapIds });
  const canSave = canManage && issues.length === 0 && !isSaving;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    onSave({
      mode: poolShape,
      mapIds,
      sequence,
      slots: slotDraft,
      // A slot config's steps are derived from its slots, so there is no
      // hand-authored order for `custom` to name and the
      // `ck_map_veto_config_slots_not_custom` CHECK refuses the pair.
      preset: !isSlotMode && isCustom ? "custom" : "bracket",
      firstBanRotation,
      turnTimerSeconds
    });
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
          setMapIds((current) =>
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

          <div className="grid items-start gap-6 sm:grid-cols-2">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">{t("mapVetoAdmin.formatSourceTitle")}</h3>
              {/* Read-only on purpose: a control here would imply the veto sets
                  the series length, which it has not done since the session
                  started rebuilding its steps from `Encounter.best_of`. */}
              <div className="space-y-2 rounded-xl border border-border/70 bg-accent/20 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{t("mapVetoAdmin.formatSourceBracket")}</Badge>
                  <span className="text-sm font-semibold">
                    {bracketFormat.scope === "round"
                      ? t("mapVetoAdmin.formatPerRound", {
                          round: bracketFormat.round,
                          format: bestOfLabel(bracketFormat.bestOf)
                        })
                      : bracketFormat.scope === "tournament"
                        ? t("mapVeto.bracketFormatUnknown")
                        : bracketFormat.perRound
                          ? t("mapVeto.bracketFormatVaries")
                          : t("mapVetoAdmin.formatStageDefault", {
                              format: bestOfLabel(bracketFormat.bestOf)
                            })}
                  </span>
                </div>

                {bracketFormat.scope === "stage" && bracketFormat.perRound ? (
                  <ul className="space-y-0.5 text-xs tabular-nums text-muted-foreground">
                    {bracketFormat.perRound.map((entry) => (
                      <li key={entry.round}>
                        {t("mapVetoAdmin.formatPerRound", {
                          round: entry.round,
                          format: bestOfLabel(entry.bestOf)
                        })}
                      </li>
                    ))}
                    {/* Named separately rather than folded into a round row: the
                        server picks the final from the generated bracket, which
                        this editor cannot see. */}
                    {bracketFormat.finalBestOf != null ? (
                      <li>
                        {t("mapVetoAdmin.formatFinalRound", {
                          format: bestOfLabel(bracketFormat.finalBestOf)
                        })}
                      </li>
                    ) : null}
                  </ul>
                ) : null}

                {bracketFormat.scope === "tournament" ? (
                  <p className="text-xs text-muted-foreground">
                    {t("mapVetoAdmin.formatUnknownScope")}
                  </p>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("mapVetoAdmin.formatSourceHint")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("mapVetoAdmin.formatEditStage")}
              </p>
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

          <div className="space-y-2">
            <ChoiceCardGroup
              title={t("mapVetoAdmin.poolShapeTitle")}
              value={poolShape}
              disabled={!canManage}
              onChange={setPoolShape}
              options={[
                {
                  value: "pool",
                  label: t("mapVetoAdmin.poolShapeFlat"),
                  hint: t("mapVetoAdmin.poolShapeFlatHint")
                },
                {
                  value: "slots",
                  label: t("mapVetoAdmin.poolShapeSlots"),
                  hint: t("mapVetoAdmin.poolShapeSlotsHint"),
                  disabled: slotsLocked
                }
              ]}
            />
            {/* Disabled with its reason, never absent. Silent absence reads as
                "the feature does not exist", and the gate shuts on the very
                stages whose rounds most need a pool per map. */}
            {slotsAvailability.available ? null : (
              <p className="text-xs text-muted-foreground">
                {t(`mapVetoAdmin.${slotsAvailability.reasonKey}`)}
              </p>
            )}
          </div>

          {isSlotMode ? (
            <section className="space-y-4">
              <div className="space-y-0.5">
                <h3 className="text-sm font-semibold">{t("mapVetoAdmin.slotsTitle")}</h3>
                <p className="text-xs text-muted-foreground">
                  {t("mapVetoAdmin.slotsDescription")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("mapVetoAdmin.slotsCountHint", { count: slotDraft.length })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("mapVetoAdmin.slotReserveHint")}
                </p>
              </div>

              {/* The live region has to exist before the warnings do. Both are
                  warnings, not blocks: one shared stage config is legal, and a
                  bracket that changed length is still saveable. */}
              <div aria-live="polite" className="space-y-2">
                {bracketFormat.scope === "stage" ? (
                  <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>
                      {t("mapVetoAdmin.slotsStageScopeWarning", {
                        count: bracketFormat.roundCount
                      })}
                    </span>
                  </div>
                ) : null}
                {slotCountMismatch ? (
                  <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>
                      {t("mapVetoAdmin.slotCountMismatchWarning", {
                        slots: storedSlotCount,
                        maps: slotCount
                      })}
                    </span>
                  </div>
                ) : null}
              </div>

              {/* Two buttons and one shared hint rather than a `ChoiceCardGroup`:
                  `firstBanHint` describes both choices at once, and repeating it
                  under each card would say the same thing twice. */}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{t("mapVetoAdmin.firstBanTitle")}</h3>
                <div
                  role="group"
                  aria-label={t("mapVetoAdmin.firstBanTitle")}
                  className="flex flex-wrap gap-2"
                >
                  {(
                    [
                      ["fixed", t("mapVetoAdmin.firstBanFixed")],
                      ["alternate", t("mapVetoAdmin.firstBanAlternate")]
                    ] as const
                  ).map(([value, label]) => (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant={firstBanRotation === value ? "default" : "outline"}
                      aria-pressed={firstBanRotation === value}
                      disabled={!canManage}
                      onClick={() => setFirstBanRotation(value)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t("mapVetoAdmin.firstBanHint")}</p>
              </section>

              <div className="space-y-4">
                {slotDraft.map((slot, index) => (
                  // Positional identity: slot 1 is always the first card and the
                  // list is never reordered, so the index IS the slot.
                  <SlotCard
                    key={index}
                    slot={slot}
                    position={index + 1}
                    maps={maps}
                    groups={groups}
                    disabled={!canManage || isSaving}
                    onToggleCandidate={(mapId) => toggleCandidate(index, mapId)}
                    onSelectVisible={(visibleIds) => selectVisibleInSlot(index, visibleIds)}
                    onReserveChange={(mapId) => setSlotReserve(index, mapId)}
                  />
                ))}
              </div>
            </section>
          ) : (
            <>
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

              <ChoiceCardGroup
                title={t("mapVetoAdmin.orderModeTitle")}
                value={orderMode}
                disabled={!canManage}
                onChange={setOrderMode}
                options={[
                  {
                    value: "bracket",
                    label: t("mapVetoAdmin.orderModeBracket"),
                    hint: t("mapVetoAdmin.orderModeBracketHint")
                  },
                  {
                    value: "custom",
                    label: t("mapVetoAdmin.orderModeCustom"),
                    hint: t("mapVetoAdmin.orderModeCustomHint")
                  }
                ]}
              />

              <section className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="space-y-0.5">
                    <h3 className="text-sm font-semibold">
                      {isCustom ? t("mapVetoAdmin.sequenceTitle") : t("mapVetoAdmin.previewTitle")}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {isCustom
                        ? t("mapVetoAdmin.sequenceDescription")
                        : mapIds.length === 0
                          ? t("mapVetoAdmin.previewStale")
                          : t("mapVetoAdmin.previewHint", {
                              format: bestOfLabel(bracketFormat.bestOf),
                              count: mapIds.length
                            })}
                    </p>
                  </div>
                  <Badge variant="outline" className="tabular-nums">
                    {t("mapVeto.mapsPlayed", { count: mapsPlayed })}
                  </Badge>
                </div>

                {sequence.length === 0 ? (
                  // A generated sequence is only empty when the pool is, and the
                  // description above already says so.
                  isCustom ? (
                    <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      {t("mapVetoAdmin.sequenceEmpty")}
                    </p>
                  ) : null
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

                          {editable ? (
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
                                  <SelectItem value="ban">
                                    {t("mapVetoAdmin.action.ban")}
                                  </SelectItem>
                                  <SelectItem value="pick">
                                    {t("mapVetoAdmin.action.pick")}
                                  </SelectItem>
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

                {editable ? (
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

                {/* A warning, not a blocker: the live region has to exist before it
                    does, and saving stays allowed because custom wins on purpose. */}
                <div aria-live="polite">
                  {mismatch ? (
                    <div className="space-y-1 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                      <p className="flex items-center gap-2 font-semibold">
                        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                        {t("mapVetoAdmin.mismatchTitle")}
                      </p>
                      <p>{t("mapVetoAdmin.mismatchBody", mismatch)}</p>
                    </div>
                  ) : null}
                </div>
              </section>
            </>
          )}

          {/* The live region has to exist before the issues do. */}
          <div aria-live="polite">
            {issues.length > 0 ? (
              <div className="space-y-1.5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <p className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                  {t("mapVetoAdmin.validationTitle")}
                </p>
                <ul className="list-inside list-disc space-y-0.5">
                  {/* Keyed by position too: slot mode raises the same `key` once
                      per offending slot, so the key alone is not unique. */}
                  {issues.map((issue, index) => (
                    <li key={`${issue.key}:${index}`}>
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

          {!isSlotMode && orderMode === "bracket" ? (
            <p className="text-xs text-muted-foreground">
              {t("mapVetoAdmin.storedFallbackHint")}
            </p>
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
    const isSlotMode = values.mode === "slots";
    upsertMutation.mutate({
      stage_id: levelType === "tournament" ? null : stageId,
      round: levelType === "stage_round" ? round : null,
      // Required, no server-side default: this route replaces the pool
      // wholesale, so a default would let a tab that predates slot mode save a
      // slot config as flat and orphan its slot rows.
      mode: values.mode,
      // Each shape sends its own fields and an empty list for the other's. The
      // route 422s any other combination, naming the field it wants emptied.
      map_ids: isSlotMode ? [] : values.mapIds,
      sequence: isSlotMode ? [] : values.sequence,
      slots: isSlotMode ? values.slots : [],
      // Sent on every save, in both shapes: the route assigns this column
      // unconditionally from a field that defaults to "fixed", so omitting it
      // rewrites an "alternate" config back to "fixed" with no error.
      first_ban_rotation: values.firstBanRotation,
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

  /**
   * Series length for the selected scope, resolved from the stage the bracket
   * generator reads. Derived, never stored on the veto config: the veto has no
   * say in how long a series is.
   */
  const stageBestOfConfig = useMemo(
    () => (activeStage ? parseStageBestOf(activeStage.settings_json) : null),
    [activeStage]
  );
  const isEliminationStage =
    activeStage?.stage_type === "single_elimination" ||
    activeStage?.stage_type === "double_elimination";

  const bracketFormat = useMemo<BracketFormat>(() => {
    if (levelType === "tournament" || activeStage == null || stageBestOfConfig == null) {
      return { scope: "tournament", bestOf: DEFAULT_BEST_OF };
    }
    if (levelType === "stage_round" && round != null) {
      // `isFinal` is an approximation: the server decides it from the max round
      // of the generated encounter set, which the client cannot see.
      return {
        scope: "round",
        round,
        bestOf: resolveBestOf(stageBestOfConfig, round, {
          isFinal: isEliminationStage && round === activeStage.max_rounds
        })
      };
    }
    return {
      scope: "stage",
      bestOf: stageBestOfConfig.default ?? DEFAULT_BEST_OF,
      perRound: hasPerRoundBestOf(stageBestOfConfig)
        ? Array.from({ length: roundCount }, (_, index) => index + 1).map((roundNumber) => ({
            round: roundNumber,
            bestOf: resolveBestOf(stageBestOfConfig, roundNumber)
          }))
        : null,
      finalBestOf: isEliminationStage ? stageBestOfConfig.final ?? null : null,
      roundCount
    };
  }, [levelType, activeStage, stageBestOfConfig, isEliminationStage, round, roundCount]);

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
                            {/* The preset no longer names a format, so the only
                                config-specific fact left worth a badge is that a
                                round opted out of the bracket. */}
                            {roundConfig ? (
                              roundConfig.preset === "custom" ? (
                                <Badge
                                  variant="outline"
                                  className="border-success/60 text-[10px] text-success"
                                >
                                  {t("mapVeto.preset.custom")}
                                </Badge>
                              ) : null
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
          bracketFormat={bracketFormat}
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
