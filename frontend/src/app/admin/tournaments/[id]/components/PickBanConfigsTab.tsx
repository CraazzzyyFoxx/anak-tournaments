"use client";

import { useId, useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
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
import heroService from "@/services/hero.service";
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

// ── item pickers ─────────────────────────────────────────────────────────────

/** Selected items, each with the control that removes it. */
function ItemChips({
  itemIds,
  catalogue,
  disabled,
  describeRemove,
  onRemove,
}: {
  itemIds: number[];
  catalogue: Map<number, ItemOption>;
  disabled: boolean;
  /** Accessible name of one chip's remove button, e.g. "Remove Busan". */
  describeRemove: (name: string) => string;
  onRemove: (itemId: number) => void;
}) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {itemIds.map((itemId, index) => {
        const item = catalogue.get(itemId);
        const name = item?.name ?? `#${itemId}`;
        return (
          <li key={itemId}>
            <span className="flex items-center gap-1.5 rounded-md border bg-card py-1 pe-1 ps-2 text-xs">
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

/** The catalogue, on demand: search by name, toggle to add or remove. */
function ItemMultiSelect({
  triggerLabel,
  searchPlaceholder,
  emptyLabel,
  options,
  selectedIds,
  disabled,
  onToggle,
}: {
  triggerLabel: string;
  searchPlaceholder: string;
  emptyLabel: string;
  options: ItemOption[];
  selectedIds: number[];
  disabled: boolean;
  onToggle: (itemId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = new Set(selectedIds);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          // The surrounding field stretches its children; a picker trigger that
          // spans the whole row reads as a banner rather than a control.
          className="self-start"
        >
          <Plus aria-hidden className="me-2 size-4" />
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.name}
                  // Stays open: picking a pool is a batch of choices, and
                  // reopening the popover per item makes it unusable.
                  onSelect={() => onToggle(option.id)}
                >
                  <ItemOptionRow option={option} selected={selected.has(option.id)} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
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
  disabled: boolean;
  onChange: (itemId: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value) ?? null;

  const choose = (itemId: number | null) => {
    onChange(itemId);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
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
              {options.map((option) => (
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
  disabled,
  onChange,
}: {
  sequence: PickBanSequenceToken[];
  /** Gates the protect action: the engine ignores it without the toggle. */
  allowProtect: boolean;
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
    "decider",
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
  const rounds = useMemo(
    () => (draft.stageId == null ? [] : stageRoundOptions(draft.stageId, stages, encounters)),
    [draft.stageId, stages, encounters]
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
                disabled={draft.stageId == null}
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
                      {t("roundNumber", { n: round })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription id={`${ids}-round-hint`}>
                {draft.stageId == null ? t("roundHintDisabled") : t("roundHint")}
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
              <div className="flex flex-col gap-2">
                <ItemMultiSelect
                  triggerLabel={addItemsLabel}
                  searchPlaceholder={searchPlaceholder}
                  emptyLabel={t("catalogueEmpty")}
                  options={catalogue}
                  selectedIds={draft.itemIds}
                  disabled={catalogueLoading}
                  onToggle={toggleItem}
                />
                {draft.itemIds.length > 0 ? (
                  <ItemChips
                    itemIds={draft.itemIds}
                    catalogue={catalogueById}
                    disabled={false}
                    describeRemove={(name) => t("poolRemove", { item: name })}
                    onRemove={toggleItem}
                  />
                ) : null}
              </div>
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
                  <div className="flex items-center justify-between gap-2">
                    <FieldTitle className="text-sm">
                      {t("slotTitle", { n: index + 1 })}
                      <Badge variant="secondary">
                        {t("slotCandidates", { count: slot.candidates.length })}
                      </Badge>
                    </FieldTitle>
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

                  <ItemMultiSelect
                    triggerLabel={addItemsLabel}
                    searchPlaceholder={searchPlaceholder}
                    emptyLabel={t("catalogueEmpty")}
                    options={catalogue}
                    selectedIds={slot.candidates}
                    disabled={catalogueLoading}
                    onToggle={(itemId) =>
                      patchSlot(index, {
                        candidates: slot.candidates.includes(itemId)
                          ? slot.candidates.filter((id) => id !== itemId)
                          : [...slot.candidates, itemId],
                        // A candidate can no longer be this slot's reserve.
                        reserveItemId: slot.reserveItemId === itemId ? null : slot.reserveItemId,
                      })
                    }
                  />

                  {slot.candidates.length > 0 ? (
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
                    />
                  ) : null}

                  <div className="flex flex-col gap-1.5">
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
                      disabled={catalogueLoading}
                      onChange={(itemId) => patchSlot(index, { reserveItemId: itemId })}
                    />
                    <FieldDescription>{t("slotReserveHint")}</FieldDescription>
                  </div>
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
          series-wide order to author, and the custom preset is unstorable. */}
      {draft.mode === "pool" ? (
        <FieldSet>
          <FieldGroup>
            <div>
              <FieldTitle className="text-sm">{t("orderSection")}</FieldTitle>
              <FieldDescription>{t("orderSectionHint")}</FieldDescription>
            </div>

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

            {/* The generated order is a function of the pool, so it says
                nothing until there is one — "0 rounds played" would read as a
                setting rather than a missing prerequisite. */}
            {draft.itemIds.length === 0 ? (
              <FieldDescription>{t("orderNeedsPool")}</FieldDescription>
            ) : (
              <div className="flex flex-col gap-2">
                <FieldTitle className="text-sm">
                  {draft.orderMode === "bracket" ? t("orderPreview") : t("orderSteps")}
                  <Badge variant="secondary">
                    {t("orderRoundsPlayed", { count: roundsPlayed(sequence) })}
                  </Badge>
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
                    {series.source === "round" && roundsPlayed(sequence) !== series.bestOf ? (
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

  // Only needed once an editor is open. Map pool configuration stays owned by
  // the Map Veto tab (MapVetoConfig) -- this tab only ever creates kind=hero
  // configs, so there is one catalogue to load, not two.
  const heroesQuery = useQuery({
    queryKey: ["heroes", "all"],
    queryFn: () => heroService.getAll({ perPage: -1, sort: "name", order: "asc" }),
    enabled: draft != null,
  });

  const catalogue = useMemo<ItemOption[]>(
    () =>
      (heroesQuery.data?.results ?? []).map((hero) => ({
        id: hero.id,
        name: hero.name,
        group: hero.type ?? hero.role ?? null,
        imageSrc: hero.image_path ?? null,
      })),
    [heroesQuery.data],
  );

  const catalogueLoading = heroesQuery.isPending;

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

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{t("kindHero")}</CardTitle>
          {canManage ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setDraft(emptyPickBanDraft("hero"))}>
              <Plus aria-hidden className="me-2 size-4" />
              {t("addHeroConfig")}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {configsQuery.isPending ? (
            <>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </>
          ) : configsByKind.hero.length === 0 ? (
            <div className="flex flex-col gap-1 py-2">
              <p className="font-medium">{t("noConfigs")}</p>
              <p className="text-muted-foreground text-sm">{t("noConfigsHeroHint")}</p>
            </div>
          ) : (
            configsByKind.hero.map((config) => (
              <ConfigRow
                key={config.id}
                config={config}
                scopeLabel={describeScope(config)}
                canManage={canManage}
                onEdit={() => setDraft(pickBanDraftFromConfig(config))}
                onDelete={() => setDeleteTarget(config)}
              />
            ))
          )}

          {draft != null ? (
            <ConfigEditor
              draft={draft}
              configs={configs}
              stages={stages}
              encounters={encounters}
              catalogue={catalogue}
              catalogueLoading={catalogueLoading}
              isSaving={upsertMutation.isPending}
              onChange={setDraft}
              onSave={() =>
                upsertMutation.mutate({
                  draft,
                  seriesLength: resolveSeriesLength(draft.stageId, draft.round, stages, encounters).bestOf,
                })
              }
              onCancel={() => setDraft(null)}
            />
          ) : null}
        </CardContent>
      </Card>

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
