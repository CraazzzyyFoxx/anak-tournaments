"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import Image from "next/image";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronsUpDown,
  Clock,
  LoaderCircle,
  Plus,
  RotateCcw,
  Shield,
  Trash2,
  X,
} from "lucide-react";

import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { stageFinalRounds } from "@/components/bracket-view.helpers";
import { useBracketRoundLabel } from "@/hooks/useBracketRoundLabel";
import adminService from "@/services/admin.service";
import heroService from "@/services/hero.service";
import mapService from "@/services/map.service";
import pickBanService from "@/services/pickBan.service";
import type {
  MapVetoMode,
  PickBanConfig,
  PickBanFirstBanRotation,
  PickBanKind,
  PickBanNoRepeatScope,
  PickBanSequenceToken,
  Stage,
} from "@/types/tournament.types";

import {
  ALL_ROUNDS_SCOPE,
  PICK_BAN_MODES,
  PICK_BAN_NO_REPEAT_SCOPES,
  PICK_BAN_ROTATIONS,
  PICK_BAN_STEP_ACTIONS,
  PICK_BAN_STEP_SIDES,
  TOURNAMENT_SCOPE,
  buildStepToken,
  decodeScope,
  effectiveSequence,
  emptyPickBanDraft,
  encodeScope,
  findScopeCollision,
  matchesItemName,
  parseStepToken,
  pickBanDraftFromConfig,
  pickBanDraftToInput,
  protectHasNoStep,
  resolveSeriesLength,
  roundsPlayed,
  stageRoundOptions,
  validatePickBanDraft,
  type PickBanDraft,
  type PickBanOrderMode,
  type PickBanScopeEncounter,
  type PickBanStepAction,
  type PickBanStepSide,
} from "./pickBanConfig.helpers";


interface PickBanConfigsTabProps {
  tournamentId: number;
  /** Every stage of the tournament, for the scope picker. */
  stages: Stage[];
  /**
   * Every encounter of the tournament, or undefined while the read is in
   * flight. Undefined is not the same as empty: with no encounters known the
   * round picker falls back to each stage's planned `max_rounds`, and the
   * series length falls back to the stage's configured default.
   */
  encounters?: PickBanScopeEncounter[];
  canManage: boolean;
}

/** One selectable map or hero, flattened so both catalogues share one picker. */
interface ItemOption {
  id: number;
  name: string;
  /** Game mode for a map, role for a hero. Disambiguates similar names. */
  group: string | null;
  imageSrc: string | null;
}

/** Filter value showing every catalogue row regardless of its group. */
const ALL_GROUPS = "__all__";
/** Bucket for rows with no group, e.g. a map missing its gamemode relation. */
const UNGROUPED_GROUP = "__ungrouped__";

/** One group filter pill: its catalogue value, display label, and row count. */
interface CatalogueGroup {
  key: string;
  /** Null only for the ungrouped bucket; the caller supplies its own label. */
  label: string | null;
  count: number;
}

/** Every group present in `options`, sorted by name with the ungrouped bucket last. */
function groupOptionsByGroup(options: ItemOption[]): CatalogueGroup[] {
  const byKey = new Map<string, CatalogueGroup>();
  for (const option of options) {
    const key = option.group ?? UNGROUPED_GROUP;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      byKey.set(key, { key, label: option.group, count: 1 });
    }
  }
  return [...byKey.values()].sort((left, right) => {
    if (left.label === null) return 1;
    if (right.label === null) return -1;
    return left.label.localeCompare(right.label);
  });
}

/**
 * The group filter row above a picker's search field: game mode for a map,
 * role for a hero. Hidden with nothing to narrow -- a single-group catalogue
 * (or one still loading) has no use for a row of one redundant "All" pill.
 */
function GroupFilterRow({
  label,
  allLabel,
  ungroupedLabel,
  groups,
  total,
  value,
  onChange,
}: {
  /** Accessible name for the filter row, e.g. "Filter by game mode". */
  label: string;
  allLabel: string;
  ungroupedLabel: string;
  groups: CatalogueGroup[];
  total: number;
  value: string;
  onChange: (value: string) => void;
}) {
  if (groups.length <= 1) return null;
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1 border-b p-1.5">
      <Button
        type="button"
        size="sm"
        variant={value === ALL_GROUPS ? "default" : "outline"}
        aria-pressed={value === ALL_GROUPS}
        onClick={() => onChange(ALL_GROUPS)}
        className="h-6 px-2 text-[0.6875rem]"
      >
        {allLabel} ({total})
      </Button>
      {groups.map((group) => (
        <Button
          key={group.key}
          type="button"
          size="sm"
          variant={value === group.key ? "default" : "outline"}
          aria-pressed={value === group.key}
          onClick={() => onChange(group.key)}
          className="h-6 px-2 text-[0.6875rem]"
        >
          {group.label ?? ungroupedLabel} ({group.count})
        </Button>
      ))}
    </div>
  );
}

// ── item pickers ─────────────────────────────────────────────────────────────

/** Selected items, each with the control that removes it. */
function ItemChips({
  itemIds,
  catalogue,
  disabled,
  describeRemove,
  onRemove,
  trailing,
}: {
  itemIds: number[];
  catalogue: Map<number, ItemOption>;
  disabled: boolean;
  /** Accessible name of one chip's remove button, e.g. "Remove Busan". */
  describeRemove: (name: string) => string;
  onRemove: (itemId: number) => void;
  /** Rendered as the row's last item, e.g. the "Add X" picker trigger --
   * flows in the same wrapping row as the chips rather than sitting above
   * or below them. */
  trailing?: ReactNode;
}) {
  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {itemIds.map((itemId, index) => {
        const item = catalogue.get(itemId);
        const name = item?.name ?? `#${itemId}`;
        return (
          <li key={itemId}>
            <span className="flex items-center gap-1.5 rounded-md border bg-card py-1 pe-1 ps-1.5 text-xs">
              {item?.imageSrc ? (
                <Image
                  src={item.imageSrc}
                  alt=""
                  width={16}
                  height={16}
                  className="size-4 shrink-0 rounded-sm object-cover outline outline-black/10 dark:outline-white/10"
                />
              ) : (
                <span aria-hidden className="bg-muted size-4 shrink-0 rounded-sm" />
              )}
              <span className="text-muted-foreground tabular-nums">{index + 1}</span>
              <span className="max-w-40 truncate font-medium">{name}</span>
              {disabled ? null : (
                <button
                  type="button"
                  aria-label={describeRemove(name)}
                  onClick={() => onRemove(itemId)}
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-ring relative flex size-5 items-center justify-center rounded transition-colors after:absolute after:-inset-2 focus-visible:ring-2 focus-visible:outline-none"
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              )}
            </span>
          </li>
        );
      })}
      {trailing ? <li>{trailing}</li> : null}
    </ul>
  );
}

/**
 * One catalogue row: art, name, and the group that disambiguates similar
 * names. Shared by both pickers so a map or hero reads identically wherever it
 * is offered.
 */
function ItemOptionRow({ option, selected }: { option: ItemOption; selected: boolean }) {
  return (
    <>
      {option.imageSrc ? (
        <Image
          src={option.imageSrc}
          alt=""
          width={24}
          height={24}
          className="size-6 shrink-0 rounded-sm object-cover outline outline-black/10 dark:outline-white/10"
        />
      ) : (
        <span aria-hidden className="bg-muted size-6 shrink-0 rounded-sm" />
      )}
      <span className="truncate">{option.name}</span>
      {option.group ? (
        <span className="text-muted-foreground truncate text-xs">{option.group}</span>
      ) : null}
      <Check
        aria-hidden
        className={cn("ms-auto size-4 shrink-0", selected ? "opacity-100" : "opacity-0")}
      />
    </>
  );
}

/** Item art behind a scrim, so a label stays legible whatever the image. */
function ItemArt({ option }: { option: ItemOption }) {
  return (
    <>
      {option.imageSrc ? (
        <span
          aria-hidden
          className="absolute inset-0 bg-cover bg-center opacity-35 transition-opacity group-hover:opacity-55"
          style={{ backgroundImage: `url("${option.imageSrc}")` }}
        />
      ) : (
        <span aria-hidden className="absolute inset-0 bg-muted/40" />
      )}
      {/* Explicit scrim: art luminance varies wildly, so the label cannot rely
          on the image staying dark enough behind it. */}
      <span
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-background via-background/85 to-background/30"
      />
    </>
  );
}

/** One catalogue tile inside the grid picker: art, group badge, name, and a
 * selection-order badge once chosen. */
function ItemPoolTile({
  option,
  ariaLabel,
  selectionIndex,
  disabled,
  onToggle,
}: {
  option: ItemOption;
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
      <ItemArt option={option} />
      {/* `span`, not `<Badge>`: this sits inside a `<button>`, which may only
          contain phrasing content, and `Badge` renders a `div`. */}
      <span className="relative z-10 flex items-start justify-between gap-1">
        {option.group ? (
          <span className={cn(badgeVariants({ variant: "outline" }), "bg-background/85")}>
            {option.group}
          </span>
        ) : (
          <span />
        )}
        {selected ? (
          <span
            aria-hidden
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold tabular-nums text-primary-foreground shadow-xs"
          >
            {selectionIndex + 1}
          </span>
        ) : null}
      </span>
      <span className="relative z-10 truncate text-xs font-semibold text-foreground">
        {option.name}
      </span>
    </button>
  );
}

/**
 * The catalogue, on demand: filter by group, search by name, art tiles to add
 * or remove, bulk actions scoped to what the filter and search show.
 *
 * A cmdk list read the catalogue as names alone; a match a captain would ban
 * or pick sight-unseen deserves to be recognized by its art first, so this
 * mirrors the grid the pre-cutover map veto editor offered instead.
 */
function ItemGridPicker({
  triggerLabel,
  groupLabel,
  searchLabel,
  searchPlaceholder,
  emptyLabel,
  selectAllLabel,
  clearLabel,
  groupFilterLabel,
  groupFilterAllLabel,
  groupFilterUngroupedLabel,
  options,
  selectedIds,
  disabled,
  onToggle,
  onSelectVisible,
  onClearVisible,
}: {
  triggerLabel: string;
  /** Accessible name for the picker's own `role="group"`, e.g. "Add maps". */
  groupLabel: string;
  searchLabel: string;
  searchPlaceholder: string;
  emptyLabel: string;
  selectAllLabel: string;
  clearLabel: string;
  groupFilterLabel: string;
  groupFilterAllLabel: string;
  groupFilterUngroupedLabel: string;
  options: ItemOption[];
  selectedIds: number[];
  disabled: boolean;
  onToggle: (itemId: number) => void;
  /** Every item the filter and search currently show; the caller adds or removes them all. */
  onSelectVisible: (itemIds: number[]) => void;
  onClearVisible: (itemIds: number[]) => void;
}) {
  const searchId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState(ALL_GROUPS);
  const selectionOrder = new Map(selectedIds.map((id, index) => [id, index]));
  const groups = useMemo(() => groupOptionsByGroup(options), [options]);
  const inGroup = useMemo(
    () =>
      groupFilter === ALL_GROUPS
        ? options
        : options.filter((option) => (option.group ?? UNGROUPED_GROUP) === groupFilter),
    [options, groupFilter]
  );
  // Filtered here, not left to a component's default scorer: `matchesItemName`
  // is the same fold the reserve picker and the veto room search use, so a
  // query like a paper regulation's spelling lands the same map everywhere.
  const visibleOptions = useMemo(
    () => inGroup.filter((option) => matchesItemName(option.name, query)),
    [inGroup, query]
  );
  const visibleIds = useMemo(() => visibleOptions.map((option) => option.id), [visibleOptions]);
  const visibleSelectedCount = visibleIds.reduce(
    (total, id) => (selectionOrder.has(id) ? total + 1 : total),
    0
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Reopening should start from the full catalogue, not the last search.
        if (!next) {
          setQuery("");
          setGroupFilter(ALL_GROUPS);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="h-8 gap-1.5 border-dashed"
        >
          <Plus aria-hidden className="size-4" />
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(40rem,calc(100vw-2rem))] p-3"
        // Selecting candidates is the whole point of this surface, so it
        // stays open across clicks; Escape and an outside click are the ways out.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById(searchId)?.focus();
        }}
      >
        <div role="group" aria-label={groupLabel} className="space-y-3">
          <GroupFilterRow
            label={groupFilterLabel}
            allLabel={groupFilterAllLabel}
            ungroupedLabel={groupFilterUngroupedLabel}
            groups={groups}
            total={options.length}
            value={groupFilter}
            onChange={setGroupFilter}
          />

          <div className="space-y-1.5">
            <Label htmlFor={searchId} className="text-muted-foreground text-xs font-medium">
              {searchLabel}
            </Label>
            <Input
              id={searchId}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 text-base sm:text-xs"
            />
          </div>

          {visibleOptions.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-xs">
              {emptyLabel}
            </p>
          ) : (
            <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
              {visibleOptions.map((option) => (
                <ItemPoolTile
                  key={option.id}
                  option={option}
                  ariaLabel={option.name}
                  selectionIndex={selectionOrder.get(option.id) ?? -1}
                  disabled={disabled}
                  onToggle={() => onToggle(option.id)}
                />
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                disabled || visibleIds.length === 0 || visibleSelectedCount === visibleIds.length
              }
              onClick={() => onSelectVisible(visibleIds)}
            >
              {selectAllLabel}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || visibleSelectedCount === 0}
              onClick={() => onClearVisible(visibleIds)}
            >
              {clearLabel}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** One item out of a narrowed catalogue, or none. */
function ItemSingleSelect({
  label,
  prefix,
  value,
  options,
  noneLabel,
  searchPlaceholder,
  emptyLabel,
  groupFilterLabel,
  groupFilterAllLabel,
  groupFilterUngroupedLabel,
  disabled,
  onChange,
}: {
  /** Accessible name for a trigger that shows only a value. */
  label: string;
  prefix: string;
  value: number | null;
  options: ItemOption[];
  noneLabel: string;
  searchPlaceholder: string;
  emptyLabel: string;
  groupFilterLabel: string;
  groupFilterAllLabel: string;
  groupFilterUngroupedLabel: string;
  disabled: boolean;
  onChange: (itemId: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState(ALL_GROUPS);
  const selected = options.find((option) => option.id === value) ?? null;
  const groups = useMemo(() => groupOptionsByGroup(options), [options]);
  const inGroup = useMemo(
    () =>
      groupFilter === ALL_GROUPS
        ? options
        : options.filter((option) => (option.group ?? UNGROUPED_GROUP) === groupFilter),
    [options, groupFilter]
  );
  const visibleOptions = useMemo(
    () => inGroup.filter((option) => matchesItemName(option.name, query)),
    [inGroup, query]
  );

  const choose = (itemId: number | null) => {
    onChange(itemId);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
          setGroupFilter(ALL_GROUPS);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          disabled={disabled}
          className="w-56 justify-between gap-2 font-normal"
        >
          <span className="truncate">
            <span className="text-muted-foreground">{prefix} </span>
            {selected ? selected.name : noneLabel}
          </span>
          <ChevronsUpDown aria-hidden className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command shouldFilter={false}>
          <GroupFilterRow
            label={groupFilterLabel}
            allLabel={groupFilterAllLabel}
            ungroupedLabel={groupFilterUngroupedLabel}
            groups={groups}
            total={options.length}
            value={groupFilter}
            onChange={setGroupFilter}
          />
          <CommandInput value={query} onValueChange={setQuery} placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              <CommandItem value={noneLabel} onSelect={() => choose(null)}>
                <span>{noneLabel}</span>
                <Check
                  aria-hidden
                  className={cn("ms-auto size-4", value == null ? "opacity-100" : "opacity-0")}
                />
              </CommandItem>
              {visibleOptions.map((option) => (
                <CommandItem key={option.id} value={option.name} onSelect={() => choose(option.id)}>
                  <ItemOptionRow option={option} selected={value === option.id} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── step order ───────────────────────────────────────────────────────────────

/** Read-only step chips: the generated order, or a preview of a custom one. */
function SequencePreview({ sequence }: { sequence: PickBanSequenceToken[] }) {
  const t = useTranslations("pickBan.admin");
  if (sequence.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("sequenceEmpty")}</p>;
  }
  return (
    <ol className="flex flex-wrap gap-1.5">
      {sequence.map((token, index) => {
        const step = parseStepToken(token);
        return (
          <li
            key={`${token}-${index}`}
            className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs"
          >
            <span className="text-muted-foreground tabular-nums">{index + 1}</span>
            <span className="font-medium">
              {step.side == null
                ? t("action.decider")
                : `${t(`action.${step.action}`)} · ${t(`side.${step.side}`)}`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The hand-authored step list. Reachable in pool mode with custom order only. */
function StepList({
  sequence,
  allowProtect,
  allowDecider,
  disabled,
  onChange,
}: {
  sequence: PickBanSequenceToken[];
  /** Gates the protect action: the engine ignores it without the toggle. */
  allowProtect: boolean;
  /** False for a hero sequence, whose pool has no survivor to decide on. */
  allowDecider: boolean;
  disabled: boolean;
  onChange: (next: PickBanSequenceToken[]) => void;
}) {
  const t = useTranslations("pickBan.admin");

  const replace = (index: number, token: PickBanSequenceToken) => {
    const next = [...sequence];
    next[index] = token;
    onChange(next);
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= sequence.length) return;
    const next = [...sequence];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const actions: (PickBanStepAction | "decider")[] = [
    ...PICK_BAN_STEP_ACTIONS.filter((action) => action !== "protect" || allowProtect),
    ...(allowDecider ? (["decider"] as const) : []),
  ];

  return (
    <div className="flex flex-col gap-2">
      {sequence.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("sequenceEmpty")}</p>
      ) : null}

      <ol className="flex flex-col gap-2">
        {sequence.map((token, index) => {
          const step = parseStepToken(token);
          const position = index + 1;
          return (
            <li key={index} className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground w-14 shrink-0 text-xs tabular-nums">
                {t("stepNumber", { n: position })}
              </span>

              <Select
                value={step.action}
                disabled={disabled}
                onValueChange={(value) =>
                  replace(
                    index,
                    buildStepToken(
                      value as PickBanStepAction | "decider",
                      step.side ?? "first"
                    )
                  )
                }
              >
                <SelectTrigger className="w-36" aria-label={t("stepActionLabel", { n: position })}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {actions.map((action) => (
                    <SelectItem key={action} value={action}>
                      {t(`action.${action}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {step.side == null ? (
                <span className="text-muted-foreground text-xs">{t("deciderAuto")}</span>
              ) : (
                <Select
                  value={step.side}
                  disabled={disabled}
                  onValueChange={(value) =>
                    replace(index, buildStepToken(step.action, value as PickBanStepSide))
                  }
                >
                  <SelectTrigger className="w-36" aria-label={t("stepSideLabel", { n: position })}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PICK_BAN_STEP_SIDES.map((side) => (
                      <SelectItem key={side} value={side}>
                        {t(`side.${side}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled || index === 0}
                  aria-label={t("stepMoveUp", { n: position })}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp aria-hidden className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled || index === sequence.length - 1}
                  aria-label={t("stepMoveDown", { n: position })}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown aria-hidden className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  aria-label={t("stepRemove", { n: position })}
                  onClick={() => onChange(sequence.filter((_, at) => at !== index))}
                >
                  <X aria-hidden className="size-4" />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={disabled}
        onClick={() => onChange([...sequence, "ban_first"])}
      >
        <Plus aria-hidden className="me-2 size-4" />
        {t("addStep")}
      </Button>
    </div>
  );
}

// ── saved rows ───────────────────────────────────────────────────────────────

function ConfigRow({
  config,
  scopeLabel,
  canManage,
  onEdit,
  onDelete,
}: {
  config: PickBanConfig;
  scopeLabel: string;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("pickBan.admin");
  const poolSize =
    config.mode === "pool"
      ? t("summaryPool", { count: config.item_ids.length })
      : t("summarySlots", {
          slots: config.slots.length,
          candidates: config.slots.reduce((total, slot) => total + slot.candidates.length, 0),
        });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5">
      <span className="font-medium">{scopeLabel}</span>
      <Badge variant="outline">
        {config.mode === "pool" ? t("modePool") : t("modeSlots")}
      </Badge>
      <span className="text-muted-foreground text-sm">{poolSize}</span>
      <span className="text-muted-foreground text-sm">
        {config.preset === "custom" ? t("summaryOrderCustom") : t("summaryOrderBracket")}
      </span>
      <span className="text-muted-foreground flex items-center gap-1 text-sm">
        <Clock aria-hidden className="size-3.5" />
        {config.turn_timer_seconds == null
          ? t("summaryTimerOff")
          : t("summaryTimerOn", { seconds: config.turn_timer_seconds })}
      </span>
      {config.allow_protect ? (
        <Badge variant="secondary" className="gap-1">
          <Shield aria-hidden className="size-3" />
          {t("allowProtect")}
        </Badge>
      ) : null}

      {canManage ? (
        <div className="ms-auto flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onEdit}>
            {t("edit")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={t("deleteConfigAria", { scope: scopeLabel })}
            className="text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 aria-hidden className="size-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ── editor ───────────────────────────────────────────────────────────────────

function ConfigEditor({
  draft,
  configs,
  stages,
  encounters,
  catalogue,
  catalogueLoading,
  isSaving,
  onChange,
  onSave,
  onCancel,
}: {
  draft: PickBanDraft;
  /** Every saved config, to warn before an upsert replaces one. */
  configs: PickBanConfig[];
  stages: Stage[];
  encounters?: PickBanScopeEncounter[];
  catalogue: ItemOption[];
  catalogueLoading: boolean;
  isSaving: boolean;
  onChange: (next: PickBanDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("pickBan.admin");
  const ids = useId();
  const isHero = draft.kind === "hero";

  const catalogueById = useMemo(
    () => new Map(catalogue.map((option) => [option.id, option])),
    [catalogue]
  );
  const sortedStages = useMemo(
    () => [...stages].sort((left, right) => left.order - right.order),
    [stages]
  );
  const generatedRounds = useMemo(
    () => (draft.stageId == null ? [] : stageRoundOptions(draft.stageId, encounters)),
    [draft.stageId, encounters]
  );
  // Elimination round numbering isn't simple enough to guess client-side
  // before the bracket exists (see `stageRoundOptions`), so the server
  // predicts it from the stage's planned team inputs; skipped once the real
  // encounters have arrived, which are always the more authoritative answer.
  const plannedRoundsQuery = useQuery({
    queryKey: ["admin", "stage", draft.stageId, "planned-rounds"],
    queryFn: () => adminService.getStagePlannedRounds(draft.stageId as number),
    enabled: draft.stageId != null && generatedRounds.length === 0,
  });
  const rounds = generatedRounds.length > 0 ? generatedRounds : (plannedRoundsQuery.data ?? []);
  const roundsLoading = draft.stageId != null && generatedRounds.length === 0 && plannedRoundsQuery.isPending;

  // Name each round exactly as the bracket does, so an organizer scoping rules
  // to "Grand Final" recognizes the round they are looking at there.
  const roundLabel = useBracketRoundLabel();
  const finalRounds = useMemo(
    () =>
      stageFinalRounds(
        draft.stageId,
        stages.find((candidate) => candidate.id === draft.stageId)?.stage_type,
        rounds,
        encounters
      ),
    [draft.stageId, encounters, rounds, stages]
  );

  const series = resolveSeriesLength(draft.stageId, draft.round, stages, encounters);
  const sequence = effectiveSequence(draft, series.bestOf);
  const issues = validatePickBanDraft(draft, series.bestOf);
  const collision = findScopeCollision(draft, configs);
  const protectUnused = protectHasNoStep(draft, series.bestOf);
  const slotCountMismatch =
    draft.mode === "slots" && draft.slots.length > 0 && draft.slots.length !== series.bestOf;

  const toggleItem = (itemId: number) =>
    onChange({
      ...draft,
      itemIds: draft.itemIds.includes(itemId)
        ? draft.itemIds.filter((id) => id !== itemId)
        : [...draft.itemIds, itemId],
    });

  const patchSlot = (index: number, patch: Partial<PickBanDraft["slots"][number]>) => {
    const slots = draft.slots.map((slot, at) => (at === index ? { ...slot, ...patch } : slot));
    onChange({ ...draft, slots });
  };

  const itemsLabel = isHero ? t("poolHeroLabel") : t("poolMapLabel");
  const addItemsLabel = isHero ? t("poolAddHeroes") : t("poolAddMaps");
  const searchPlaceholder = isHero ? t("searchHeroes") : t("searchMaps");
  const searchLabel = t("pickerSearchLabel");

  return (
    <div className="mt-2 flex flex-col gap-6 rounded-xl border-2 border-dashed p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-onest text-base font-semibold">
          {draft.configId == null
            ? t(isHero ? "editorNewHero" : "editorNewMap")
            : t(isHero ? "editorEditHero" : "editorEditMap")}
        </h4>
        {catalogueLoading ? (
          <span className="text-muted-foreground flex items-center gap-2 text-xs">
            <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
            {t("catalogueLoading")}
          </span>
        ) : null}
      </div>

      {/* 1 — where it applies */}
      <FieldSet>
        <FieldGroup>
          <div>
            <FieldTitle className="text-sm">{t("scopeSection")}</FieldTitle>
            <FieldDescription>{t("scopeSectionHint")}</FieldDescription>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${ids}-scope`}>{t("scopeLabel")}</FieldLabel>
              <Select
                value={encodeScope(draft.stageId)}
                onValueChange={(value) =>
                  onChange({ ...draft, stageId: decodeScope(value), round: null })
                }
              >
                <SelectTrigger id={`${ids}-scope`} aria-describedby={`${ids}-scope-hint`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TOURNAMENT_SCOPE}>{t("tournamentLevel")}</SelectItem>
                  {sortedStages.map((stage) => (
                    <SelectItem key={stage.id} value={encodeScope(stage.id)}>
                      {stage.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription id={`${ids}-scope-hint`}>{t("scopeHint")}</FieldDescription>
            </Field>

            <Field data-disabled={draft.stageId == null}>
              <FieldLabel htmlFor={`${ids}-round`}>{t("roundLabel")}</FieldLabel>
              <Select
                value={draft.round == null ? ALL_ROUNDS_SCOPE : String(draft.round)}
                disabled={draft.stageId == null || roundsLoading}
                onValueChange={(value) =>
                  onChange({
                    ...draft,
                    round: value === ALL_ROUNDS_SCOPE ? null : Number(value),
                  })
                }
              >
                <SelectTrigger id={`${ids}-round`} aria-describedby={`${ids}-round-hint`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ROUNDS_SCOPE}>{t("roundAll")}</SelectItem>
                  {rounds.map((round) => (
                    <SelectItem key={round} value={String(round)}>
                      {roundLabel(round, finalRounds)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription id={`${ids}-round-hint`}>
                {draft.stageId == null
                  ? t("roundHintDisabled")
                  : roundsLoading
                    ? t("roundHintLoading")
                    : rounds.length === 0
                      ? t("roundHintUnknown")
                      : t("roundHint")}
              </FieldDescription>
            </Field>
          </div>

          {collision ? (
            <Alert>
              <AlertTriangle aria-hidden className="size-4" />
              <AlertDescription>{t("scopeTaken")}</AlertDescription>
            </Alert>
          ) : null}
        </FieldGroup>
      </FieldSet>

      {/* 2 — the pool */}
      <FieldSet>
        <FieldGroup>
          <div>
            <FieldTitle className="text-sm">{t("poolSection")}</FieldTitle>
            <FieldDescription>{t("poolSectionHint")}</FieldDescription>
          </div>

          {/* Half width, matching the paired rows of the other sections: a
              select stretched across the card reads as the section, not a field. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${ids}-mode`}>{t("modeLabel")}</FieldLabel>
              <Select
                value={draft.mode}
                onValueChange={(value) => onChange({ ...draft, mode: value as MapVetoMode })}
              >
                <SelectTrigger id={`${ids}-mode`} aria-describedby={`${ids}-mode-hint`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PICK_BAN_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {mode === "pool" ? t("modePool") : t("modeSlots")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription id={`${ids}-mode-hint`}>
                {draft.mode === "pool" ? t("modePoolHint") : t("modeSlotsHint")}
              </FieldDescription>
            </Field>
          </div>

          {draft.mode === "pool" ? (
            <Field>
              <FieldTitle className="text-sm">
                {itemsLabel}
                <Badge variant="secondary">{t("poolCount", { count: draft.itemIds.length })}</Badge>
              </FieldTitle>
              <FieldDescription>{t("poolHint")}</FieldDescription>
              <ItemChips
                itemIds={draft.itemIds}
                catalogue={catalogueById}
                disabled={false}
                describeRemove={(name) => t("poolRemove", { item: name })}
                onRemove={toggleItem}
                trailing={
                  <ItemGridPicker
                    triggerLabel={addItemsLabel}
                    groupLabel={addItemsLabel}
                    searchLabel={searchLabel}
                    searchPlaceholder={searchPlaceholder}
                    emptyLabel={t("catalogueEmpty")}
                    selectAllLabel={t("poolSelectAllVisible")}
                    clearLabel={t("poolClearVisible")}
                    groupFilterLabel={t("groupFilterLabel")}
                    groupFilterAllLabel={t("groupFilterAll")}
                    groupFilterUngroupedLabel={t("groupFilterUngrouped")}
                    options={catalogue}
                    selectedIds={draft.itemIds}
                    disabled={catalogueLoading}
                    onToggle={toggleItem}
                    onSelectVisible={(itemIds) =>
                      onChange({
                        ...draft,
                        itemIds: [
                          ...draft.itemIds,
                          ...itemIds.filter((id) => !draft.itemIds.includes(id)),
                        ],
                      })
                    }
                    onClearVisible={(itemIds) =>
                      onChange({
                        ...draft,
                        itemIds: draft.itemIds.filter((id) => !itemIds.includes(id)),
                      })
                    }
                  />
                }
              />
            </Field>
          ) : (
            <div className="flex flex-col gap-3">
              {slotCountMismatch ? (
                <Alert>
                  <AlertTriangle aria-hidden className="size-4" />
                  <AlertDescription>
                    {t("slotCountMismatch", { slots: draft.slots.length, maps: series.bestOf })}
                  </AlertDescription>
                </Alert>
              ) : null}

              {draft.slots.map((slot, index) => (
                <div key={index} className="flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <FieldTitle className="text-sm">
                      {t("slotTitle", { n: index + 1 })}
                      <Badge variant="secondary">
                        {t("slotCandidates", { count: slot.candidates.length })}
                      </Badge>
                    </FieldTitle>
                    <div className="flex items-center gap-2">
                      <ItemSingleSelect
                        label={t("slotReserveAria", { n: index + 1 })}
                        prefix={t("slotReserve")}
                        value={slot.reserveItemId}
                        // The server rejects a reserve that is also a candidate,
                        // so it is never offered here.
                        options={catalogue.filter(
                          (option) => !slot.candidates.includes(option.id)
                        )}
                        noneLabel={t("slotReserveNone")}
                        searchPlaceholder={searchPlaceholder}
                        emptyLabel={t("catalogueEmpty")}
                        groupFilterLabel={t("groupFilterLabel")}
                        groupFilterAllLabel={t("groupFilterAll")}
                        groupFilterUngroupedLabel={t("groupFilterUngrouped")}
                        disabled={catalogueLoading}
                        onChange={(itemId) => patchSlot(index, { reserveItemId: itemId })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("slotRemove", { n: index + 1 })}
                        onClick={() =>
                          onChange({
                            ...draft,
                            slots: draft.slots.filter((_, at) => at !== index),
                          })
                        }
                      >
                        <Trash2 aria-hidden className="size-4" />
                      </Button>
                    </div>
                  </div>

                  <ItemChips
                    itemIds={slot.candidates}
                    catalogue={catalogueById}
                    disabled={false}
                    describeRemove={(name) => t("poolRemove", { item: name })}
                    onRemove={(itemId) =>
                      patchSlot(index, {
                        candidates: slot.candidates.filter((id) => id !== itemId),
                      })
                    }
                    trailing={
                      <ItemGridPicker
                        triggerLabel={addItemsLabel}
                        groupLabel={t("slotTitle", { n: index + 1 })}
                        searchLabel={searchLabel}
                        searchPlaceholder={searchPlaceholder}
                        emptyLabel={t("catalogueEmpty")}
                        selectAllLabel={t("poolSelectAllVisible")}
                        clearLabel={t("poolClearVisible")}
                        groupFilterLabel={t("groupFilterLabel")}
                        groupFilterAllLabel={t("groupFilterAll")}
                        groupFilterUngroupedLabel={t("groupFilterUngrouped")}
                        options={catalogue}
                        selectedIds={slot.candidates}
                        disabled={catalogueLoading}
                        onToggle={(itemId) =>
                          patchSlot(index, {
                            candidates: slot.candidates.includes(itemId)
                              ? slot.candidates.filter((id) => id !== itemId)
                              : [...slot.candidates, itemId],
                            // A candidate can no longer be this slot's reserve.
                            reserveItemId:
                              slot.reserveItemId === itemId ? null : slot.reserveItemId,
                          })
                        }
                        onSelectVisible={(itemIds) =>
                          patchSlot(index, {
                            candidates: [
                              ...slot.candidates,
                              ...itemIds.filter((id) => !slot.candidates.includes(id)),
                            ],
                            // The catalogue offered here isn't narrowed like the
                            // reserve picker's is, so a bulk add can catch the
                            // current reserve; drop it rather than leave a
                            // candidate double-booked as its own slot's reserve.
                            reserveItemId:
                              slot.reserveItemId != null && itemIds.includes(slot.reserveItemId)
                                ? null
                                : slot.reserveItemId,
                          })
                        }
                        onClearVisible={(itemIds) =>
                          patchSlot(index, {
                            candidates: slot.candidates.filter((id) => !itemIds.includes(id)),
                          })
                        }
                      />
                    }
                  />
                  <FieldDescription>{t("slotReserveHint")}</FieldDescription>
                </div>
              ))}

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() =>
                  onChange({
                    ...draft,
                    slots: [...draft.slots, { candidates: [], reserveItemId: null }],
                  })
                }
              >
                <Plus aria-hidden className="me-2 size-4" />
                {t("addSlot")}
              </Button>
            </div>
          )}
        </FieldGroup>
      </FieldSet>

      {/* 3 — step order. Slot mode resolves each round on its own; there is no
          series-wide order to author, and the custom preset is unstorable.
          A hero config has no bracket-generated option: its sequence is ONE
          round's steps, replayed per map of the series, while the generator
          answers the map question (ban a pool down to `bestOf` maps) and emits
          picks and a decider a hero round cannot resolve. */}
      {draft.mode === "pool" ? (
        <FieldSet>
          <FieldGroup>
            <div>
              <FieldTitle className="text-sm">{t("orderSection")}</FieldTitle>
              <FieldDescription>{isHero ? t("orderHeroHint") : t("orderSectionHint")}</FieldDescription>
            </div>

            {isHero ? null : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`${ids}-order`}>{t("orderLabel")}</FieldLabel>
                  <Select
                    value={draft.orderMode}
                    onValueChange={(value) =>
                      onChange({
                        ...draft,
                        orderMode: value as PickBanOrderMode,
                        // Authoring starts from the generated order rather than an
                        // empty list, so "custom" is an edit, not a blank page.
                        sequence:
                          value === "custom" && draft.sequence.length === 0
                            ? sequence
                            : draft.sequence,
                      })
                    }
                  >
                    <SelectTrigger id={`${ids}-order`} aria-describedby={`${ids}-order-hint`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bracket">{t("orderBracket")}</SelectItem>
                      <SelectItem value="custom">{t("orderCustom")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldDescription id={`${ids}-order-hint`}>
                    {draft.orderMode === "bracket" ? t("orderBracketHint") : t("orderCustomHint")}
                  </FieldDescription>
                </Field>
              </div>
            )}

            {/* The generated order is a function of the pool, so it says
                nothing until there is one — "0 rounds played" would read as a
                setting rather than a missing prerequisite. */}
            {draft.itemIds.length === 0 ? (
              <FieldDescription>{t("orderNeedsPool")}</FieldDescription>
            ) : (
              <div className="flex flex-col gap-2">
                <FieldTitle className="text-sm">
                  {draft.orderMode === "bracket" ? t("orderPreview") : t("orderSteps")}
                  {/* "Rounds played" counts picks and deciders — the maps a map
                      sequence settles. A hero round plays no map of its own. */}
                  {isHero ? null : (
                    <Badge variant="secondary">
                      {t("orderRoundsPlayed", { count: roundsPlayed(sequence) })}
                    </Badge>
                  )}
                </FieldTitle>
                {draft.orderMode === "bracket" ? (
                  <>
                    <FieldDescription>
                      {t(`seriesSource.${series.source}`, { bestOf: series.bestOf })}
                    </FieldDescription>
                    <SequencePreview sequence={sequence} />
                  </>
                ) : (
                  <>
                    {/* A custom order runs as written, so the scope's series
                        length is only worth raising when the two disagree — and
                        only where the length is exact rather than a preview. */}
                    {!isHero && series.source === "round" && roundsPlayed(sequence) !== series.bestOf ? (
                      <Alert>
                        <AlertTriangle aria-hidden className="size-4" />
                        <AlertDescription>
                          {t("orderCustomMismatch", {
                            played: roundsPlayed(sequence),
                            expected: series.bestOf,
                          })}
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    <StepList
                      sequence={draft.sequence}
                      allowProtect={draft.allowProtect}
                      allowDecider={!isHero}
                      disabled={false}
                      onChange={(next) => onChange({ ...draft, sequence: next })}
                    />
                  </>
                )}
              </div>
            )}
          </FieldGroup>
        </FieldSet>
      ) : null}

      {/* 4 — rules */}
      <FieldSet>
        <FieldGroup>
          <div>
            <FieldTitle className="text-sm">{t("rulesSection")}</FieldTitle>
            <FieldDescription>{t("rulesSectionHint")}</FieldDescription>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${ids}-rotation`}>{t("firstBanRotation")}</FieldLabel>
              <Select
                value={draft.firstBanRotation}
                onValueChange={(value) =>
                  onChange({ ...draft, firstBanRotation: value as PickBanFirstBanRotation })
                }
              >
                <SelectTrigger id={`${ids}-rotation`} aria-describedby={`${ids}-rotation-hint`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PICK_BAN_ROTATIONS.map((rotation) => (
                    <SelectItem key={rotation} value={rotation}>
                      {t(`firstBanRotationValue.${rotation}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription id={`${ids}-rotation-hint`}>
                {t(`firstBanRotationHint.${draft.firstBanRotation}`)}
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor={`${ids}-norepeat`}>{t("noRepeatScope")}</FieldLabel>
              <Select
                value={draft.noRepeatScope}
                onValueChange={(value) =>
                  onChange({ ...draft, noRepeatScope: value as PickBanNoRepeatScope })
                }
              >
                <SelectTrigger id={`${ids}-norepeat`} aria-describedby={`${ids}-norepeat-hint`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PICK_BAN_NO_REPEAT_SCOPES.map((scope) => (
                    <SelectItem key={scope} value={scope}>
                      {t(`noRepeatScopeValue.${scope}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription id={`${ids}-norepeat-hint`}>
                {t(`noRepeatScopeHint.${draft.noRepeatScope}`)}
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor={`${ids}-timer`}>{t("turnTimer")}</FieldLabel>
              <div className="flex items-center gap-2">
                <NumberInput
                  id={`${ids}-timer`}
                  aria-describedby={`${ids}-timer-hint`}
                  min={1}
                  integer
                  placeholder={t("turnTimerPlaceholder")}
                  className="w-28"
                  value={draft.turnTimerSeconds}
                  onValueChange={(value) => onChange({ ...draft, turnTimerSeconds: value })}
                />
                <span className="text-muted-foreground text-sm">{t("turnTimerUnit")}</span>
                {draft.turnTimerSeconds != null ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onChange({ ...draft, turnTimerSeconds: null })}
                  >
                    <RotateCcw aria-hidden className="me-2 size-3.5" />
                    {t("turnTimerClear")}
                  </Button>
                ) : null}
              </div>
              <FieldDescription id={`${ids}-timer-hint`}>{t("turnTimerHint")}</FieldDescription>
            </Field>

            <Field>
              <FieldTitle className="text-sm">{t("firstPickRule")}</FieldTitle>
              {/* One enum member exists server-side, so a control here would be
                  a choice with nothing to choose. Stated instead of offered. */}
              <p className="text-sm font-medium">{t("firstPickRuleValue.higher_seed")}</p>
              <FieldDescription>{t("firstPickRuleHint")}</FieldDescription>
            </Field>
          </div>

          <Field orientation="horizontal">
            <Switch
              id={`${ids}-protect`}
              aria-describedby={`${ids}-protect-hint`}
              checked={draft.allowProtect}
              onCheckedChange={(checked) => onChange({ ...draft, allowProtect: checked })}
            />
            <FieldContent>
              <FieldLabel htmlFor={`${ids}-protect`}>{t("allowProtect")}</FieldLabel>
              <FieldDescription id={`${ids}-protect-hint`}>{t("allowProtectHint")}</FieldDescription>
            </FieldContent>
          </Field>

          {protectUnused ? (
            <Alert>
              <AlertTriangle aria-hidden className="size-4" />
              <AlertDescription>{t("protectWithoutStep")}</AlertDescription>
            </Alert>
          ) : null}

          {isHero ? (
            <Field orientation="horizontal">
              <Switch
                id={`${ids}-role`}
                aria-describedby={`${ids}-role-hint`}
                checked={draft.uniqueRolePerRound}
                onCheckedChange={(checked) => onChange({ ...draft, uniqueRolePerRound: checked })}
              />
              <FieldContent>
                <FieldLabel htmlFor={`${ids}-role`}>{t("uniqueRole")}</FieldLabel>
                <FieldDescription id={`${ids}-role-hint`}>{t("uniqueRoleHint")}</FieldDescription>
              </FieldContent>
            </Field>
          ) : null}
        </FieldGroup>
      </FieldSet>

      {issues.length > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden className="size-4" />
          <AlertDescription>
            <p className="font-medium">{t("validationTitle")}</p>
            <ul className="mt-1 list-inside list-disc">
              {issues.map((issue) => (
                <li key={issue.key}>{t(`validation.${issue.key}`, issue.values)}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={isSaving || issues.length > 0} onClick={onSave}>
          {isSaving ? <LoaderCircle aria-hidden className="me-2 size-4 animate-spin" /> : null}
          {isSaving ? t("saving") : t("save")}
        </Button>
        <Button type="button" variant="ghost" disabled={isSaving} onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}

// ── tab ──────────────────────────────────────────────────────────────────────

/**
 * Admin CRUD for the generic `PickBanConfig` (map + hero kinds).
 *
 * One section per kind, each listing its saved configs and opening its own
 * editor: `kind` comes from the section the organizer started in rather than
 * from a control, so it cannot be changed into another section's upsert key
 * mid-edit. The editor itself is a guided form — see `pickBanConfig.helpers`
 * for the three wire fields it deliberately does not expose raw. Design:
 * docs/plans/2026-08-09-generic-pickban-engine.md.
 */
function KindSection({
  kind,
  configs,
  canManage,
  describeScope,
  isPending,
  addLabel,
  noConfigsHint,
  draft,
  editorProps,
  onAdd,
  onEdit,
  onDelete,
}: {
  kind: PickBanKind;
  configs: PickBanConfig[];
  canManage: boolean;
  describeScope: (config: Pick<PickBanConfig, "stage_id" | "round">) => string;
  isPending: boolean;
  addLabel: string;
  noConfigsHint: string;
  draft: PickBanDraft | null;
  editorProps: Omit<Parameters<typeof ConfigEditor>[0], "draft"> | null;
  onAdd: () => void;
  onEdit: (config: PickBanConfig) => void;
  onDelete: (config: PickBanConfig) => void;
}) {
  const t = useTranslations("pickBan.admin");
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{t(kind === "map" ? "kindMap" : "kindHero")}</CardTitle>
        {canManage ? (
          <Button type="button" size="sm" variant="outline" onClick={onAdd}>
            <Plus aria-hidden className="me-2 size-4" />
            {addLabel}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {isPending ? (
          <>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </>
        ) : configs.length === 0 ? (
          <div className="flex flex-col gap-1 py-2">
            <p className="font-medium">{t("noConfigs")}</p>
            <p className="text-muted-foreground text-sm">{noConfigsHint}</p>
          </div>
        ) : (
          configs.map((config) => (
            <ConfigRow
              key={config.id}
              config={config}
              scopeLabel={describeScope(config)}
              canManage={canManage}
              onEdit={() => onEdit(config)}
              onDelete={() => onDelete(config)}
            />
          ))
        )}

        {draft != null && draft.kind === kind && editorProps != null ? (
          <ConfigEditor draft={draft} {...editorProps} />
        ) : null}
      </CardContent>
    </Card>
  );
}

export function PickBanConfigsTab({
  tournamentId,
  stages,
  encounters,
  canManage,
}: PickBanConfigsTabProps) {
  const t = useTranslations("pickBan.admin");
  const queryClient = useQueryClient();
  const configsQueryKey = ["admin", "tournament", tournamentId, "pick-ban-configs"] as const;

  const configsQuery = useQuery({
    queryKey: configsQueryKey,
    queryFn: () => pickBanService.listConfigs(tournamentId),
  });

  const [draft, setDraft] = useState<PickBanDraft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PickBanConfig | null>(null);

  // Only needed once an editor is open for that kind: one catalogue query per
  // kind, both gated on the currently open draft so an idle tab loads neither.
  const mapsQuery = useQuery({
    queryKey: ["maps", "all", "gamemode"],
    queryFn: () => mapService.getAll({ perPage: -1, sort: "name", order: "asc", entities: ["gamemode"] }),
    enabled: draft?.kind === "map",
  });
  const heroesQuery = useQuery({
    queryKey: ["heroes", "all"],
    queryFn: () => heroService.getAll({ perPage: -1, sort: "name", order: "asc" }),
    enabled: draft?.kind === "hero",
  });

  const catalogue = useMemo<ItemOption[]>(() => {
    if (draft?.kind === "map") {
      // Off-rotation maps (e.g. a retired brawl-only map) are not something
      // an organizer bans or picks in a ranked series; the old veto editor
      // held the same line.
      return (mapsQuery.data?.results ?? [])
        .filter((map) => map.in_competitive !== false)
        .map((map) => ({
          id: map.id,
          name: map.name,
          group: map.gamemode?.name ?? null,
          imageSrc: map.image_path ?? null,
        }));
    }
    return (heroesQuery.data?.results ?? []).map((hero) => ({
      id: hero.id,
      name: hero.name,
      group: hero.type ?? hero.role ?? null,
      imageSrc: hero.image_path ?? null,
    }));
  }, [draft?.kind, mapsQuery.data, heroesQuery.data]);

  const catalogueLoading = draft?.kind === "map" ? mapsQuery.isPending : heroesQuery.isPending;

  const configs = useMemo(() => configsQuery.data?.configs ?? [], [configsQuery.data]);
  const stagesById = useMemo(() => new Map(stages.map((stage) => [stage.id, stage])), [stages]);

  const describeScope = (config: Pick<PickBanConfig, "stage_id" | "round">): string => {
    if (config.stage_id == null) return t("tournamentLevel");
    const stage = stagesById.get(config.stage_id);
    const name = stage?.name ?? t("unknownStage", { id: config.stage_id });
    return config.round == null
      ? t("scopeStage", { stage: name })
      : t("scopeStageRound", { stage: name, round: config.round });
  };

  const upsertMutation = useMutation({
    mutationFn: ({ draft: input, seriesLength }: { draft: PickBanDraft; seriesLength: number }) =>
      pickBanService.upsertConfig(tournamentId, pickBanDraftToInput(input, seriesLength)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: configsQueryKey });
      notify.success(t("saved"));
      setDraft(null);
    },
    onError: (error) => notify.apiError(error, { title: t("saveFailed") }),
  });

  const deleteMutation = useMutation({
    mutationFn: (configId: number) => pickBanService.deleteConfig(configId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: configsQueryKey });
      notify.success(t("deleted"));
      setDeleteTarget(null);
    },
    onError: (error) => notify.apiError(error, { title: t("deleteFailed") }),
  });

  const configsByKind = useMemo(() => {
    const byKind: Record<PickBanKind, PickBanConfig[]> = { map: [], hero: [] };
    for (const config of configs) byKind[config.kind].push(config);
    return byKind;
  }, [configs]);

  const editorProps = {
    configs,
    stages,
    encounters,
    catalogue,
    catalogueLoading,
    isSaving: upsertMutation.isPending,
    onChange: setDraft,
    onSave: () =>
      draft != null &&
      upsertMutation.mutate({
        draft,
        seriesLength: resolveSeriesLength(draft.stageId, draft.round, stages, encounters).bestOf,
      }),
    onCancel: () => setDraft(null),
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h2 className="font-onest text-lg font-semibold">{t("title")}</h2>
        <p className="text-muted-foreground max-w-2xl text-sm">{t("intro")}</p>
        {canManage ? null : <p className="text-muted-foreground text-sm">{t("readOnly")}</p>}
      </div>

      {configsQuery.isError ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden className="size-4" />
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{t("loadFailed")}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => configsQuery.refetch()}>
              {t("retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <KindSection
        kind="map"
        configs={configsByKind.map}
        canManage={canManage}
        describeScope={describeScope}
        isPending={configsQuery.isPending}
        addLabel={t("addMapConfig")}
        noConfigsHint={t("noConfigsMapHint")}
        draft={draft}
        editorProps={editorProps}
        onAdd={() => setDraft(emptyPickBanDraft("map"))}
        onEdit={(config) => setDraft(pickBanDraftFromConfig(config))}
        onDelete={setDeleteTarget}
      />

      <KindSection
        kind="hero"
        configs={configsByKind.hero}
        canManage={canManage}
        describeScope={describeScope}
        isPending={configsQuery.isPending}
        addLabel={t("addHeroConfig")}
        noConfigsHint={t("noConfigsHeroHint")}
        draft={draft}
        editorProps={editorProps}
        onAdd={() => setDraft(emptyPickBanDraft("hero"))}
        onEdit={(config) => setDraft(pickBanDraftFromConfig(config))}
        onDelete={setDeleteTarget}
      />

      <DeleteConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("deleteConfirm")}
        description={
          deleteTarget
            ? t("deleteDescription", { scope: describeScope(deleteTarget) })
            : t("deleteConfirm")
        }
        confirmLabel={t("delete")}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}
