"use client";

import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  LoaderCircle,
  Plus,
  RotateCcw,
  Shield,
  Trash2,
  X
} from "lucide-react";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from "@/components/ui/accordion";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DEFAULT_BEST_OF,
  bestOfMessageKey,
  buildSequenceForBestOf,
  hasPerRoundBestOf,
  parseStageBestOf,
  resolveBestOf
} from "@/lib/best-of";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/notify";
import adminService from "@/services/admin.service";
import mapService from "@/services/map.service";
import type { MapRead } from "@/types/map.types";
import type {
  FirstBanRotation,
  MapVetoConfig,
  MapVetoConfigUpsertInput,
  MapVetoMode,
  Stage,
  VetoSequenceToken
} from "@/types/tournament.types";
import {
  buildToken,
  getMapsPlayedCount,
  getVetoLevelDescriptor,
  matchesMapName,
  seedVetoDraft,
  tokenAction,
  tokenLabelKey,
  tokenSide,
  validateVetoConfigForm,
  vetoDraftsEqual,
  type VetoDraft,
  type VetoDraftSlot,
  type VetoLevelDescriptor,
  type VetoOrderMode,
  type VetoStepAction,
  type VetoStepSide,
  type VetoValidationIssue
} from "./mapVeto.helpers";

/**
 * The two encounter fields the round list reads. A full `Encounter` satisfies it
 * structurally, so the page can hand over the tournament-wide encounters read it
 * already runs for the other hub tabs.
 */
export interface StageRoundSource {
  stage_id: number | null;
  round: number;
}

interface TournamentMapVetoTabProps {
  tournamentId: number;
  stages: Stage[];
  /**
   * Every encounter of the tournament, or undefined while the read is in
   * flight. Undefined is not the same as empty: with no encounters known the
   * list falls back to the planned rounds alone and marks none of them.
   */
  encounters?: StageRoundSource[];
  canManage: boolean;
}

/** One round the organizer can configure, upper or lower. */
interface RoundOption {
  /** Signed: positive is the upper bracket, negative the lower. */
  round: number;
  /**
   * True only when the encounters are known and none of them carries this
   * round — a round `max_rounds` promises that the bracket has not reached.
   */
  notGenerated: boolean;
}

/**
 * Split a stage's configurable rounds into the two brackets (Decision 13).
 *
 * Upper rounds are the union of `1..maxRounds` with every positive round the
 * stage's encounters carry: a regenerated bracket can run past the stored
 * `max_rounds`, and a bracket that has not been generated yet carries nothing.
 * Lower rounds come from the encounters alone — `max_rounds` counts the upper
 * progression and nothing on the client derives how many lower rounds a
 * double-elimination bracket ends up with, so an absent one cannot be planned.
 *
 * Both lists may be gapped: a round number is a value here, never an index.
 */
function buildRoundOptions(
  encounters: StageRoundSource[] | undefined,
  stageId: number,
  maxRounds: number
): { upper: RoundOption[]; lower: RoundOption[] } {
  const existing = new Set<number>();
  for (const encounter of encounters ?? []) {
    // Round 0 belongs to neither bracket and has no label a reader could
    // decode, so it is dropped rather than filed under one of them.
    if (encounter.stage_id === stageId && encounter.round !== 0) existing.add(encounter.round);
  }

  const upper = new Set<number>();
  for (let round = 1; round <= maxRounds; round += 1) upper.add(round);
  const lower: number[] = [];
  for (const round of existing) {
    if (round > 0) upper.add(round);
    else lower.push(round);
  }

  const generationKnown = encounters !== undefined;
  return {
    upper: [...upper]
      .sort((left, right) => left - right)
      .map((round) => ({ round, notGenerated: generationKnown && !existing.has(round) })),
    // -1 before -2: the order the lower bracket plays, not numeric order.
    lower: lower
      .sort((left, right) => right - left)
      .map((round) => ({ round, notGenerated: false }))
  };
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

function groupByGamemode(maps: MapRead[]): GamemodeGroup[] {
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
}

/**
 * Series length for one cascade level, as the bracket defines it.
 *
 * The veto does not own this. The generator resolves
 * `Stage.settings_json.best_of` into `Encounter.best_of`, and the veto session
 * rebuilds its steps from that value unless the config is explicitly custom —
 * so this editor can only report the configured length, never set it.
 *
 * `bestOf` is the representative length: what the generated preview, the slot
 * count and the saved fallback sequence are built for. A single round resolves
 * exactly; a whole stage uses its default; the tournament default spans stages
 * that may each run a different length, so it can only fall back to Bo3.
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

/** Accordion value of the tournament-wide level; also the row open on arrival. */
const TOURNAMENT_SCOPE = "tournament";

/** One configurable cascade level, resolved against the bracket and the configs. */
interface ScopeNode {
  /** Accordion value and draft key; encodes stage and round. */
  key: string;
  stageId: number | null;
  round: number | null;
  /** Row heading: the level's own name, not its path. */
  label: string;
  /** The config sitting exactly on this level — never an inherited one. */
  config: MapVetoConfig | null;
  bracketFormat: BracketFormat;
  /** A round `max_rounds` promises that the bracket has not generated yet. */
  notGenerated: boolean;
}

function scopeKey(stageId: number | null, round: number | null): string {
  if (stageId == null) return TOURNAMENT_SCOPE;
  return round == null ? `stage:${stageId}` : `stage:${stageId}:round:${round}`;
}

/**
 * One exclusive pick, rendered as labelled cards with a hint under each label.
 *
 * Used by the pool shape and by the step order. Design Decision 23 keeps those
 * two separate rather than merging them into one three-way group: slots change
 * what the pool *is* rather than the order of its steps, and
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
    <section className="space-y-2">
      <h4 className="text-sm font-semibold">{title}</h4>
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
                  "text-[11px] font-normal leading-normal",
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
  /** Position in the persisted order, or -1 when unselected. */
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
        "group relative flex h-20 flex-col justify-between overflow-hidden rounded-lg border p-2 text-left transition-colors",
        selected
          ? "border-primary bg-primary/10 ring-2 ring-primary/40"
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

      {/* `span`, not `<Badge>`: this sits inside a `<button>`, which may only
          contain phrasing content, and `Badge` renders a `div`. */}
      <div className="relative z-10 flex items-start justify-between gap-1">
        <span className={cn(badgeVariants({ variant: "outline" }), "bg-background/85")}>
          {gamemodeLabel}
        </span>
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
 * The map catalogue, on demand.
 *
 * The editor used to render this grid inline, once per slot: five slots put
 * sixty tiles, five gamemode filter rows and five search fields on screen at
 * once, for a choice an organizer makes a handful of times. Behind a popover the
 * level's rows stay one line each, and the picker keeps the filters, the
 * name search and the map art it needs to be usable.
 */
function MapPicker({
  groupLabel,
  maps,
  groups,
  selectedIds,
  disabled,
  onToggle,
  onSelectVisible,
  onClearVisible
}: {
  /** Names the picker for assistive technology: "Maps in slot 2", say. */
  groupLabel: string;
  maps: MapRead[];
  /** Gamemode buckets over the whole catalogue, so the filter counts are stable. */
  groups: GamemodeGroup[];
  selectedIds: number[];
  disabled: boolean;
  onToggle: (mapId: number) => void;
  /** Every map the picker currently shows; the caller adds the missing ones. */
  onSelectVisible: (mapIds: number[]) => void;
  onClearVisible: (mapIds: number[]) => void;
}) {
  const t = useTranslations();
  const searchId = useId();
  const [open, setOpen] = useState(false);
  const [gamemodeFilter, setGamemodeFilter] = useState<string>(ALL_FILTER);
  const [query, setQuery] = useState("");

  const inGamemode =
    gamemodeFilter === ALL_FILTER
      ? maps
      : maps.filter((map) => (map.gamemode?.name ?? UNGROUPED_FILTER) === gamemodeFilter);
  const visibleMaps = inGamemode.filter((map) => matchesMapName(map.name, query));
  const visibleIds = visibleMaps.map((map) => map.id);
  const selectionOrder = new Map(selectedIds.map((id, index) => [id, index]));
  const visibleSelectedCount = visibleIds.reduce(
    (total, id) => (selectionOrder.has(id) ? total + 1 : total),
    0
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="h-8 gap-1.5 border-dashed"
        >
          <Plus aria-hidden />
          {t("mapVetoAdmin.addMaps")}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(40rem,calc(100vw-2rem))] p-3"
        // Selecting maps is the whole point of this surface, so it stays open
        // across clicks; Escape and an outside click are the ways out.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById(searchId)?.focus();
        }}
      >
        <div role="group" aria-label={groupLabel} className="space-y-3">
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
            <Label htmlFor={searchId} className="text-xs font-medium text-muted-foreground">
              {t("mapVetoAdmin.pickerSearchLabel")}
            </Label>
            <Input
              id={searchId}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("mapVetoAdmin.pickerSearchPlaceholder")}
              className="h-8 text-base sm:text-xs"
            />
          </div>

          {visibleMaps.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
              {query.trim() === ""
                ? t("mapVetoAdmin.poolEmpty")
                : t("mapVetoAdmin.pickerSearchEmpty", { query })}
            </p>
          ) : (
            <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
              {visibleMaps.map((map) => {
                const gamemodeLabel = map.gamemode?.name ?? t("mapVetoAdmin.ungrouped");
                return (
                  <MapPoolTile
                    key={map.id}
                    map={map}
                    gamemodeLabel={gamemodeLabel}
                    ariaLabel={t("mapVetoAdmin.poolToggleAria", {
                      map: map.name,
                      gamemode: gamemodeLabel
                    })}
                    selectionIndex={selectionOrder.get(map.id) ?? -1}
                    disabled={disabled}
                    onToggle={() => onToggle(map.id)}
                  />
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || visibleSelectedCount === visibleIds.length}
              onClick={() => onSelectVisible(visibleIds)}
            >
              {t("mapVetoAdmin.poolSelectAll")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || visibleSelectedCount === 0}
              onClick={() => onClearVisible(visibleIds)}
            >
              {t("mapVetoAdmin.poolClear")}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One row of chosen maps: the level's pool, or one slot's candidates.
 *
 * Chips read left to right in the stored order, which is the order the pool and
 * the slot candidates are persisted in — so the sequence is the layout rather
 * than a numeric badge the reader has to sort by.
 */
function MapSelectionRow({
  label,
  pickerLabel,
  countBadge,
  maps,
  groups,
  selectedIds,
  disabled,
  describeRemove,
  onToggle,
  onSelectVisible,
  onClearVisible,
  trailing
}: {
  label: string;
  pickerLabel: string;
  countBadge: string;
  maps: MapRead[];
  groups: GamemodeGroup[];
  selectedIds: number[];
  disabled: boolean;
  /** Accessible name for one chip's remove action, in this row's terms. */
  describeRemove: (mapName: string) => string;
  onToggle: (mapId: number) => void;
  onSelectVisible: (mapIds: number[]) => void;
  onClearVisible: (mapIds: number[]) => void;
  /** Row-specific control shown at the trailing edge of the header. */
  trailing?: ReactNode;
}) {
  const t = useTranslations();
  const byId = new Map(maps.map((map) => [map.id, map]));
  const chosen = new Set(selectedIds);

  /**
   * Composition reads the selection, not the filter: a stray Push map among
   * three Control ones is what the chips exist to show without counting tiles.
   */
  const composition = groups
    .map((group) => ({
      key: group.key,
      gamemode: group.name ?? t("mapVetoAdmin.ungrouped"),
      count: group.maps.reduce((total, map) => (chosen.has(map.id) ? total + 1 : total), 0)
    }))
    .filter((entry) => entry.count > 0);

  return (
    <div
      role="group"
      aria-label={label}
      className="space-y-2 rounded-xl border border-border/60 bg-accent/10 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold">{label}</h4>
        <Badge variant="secondary" className="tabular-nums">
          {countBadge}
        </Badge>
        {composition.map((entry) => (
          <Badge key={entry.key} variant="outline" className="tabular-nums">
            {t("mapVetoAdmin.filterOption", { gamemode: entry.gamemode, count: entry.count })}
          </Badge>
        ))}
        {trailing ? <div className="ms-auto">{trailing}</div> : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {selectedIds.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            {t("mapVetoAdmin.selectionEmpty")}
          </span>
        ) : (
          selectedIds.map((id) => {
            const name = byId.get(id)?.name ?? `#${id}`;
            return (
              <button
                key={id}
                type="button"
                disabled={disabled}
                aria-label={describeRemove(name)}
                onClick={() => onToggle(id)}
                className={cn(
                  "group inline-flex h-8 max-w-56 items-center gap-1.5 rounded-full border border-border/70 bg-card pe-2 ps-3 text-xs font-medium transition-colors",
                  disabled ? "cursor-not-allowed opacity-60" : "hover:border-destructive/60"
                )}
              >
                <span className="truncate">{name}</span>
                <X
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-destructive"
                />
              </button>
            );
          })
        )}
        <MapPicker
          groupLabel={pickerLabel}
          maps={maps}
          groups={groups}
          selectedIds={selectedIds}
          disabled={disabled}
          onToggle={onToggle}
          onSelectVisible={onSelectVisible}
          onClearVisible={onClearVisible}
        />
      </div>
    </div>
  );
}

/**
 * The hand-authored step list. Only reachable in flat mode with the custom order
 * chosen; a bracket-driven level shows the same list read-only as a preview.
 */
function SequenceEditor({
  sequence,
  editable,
  onChange
}: {
  sequence: VetoSequenceToken[];
  editable: boolean;
  onChange: (mutate: (steps: VetoSequenceToken[]) => VetoSequenceToken[]) => void;
}) {
  const t = useTranslations();

  const moveStep = (index: number, direction: -1 | 1) => {
    onChange((steps) => {
      const target = index + direction;
      if (target < 0 || target >= steps.length) return steps;
      const [step] = steps.splice(index, 1);
      steps.splice(target, 0, step);
      return steps;
    });
  };

  return (
    <ol className="space-y-2">
      {sequence.map((token, index) => {
        const action = tokenAction(token);
        const side = tokenSide(token);
        const step = index + 1;
        return (
          <li
            key={index}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-card p-2"
          >
            <span
              aria-hidden
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums"
            >
              {step}
            </span>
            <span className="sr-only">{t("mapVetoAdmin.sequenceStep", { n: step })}</span>

            {editable ? (
              <>
                <Select
                  value={action}
                  onValueChange={(value: string) =>
                    onChange((steps) => {
                      steps[index] = buildToken(value as VetoStepAction, side ?? "first");
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
                    <SelectItem value="decider">{t("mapVetoAdmin.action.decider")}</SelectItem>
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
                      onChange((steps) => {
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
                      <SelectItem value="first">{t("mapVetoAdmin.side.first")}</SelectItem>
                      <SelectItem value="second">{t("mapVetoAdmin.side.second")}</SelectItem>
                    </SelectContent>
                  </Select>
                )}

                <div className="ms-auto flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={t("mapVetoAdmin.moveStepUp", { n: step })}
                    disabled={index === 0}
                    onClick={() => moveStep(index, -1)}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={t("mapVetoAdmin.moveStepDown", { n: step })}
                    disabled={index === sequence.length - 1}
                    onClick={() => moveStep(index, 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-destructive"
                    aria-label={t("mapVetoAdmin.removeStep", { n: step })}
                    onClick={() =>
                      onChange((steps) => {
                        steps.splice(index, 1);
                        return steps;
                      })
                    }
                  >
                    <X aria-hidden />
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
  );
}

/** What one level's editor hands back on save; the tab adds the scope columns. */
interface ScopeSavePayload {
  draft: VetoDraft;
  /** Resolved here rather than in the tab: only the editor knows the shown steps. */
  sequence: VetoSequenceToken[];
}

/**
 * One cascade level's editor, rendered inside that level's row.
 *
 * Fully controlled: the draft lives in the tab, so collapsing the row — which
 * unmounts this component — never discards work.
 */
function ScopeEditor({
  scope,
  draft,
  maps,
  groups,
  canManage,
  isSaving,
  saveError,
  /* isDirty is not passed: `onReset` is null exactly when nothing has changed. */
  onChange,
  onSave,
  onReset,
  onRequestDelete
}: {
  scope: ScopeNode;
  draft: VetoDraft;
  maps: MapRead[];
  groups: GamemodeGroup[];
  canManage: boolean;
  isSaving: boolean;
  saveError?: string;
  onChange: (next: VetoDraft) => void;
  onSave: (payload: ScopeSavePayload) => void;
  /** Null when the level has no unsaved changes to discard. */
  onReset: (() => void) | null;
  /** Null when there is nothing to delete or the viewer cannot manage. */
  onRequestDelete: (() => void) | null;
}) {
  const t = useTranslations();
  const turnTimerId = useId();
  const { bracketFormat, config } = scope;
  // A hand-authored order is the one setting an organizer must not have to go
  // looking for, so a level that carries one opens with the panel already down.
  const [advancedOpen, setAdvancedOpen] = useState(() => draft.orderMode === "custom");

  const patch = (next: Partial<VetoDraft>) => onChange({ ...draft, ...next });

  const isSlotMode = draft.mode === "slots";
  const isCustom = draft.orderMode === "custom";
  /**
   * In bracket mode the steps are not draft state: they are regenerated from the
   * scope's series length and the current pool, exactly as the server
   * regenerates them per match.
   */
  const generatedSequence = useMemo(
    () => buildSequenceForBestOf(bracketFormat.bestOf, draft.mapIds.length),
    [bracketFormat.bestOf, draft.mapIds.length]
  );
  const sequence = isCustom ? draft.sequence : generatedSequence;
  const editable = canManage && isCustom;
  const disabled = !canManage || isSaving;

  const slotsAvailability = resolveSlotsAvailability(bracketFormat);
  /**
   * A stored slot config keeps the option live even where the gate is shut: its
   * slots already exist, and locking the way back would strand them behind one
   * mis-click on the flat shape. What the gate prevents is opting *into* slots
   * where the slot count has no meaning.
   */
  const slotsLocked = !slotsAvailability.available && config?.mode !== "slots";
  /**
   * The stored slot count against what the bracket now plays. Read from the
   * saved config, not from the draft: the draft is already `bestOf` long. A
   * bracket regeneration can change a round's best-of without changing its
   * number, which is how a previously correct config ends up here.
   */
  const storedSlotCount = config?.slots.length ?? 0;
  const slotCountMismatch = storedSlotCount > 0 && storedSlotCount !== draft.slots.length;

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
   * rather than a flat pair.
   */
  const issues: VetoValidationIssue[] = isSlotMode
    ? validateVetoConfigForm({ mode: "slots", slots: draft.slots })
    : validateVetoConfigForm({ mode: "pool", sequence, mapIds: draft.mapIds });
  const canSave = canManage && issues.length === 0 && !isSaving;

  const patchSlot = (index: number, mutate: (slot: VetoDraftSlot) => VetoDraftSlot) => {
    patch({ slots: draft.slots.map((slot, at) => (at === index ? mutate(slot) : slot)) });
  };

  /**
   * The other direction of the reserve rule: the picker never offers a
   * candidate, but promoting the current reserve into the candidate list would
   * create the pair the upsert refuses, so it drops.
   */
  const withoutReserveClash = (
    candidates: number[],
    reserveMapId: number | null
  ): VetoDraftSlot => ({
    candidates,
    reserve_map_id:
      reserveMapId != null && candidates.includes(reserveMapId) ? null : reserveMapId
  });

  const toggleIn = (current: number[], mapId: number) =>
    current.includes(mapId) ? current.filter((id) => id !== mapId) : [...current, mapId];

  const addMissing = (current: number[], ids: number[]) => [
    ...current,
    ...ids.filter((id) => !current.includes(id))
  ];

  const removeAll = (current: number[], ids: number[]) => {
    const dropped = new Set(ids);
    return current.filter((id) => !dropped.has(id));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    onSave({ draft, sequence });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 px-3 pb-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <Badge variant={config ? "default" : "secondary"}>
          {config ? t("mapVetoAdmin.levelExisting") : t("mapVetoAdmin.levelNew")}
        </Badge>
        {/* Read-only on purpose: a control here would imply the veto sets the
            series length, which it has not done since the session started
            rebuilding its steps from `Encounter.best_of`. */}
        <span>{t("mapVetoAdmin.formatSourceBracket")}</span>
        <span aria-hidden>·</span>
        <span>{t("mapVetoAdmin.formatEditStage")}</span>
      </div>

      {!canManage ? (
        <p className="rounded-xl border border-border/70 bg-accent/30 p-3 text-sm text-muted-foreground">
          {t("mapVetoAdmin.readOnly")}
        </p>
      ) : null}

      <div className="space-y-2">
        <ChoiceCardGroup
          title={t("mapVetoAdmin.poolShapeTitle")}
          value={draft.mode}
          disabled={!canManage}
          onChange={(mode: MapVetoMode) => patch({ mode })}
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
        {/* Disabled with its reason, never absent. Silent absence reads as "the
            feature does not exist", and the gate shuts on the very stages whose
            rounds most need a pool per map. */}
        {slotsAvailability.available ? null : (
          <p className="text-xs text-muted-foreground">
            {t(`mapVetoAdmin.${slotsAvailability.reasonKey}`)}
          </p>
        )}
      </div>

      {isSlotMode ? (
        <section className="space-y-3">
          <div className="space-y-0.5">
            <h4 className="text-sm font-semibold">{t("mapVetoAdmin.slotsTitle")}</h4>
            <p className="text-xs leading-normal text-muted-foreground">
              {t("mapVetoAdmin.slotsDescription")}
            </p>
            {/* The slot count itself is not stated in prose: there is one row
                per map with no control to add another, and the row carries the
                bracket's Bo badge, so a sentence repeating it is noise. */}
            <p className="text-xs leading-normal text-muted-foreground">
              {t("mapVetoAdmin.slotReserveHint")}
            </p>
          </div>

          {/* The live region has to exist before the warnings do. Both are
              warnings, not blocks: one shared stage config is legal, and a
              bracket that changed length is still saveable. */}
          <div aria-live="polite" className="space-y-2">
            {bracketFormat.scope === "stage" ? (
              <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {t("mapVetoAdmin.slotsStageScopeWarning", { count: bracketFormat.roundCount })}
                </span>
              </div>
            ) : null}
            {slotCountMismatch ? (
              <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {t("mapVetoAdmin.slotCountMismatchWarning", {
                    slots: storedSlotCount,
                    maps: draft.slots.length
                  })}
                </span>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            {draft.slots.map((slot, index) => {
              const position = index + 1;
              const slotLabel = t("mapVetoAdmin.slotLabel", { n: position });
              /**
               * A slot's reserve must not be one of its own candidates: it would
               * either be banned there and then reinstated as that slot's replay
               * map, or be the survivor, making the replay the very map that
               * drew. Withholding them from the picker beats rejecting the
               * choice afterwards.
               */
              const reserveOptions = maps.filter((map) => !slot.candidates.includes(map.id));
              return (
                // Positional identity: slot 1 is always the first row and the
                // list is never reordered, so the index IS the slot.
                <MapSelectionRow
                  key={index}
                  label={slotLabel}
                  pickerLabel={t("mapVetoAdmin.slotPickerLabel", { slot: position })}
                  countBadge={t("mapVetoAdmin.slotCandidates", { count: slot.candidates.length })}
                  maps={maps}
                  groups={groups}
                  selectedIds={slot.candidates}
                  disabled={disabled}
                  describeRemove={(map) =>
                    t("mapVetoAdmin.slotChipRemove", { map, slot: position })
                  }
                  onToggle={(mapId) =>
                    patchSlot(index, (current) =>
                      withoutReserveClash(
                        toggleIn(current.candidates, mapId),
                        current.reserve_map_id
                      )
                    )
                  }
                  onSelectVisible={(ids) =>
                    patchSlot(index, (current) =>
                      withoutReserveClash(
                        addMissing(current.candidates, ids),
                        current.reserve_map_id
                      )
                    )
                  }
                  onClearVisible={(ids) =>
                    patchSlot(index, (current) => ({
                      ...current,
                      candidates: removeAll(current.candidates, ids)
                    }))
                  }
                  trailing={
                    <Select
                      value={slot.reserve_map_id == null ? RESERVE_NONE : String(slot.reserve_map_id)}
                      disabled={disabled}
                      onValueChange={(value: string) =>
                        patchSlot(index, (current) => ({
                          ...current,
                          reserve_map_id: value === RESERVE_NONE ? null : Number(value)
                        }))
                      }
                    >
                      <SelectTrigger
                        aria-label={t("mapVetoAdmin.slotReserveLabel", { slot: position })}
                        className="h-8 w-48 text-xs"
                      >
                        {/* A bare map name in a trailing select reads as an
                            unexplained value; the prefix says what it is. */}
                        <span className="shrink-0 text-muted-foreground">
                          {t("mapVetoAdmin.slotReserveShort")}
                        </span>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={RESERVE_NONE}>
                          {t("mapVetoAdmin.slotReserveNone")}
                        </SelectItem>
                        {reserveOptions.map((map) => (
                          <SelectItem key={map.id} value={String(map.id)}>
                            {map.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  }
                />
              );
            })}
          </div>
        </section>
      ) : (
        <section className="space-y-2">
          <p className="text-xs leading-normal text-muted-foreground">
            {t("mapVetoAdmin.poolDescription")}
          </p>
          <MapSelectionRow
            label={t("mapVetoAdmin.poolTitle")}
            pickerLabel={t("mapVetoAdmin.poolPickerLabel")}
            countBadge={t("mapVetoAdmin.poolSelected", { count: draft.mapIds.length })}
            maps={maps}
            groups={groups}
            selectedIds={draft.mapIds}
            disabled={disabled}
            describeRemove={(map) => t("mapVetoAdmin.poolChipRemove", { map })}
            onToggle={(mapId) => patch({ mapIds: toggleIn(draft.mapIds, mapId) })}
            onSelectVisible={(ids) => patch({ mapIds: addMissing(draft.mapIds, ids) })}
            onClearVisible={(ids) => patch({ mapIds: removeAll(draft.mapIds, ids) })}
          />
        </section>
      )}

      {/* A warning, not a blocker: the live region has to exist before it does,
          and saving stays allowed because a custom order wins on purpose. */}
      <div aria-live="polite">
        {mismatch ? (
          <div className="space-y-1 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            <p className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              {t("mapVetoAdmin.mismatchTitle")}
            </p>
            <p>{t("mapVetoAdmin.mismatchBody", mismatch)}</p>
          </div>
        ) : null}
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="gap-1.5 px-2">
            {/* Chevron, not an arrow: an up/down arrow is the move control in
                the step list below, and one glyph must mean one thing. */}
            <ChevronDown
              aria-hidden
              className={cn("transition-transform", advancedOpen && "rotate-180")}
            />
            {t("mapVetoAdmin.advancedTitle")}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-6 pt-4">
          <div className="space-y-2">
            <Label htmlFor={turnTimerId} className="text-sm font-semibold">
              {t("mapVetoAdmin.turnTimerLabel")}
            </Label>
            <div className="flex items-center gap-2">
              <NumberInput
                id={turnTimerId}
                value={draft.turnTimerSeconds}
                onValueChange={(turnTimerSeconds) => patch({ turnTimerSeconds })}
                min={1}
                integer
                disabled={!canManage}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">
                {t("mapVetoAdmin.turnTimerUnit")}
              </span>
            </div>
            <p className="text-xs leading-normal text-muted-foreground">
              {t("mapVetoAdmin.turnTimerHint")}
            </p>
          </div>

          {isSlotMode ? (
            /* Two buttons and one shared hint rather than a `ChoiceCardGroup`:
               `firstBanHint` describes both choices at once, and repeating it
               under each card would say the same thing twice. */
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">{t("mapVetoAdmin.firstBanTitle")}</h4>
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
                    variant={draft.firstBanRotation === value ? "default" : "outline"}
                    aria-pressed={draft.firstBanRotation === value}
                    disabled={!canManage}
                    onClick={() => patch({ firstBanRotation: value as FirstBanRotation })}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <p className="text-xs leading-normal text-muted-foreground">
                {t("mapVetoAdmin.firstBanHint")}
              </p>
            </section>
          ) : (
            <>
              <ChoiceCardGroup
                title={t("mapVetoAdmin.orderModeTitle")}
                value={draft.orderMode}
                disabled={!canManage}
                onChange={(orderMode: VetoOrderMode) => patch({ orderMode })}
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

              <section className="space-y-2">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="space-y-0.5">
                    <h4 className="text-sm font-semibold">
                      {isCustom
                        ? t("mapVetoAdmin.sequenceTitle")
                        : t("mapVetoAdmin.previewTitle")}
                    </h4>
                    <p className="text-xs leading-normal text-muted-foreground">
                      {isCustom
                        ? t("mapVetoAdmin.sequenceDescription")
                        : draft.mapIds.length === 0
                          ? t("mapVetoAdmin.previewStale")
                          : t("mapVetoAdmin.previewHint", {
                              format: bestOfLabel(bracketFormat.bestOf),
                              count: draft.mapIds.length
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
                    <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                      {t("mapVetoAdmin.sequenceEmpty")}
                    </p>
                  ) : null
                ) : (
                  <SequenceEditor
                    sequence={sequence}
                    editable={editable}
                    onChange={(mutate) => patch({ sequence: mutate([...draft.sequence]) })}
                  />
                )}

                {editable ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => patch({ sequence: [...draft.sequence, "ban_first"] })}
                    className="gap-1.5"
                  >
                    <Plus aria-hidden />
                    {t("mapVetoAdmin.addStep")}
                  </Button>
                ) : (
                  <p className="text-xs leading-normal text-muted-foreground">
                    {t("mapVetoAdmin.storedFallbackHint")}
                  </p>
                )}
              </section>
            </>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* The live region has to exist before the issues do. */}
      <div aria-live="polite">
        {issues.length > 0 ? (
          <div className="space-y-1.5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <p className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              {t("mapVetoAdmin.validationTitle")}
            </p>
            <ul className="list-inside list-disc space-y-0.5">
              {/* Keyed by position too: slot mode raises the same `key` once per
                  offending slot, so the key alone is not unique. */}
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
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t("mapVetoAdmin.saveError", { message: saveError })}</span>
        </div>
      ) : null}

      {canManage ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          {onRequestDelete ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRequestDelete}
              className="gap-1.5 text-destructive hover:text-destructive"
            >
              <Trash2 aria-hidden />
              {t("mapVetoAdmin.deleteLevel")}
            </Button>
          ) : null}
          <div className="ms-auto flex items-center gap-2">
            {onReset ? (
              <Button type="button" variant="ghost" size="sm" onClick={onReset} className="gap-1.5">
                <RotateCcw aria-hidden />
                {t("mapVetoAdmin.reset")}
              </Button>
            ) : null}
            <Button type="submit" disabled={!canSave} className="gap-2">
              {isSaving ? (
                <>
                  <LoaderCircle className="animate-spin" aria-hidden />
                  {t("mapVetoAdmin.saving")}
                </>
              ) : (
                t("mapVetoAdmin.save")
              )}
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

export function TournamentMapVetoTab({
  tournamentId,
  stages,
  encounters,
  canManage
}: TournamentMapVetoTabProps) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const configsQueryKey = ["admin", "tournament", tournamentId, "veto-configs"] as const;

  /** One level open at a time: twelve editors on screen is the old wall again. */
  const [openScope, setOpenScope] = useState<string>(TOURNAMENT_SCOPE);
  /**
   * Edits in progress, by scope key. Held here rather than in the editor so a
   * collapsed row keeps its work, and so the absence of an entry means "this
   * level is exactly as saved" — which is what lets the seed be re-derived on
   * every render without ever clobbering an edit.
   */
  const [drafts, setDrafts] = useState<Record<string, VetoDraft>>({});
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
  const catalogueIds = useMemo(() => maps.map((map) => map.id), [maps]);
  const groups = useMemo(() => groupByGamemode(maps), [maps]);
  const configs = useMemo(() => configsQuery.data?.configs ?? [], [configsQuery.data]);
  const stagesById = useMemo(() => new Map(stages.map((stage) => [stage.id, stage])), [stages]);
  const sortedStages = useMemo(
    () => [...stages].sort((left, right) => left.order - right.order),
    [stages]
  );

  const describeScope = (descriptor: VetoLevelDescriptor): string => {
    if (descriptor.kind === "tournament") return t("mapVeto.scope.tournamentDefault");
    const stage =
      descriptor.stageName ?? t("mapVeto.scope.unknownStage", { id: descriptor.stageId });
    if (descriptor.kind === "stage") return t("mapVeto.scope.stage", { stage });
    return t("mapVeto.scope.stageRound", { stage, round: descriptor.round });
  };

  const dropDraft = (key: string) => {
    setDrafts((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const upsertMutation = useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: ({ data }: { key: string; data: MapVetoConfigUpsertInput }) =>
      adminService.upsertVetoConfig(tournamentId, data),
    onSuccess: async (_result, variables) => {
      // The draft is dropped only once the refetched config can take its place,
      // so the row never flashes back to the pre-save values in between.
      await queryClient.invalidateQueries({ queryKey: configsQueryKey });
      dropDraft(variables.key);
      notify.success(t("mapVetoAdmin.saved"));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: ({ configId }: { key: string; configId: number }) =>
      adminService.deleteVetoConfig(configId),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: configsQueryKey });
      // The level now inherits, so its draft describes a config that no longer
      // exists; keeping it would re-save what was just deleted.
      dropDraft(variables.key);
      setConfigPendingDelete(null);
      notify.success(t("mapVetoAdmin.deleted"));
    }
  });

  const savingKey = upsertMutation.isPending ? upsertMutation.variables?.key ?? null : null;
  const failedKey = upsertMutation.isError ? upsertMutation.variables?.key ?? null : null;

  /**
   * Series length for one level, resolved from the stage the bracket generator
   * reads. Derived, never stored on the veto config: the veto has no say in how
   * long a series is.
   */
  const resolveBracketFormat = (stage: Stage | null, round: number | null): BracketFormat => {
    if (stage == null) return { scope: "tournament", bestOf: DEFAULT_BEST_OF };
    const stageBestOf = parseStageBestOf(stage.settings_json);
    const roundCount = stage.max_rounds > 0 ? stage.max_rounds : 0;
    const isElimination =
      stage.stage_type === "single_elimination" || stage.stage_type === "double_elimination";
    if (round != null) {
      // `isFinal` is an approximation: the server decides it from the max round
      // of the generated encounter set, which the client cannot see.
      return {
        scope: "round",
        round,
        bestOf: resolveBestOf(stageBestOf, round, {
          isFinal: isElimination && round === stage.max_rounds
        })
      };
    }
    return {
      scope: "stage",
      bestOf: stageBestOf.default ?? DEFAULT_BEST_OF,
      perRound: hasPerRoundBestOf(stageBestOf)
        ? Array.from({ length: roundCount }, (_, index) => index + 1).map((roundNumber) => ({
            round: roundNumber,
            bestOf: resolveBestOf(stageBestOf, roundNumber)
          }))
        : null,
      finalBestOf: isElimination ? stageBestOf.final ?? null : null,
      roundCount
    };
  };

  const buildScope = (
    stage: Stage | null,
    round: number | null,
    label: string,
    notGenerated = false
  ): ScopeNode => {
    const stageId = stage?.id ?? null;
    return {
      key: scopeKey(stageId, round),
      stageId,
      round,
      label,
      // The config sitting exactly here, never an inherited one: the cascade is
      // resolved server-side at match time, and showing an inherited pool as
      // this level's own is how a level gets saved a copy it never wanted.
      config:
        configs.find(
          (config) => (config.stage_id ?? null) === stageId && (config.round ?? null) === round
        ) ?? null,
      bracketFormat: resolveBracketFormat(stage, round),
      notGenerated
    };
  };

  const roundLabel = (round: number) =>
    round < 0
      ? // The same label the bracket view gives this round, so the two surfaces
        // name it identically.
        t("bracket.lowerRound", { n: String(-round) })
      : t("mapVetoAdmin.roundLabel", { round });

  const bestOfLabel = (bestOf: number) => {
    const key = bestOfMessageKey(bestOf);
    return key ? t(key) : `Bo${bestOf}`;
  };

  const formatBadge = (format: BracketFormat): string => {
    if (format.scope === "tournament") return t("mapVeto.bracketFormatUnknown");
    if (format.scope === "round") return bestOfLabel(format.bestOf);
    return format.perRound ? t("mapVeto.bracketFormatVaries") : bestOfLabel(format.bestOf);
  };

  /**
   * The level's state in its own terms. A slot config reports `map_ids: []` by
   * design — `serialize_veto_config` does, and the upsert 422s anything else —
   * so counting it announced "0 maps in the pool" for a fully configured level.
   *
   * Both numbers for a slot config, not just the slot count: that alone is the
   * same for every level of a given series length, so two empty slots and two
   * full ones would read identically.
   */
  const summarize = (scope: ScopeNode): string => {
    if (!scope.config) {
      return scope.stageId == null
        ? t("mapVetoAdmin.tournamentUnconfigured")
        : t("mapVetoAdmin.roundUsesDefault");
    }
    if (scope.config.mode === "slots") {
      return t("mapVetoAdmin.roundSlotPoolSize", {
        slots: scope.config.slots.length,
        candidates: scope.config.slots.reduce((total, slot) => total + slot.candidates.length, 0)
      });
    }
    return t("mapVetoAdmin.roundPoolSize", { count: scope.config.map_ids.length });
  };

  const handleSave = (scope: ScopeNode, { draft, sequence }: ScopeSavePayload) => {
    const isSlotMode = draft.mode === "slots";
    upsertMutation.mutate({
      key: scope.key,
      data: {
        stage_id: scope.stageId,
        round: scope.round,
        // Required, no server-side default: this route replaces the pool
        // wholesale, so a default would let a tab that predates slot mode save a
        // slot config as flat and orphan its slot rows.
        mode: draft.mode,
        // Each shape sends its own fields and an empty list for the other's. The
        // route 422s any other combination, naming the field it wants emptied.
        map_ids: isSlotMode ? [] : draft.mapIds,
        sequence: isSlotMode ? [] : sequence,
        slots: isSlotMode ? draft.slots : [],
        // Sent on every save, in both shapes: the route assigns this column
        // unconditionally from a field that defaults to "fixed", so omitting it
        // rewrites an "alternate" config back to "fixed" with no error.
        first_ban_rotation: draft.firstBanRotation,
        turn_timer_seconds: draft.turnTimerSeconds,
        // A slot config's steps are derived from its slots, so there is no
        // hand-authored order for `custom` to name and the
        // `ck_map_veto_config_slots_not_custom` CHECK refuses the pair.
        preset: !isSlotMode && draft.orderMode === "custom" ? "custom" : "bracket"
      }
    });
  };

  // Seeding a level happens from its config alone, so no row may render before
  // both the configs and the map catalogue have arrived.
  const dataReady = configsQuery.isSuccess && mapsQuery.isSuccess;

  const renderScopeRow = (scope: ScopeNode) => {
    const seed = seedVetoDraft(scope.config, scope.bracketFormat.bestOf, catalogueIds);
    const draft = drafts[scope.key] ?? seed;
    const isDirty = scope.key in drafts && !vetoDraftsEqual(draft, seed);
    return (
      <AccordionItem
        key={scope.key}
        value={scope.key}
        className="border-b border-border/50 last:border-b-0"
      >
        <AccordionTrigger className="gap-3 rounded-lg px-3 py-2.5 hover:bg-accent/40 hover:no-underline">
          <span className="flex flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 text-start">
            <span className="text-sm font-semibold">{scope.label}</span>
            {/* `span`, not `<Badge>`: an accordion trigger is a `<button>`, and
                `Badge` renders a `div`. */}
            <span className={badgeVariants({ variant: "outline" })}>
              {formatBadge(scope.bracketFormat)}
            </span>
            <span className="text-xs font-normal text-muted-foreground">{summarize(scope)}</span>
            {scope.notGenerated ? (
              <span className="text-xs font-normal text-warning">
                {t("mapVetoAdmin.roundNotGenerated")}
              </span>
            ) : null}
            {isDirty ? (
              <span className="text-xs font-normal text-warning">
                {t("mapVetoAdmin.unsaved")}
              </span>
            ) : null}
            {scope.config ? (
              <>
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-success" />
                <span className="sr-only">{t("mapVetoAdmin.hasOwnConfig")}</span>
              </>
            ) : null}
          </span>
        </AccordionTrigger>
        <AccordionContent className="pt-0">
          <ScopeEditor
            scope={scope}
            draft={draft}
            maps={maps}
            groups={groups}
            canManage={canManage}
            isSaving={savingKey === scope.key}
            saveError={failedKey === scope.key ? upsertMutation.error?.message : undefined}
            onChange={(next) => setDrafts((current) => ({ ...current, [scope.key]: next }))}
            onSave={(payload) => handleSave(scope, payload)}
            onReset={isDirty ? () => dropDraft(scope.key) : null}
            onRequestDelete={
              canManage && scope.config ? () => setConfigPendingDelete(scope.config) : null
            }
          />
        </AccordionContent>
      </AccordionItem>
    );
  };

  const renderRoundGroup = (heading: string | null, options: RoundOption[], stage: Stage) => {
    if (options.length === 0) return null;
    const rows = options.map((option) =>
      renderScopeRow(
        buildScope(stage, option.round, roundLabel(option.round), option.notGenerated)
      )
    );
    // Grouped for assistive technology only where the two brackets have to be
    // told apart; a stage with one bracket would be announced "Upper bracket"
    // for a distinction it does not have.
    return heading ? (
      <div key={heading} role="group" aria-label={heading} className="space-y-1">
        {/* Not a heading: each row below already renders one at `h3`, and a
            same-level heading over them would flatten the outline. The group's
            accessible name carries the same distinction. */}
        <p className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {heading}
        </p>
        {rows}
      </div>
    ) : (
      <div key="rounds" className="space-y-1">
        {rows}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="text-xl font-bold tracking-tight">{t("mapVetoAdmin.title")}</h1>
          <p className="max-w-2xl text-pretty text-sm leading-normal text-muted-foreground">
            {t("mapVetoAdmin.description")}
          </p>
        </div>
        <Badge variant="secondary" className="gap-1 tabular-nums">
          <Shield className="size-3.5" aria-hidden />
          {t("mapVetoAdmin.stats.configured", { count: configs.length })}
        </Badge>
      </div>

      {dataReady ? (
        <Accordion
          type="single"
          collapsible
          value={openScope}
          onValueChange={setOpenScope}
          className="space-y-4"
        >
          {/* No group role: the card holds one row, whose own heading already
              names it, so a wrapper would announce the same words twice. */}
          <Card className="overflow-hidden">
            <CardContent className="p-1.5">
              {renderScopeRow(buildScope(null, null, t("mapVetoAdmin.tournamentDefault")))}
            </CardContent>
          </Card>

          {sortedStages.map((stage) => {
            const format = resolveBracketFormat(stage, null);
            const options = buildRoundOptions(
              encounters,
              stage.id,
              stage.max_rounds > 0 ? stage.max_rounds : 0
            );
            const hasLower = options.lower.length > 0;
            return (
              <Card key={stage.id} role="group" aria-label={stage.name} className="overflow-hidden">
                <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0 border-b border-border/50 py-3">
                  <CardTitle asChild>
                    <h2 className="text-base font-semibold">{stage.name}</h2>
                  </CardTitle>
                  <Badge variant="outline">
                    {formatBadge(format)}
                  </Badge>
                  {format.scope === "stage" && format.finalBestOf != null ? (
                    <span className="text-xs text-muted-foreground">
                      {t("mapVetoAdmin.formatFinalRound", {
                        format: bestOfLabel(format.finalBestOf)
                      })}
                    </span>
                  ) : null}
                </CardHeader>
                <CardContent className="p-1.5">
                  {renderScopeRow(buildScope(stage, null, t("mapVetoAdmin.stageDefaultButton")))}
                  {/* Headings only where they discriminate. A stage with no lower
                      bracket keeps the single unheaded list it has always had. */}
                  {renderRoundGroup(
                    hasLower ? t("mapVetoAdmin.roundGroupUpper") : null,
                    options.upper,
                    stage
                  )}
                  {hasLower
                    ? renderRoundGroup(t("mapVetoAdmin.roundGroupLower"), options.lower, stage)
                    : null}
                </CardContent>
              </Card>
            );
          })}
        </Accordion>
      ) : (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-xl" />
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
            deleteMutation.mutate({
              key: scopeKey(configPendingDelete.stage_id, configPendingDelete.round),
              configId: configPendingDelete.id
            });
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
