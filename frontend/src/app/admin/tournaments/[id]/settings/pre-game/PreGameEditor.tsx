"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowDown, ArrowUp, Copy, Plus, RotateCcw, Trash2, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle
} from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/admin/kit/ConfirmDialog";
import { SaveBar } from "@/components/admin/kit/SaveBar";
import { hasUnsavedChanges } from "@/lib/form-change";
import type {
  MapVetoMode,
  PickBanConfig,
  PickBanFirstBanRotation,
  PickBanKind,
  PickBanNoRepeatScope,
  PickBanSequenceToken,
  Stage
} from "@/types/tournament.types";
import {
  PICK_BAN_MODES,
  PICK_BAN_NO_REPEAT_SCOPES,
  PICK_BAN_ROTATIONS,
  PICK_BAN_STEP_ACTIONS,
  PICK_BAN_STEP_SIDES,
  buildStepToken,
  effectiveSequence,
  emptyPickBanDraft,
  findInheritedConfig,
  parseStepToken,
  pickBanDraftFromConfig,
  protectHasNoStep,
  rescopePickBanDraft,
  resolveSeriesLength,
  roundsPlayed,
  validatePickBanDraft,
  type PickBanDraft,
  type PickBanOrderMode,
  type PickBanScopeEncounter,
  type PickBanStepAction,
  type PickBanStepSide,
  type SeriesLength
} from "../../components/pickBanConfig.helpers";
import { CatalogueChips, CataloguePicker, type CatalogueItem } from "./CataloguePicker";
import {
  PRE_GAME_STEPS,
  findScopeConfig,
  scopeConfigState,
  type PreGameScope,
  type PreGameStep
} from "./pre-game-scope";

export interface PreGameEditorProps {
  scope: PreGameScope;
  kind: PickBanKind;
  step: PreGameStep;
  /**
   * Writes `?step=`. The steps are URL state, but NOT links: they are sections
   * of one form, and `SaveBar`'s unsaved guard intercepts every in-app anchor
   * while the form is dirty — so a link here would demand a discard prompt to
   * look at the sequence you just edited the pool for.
   */
  onStepChange: (step: PreGameStep) => void;
  stages: Stage[];
  encounters?: PickBanScopeEncounter[];
  configs: PickBanConfig[];
  catalogue: CatalogueItem[];
  catalogueLoading: boolean;
  canManage: boolean;
  describeScope: (scope: Pick<PickBanConfig, "stage_id" | "round">) => string;
  saving: boolean;
  resetting: boolean;
  onSave: (draft: PickBanDraft, seriesLength: number) => void;
  /** Drops this scope's own config so it inherits again. */
  onResetToInherited: (configId: number) => void;
}

/**
 * The rules of one scope, as three steps rather than one 700-line form.
 *
 * Pool → Sequence → Sides are sections of the same form addressed by `?step=`,
 * not dialogs and not a wizard: an organizer changing a turn timer must not
 * walk through a pool picker to reach it, and every step saves the same config.
 */
export function PreGameEditor({
  scope,
  kind,
  step,
  onStepChange,
  stages,
  encounters,
  configs,
  catalogue,
  catalogueLoading,
  canManage,
  describeScope,
  saving,
  resetting,
  onSave,
  onResetToInherited
}: Readonly<PreGameEditorProps>) {
  const t = useTranslations("pickBan.admin");
  const ids = useId();
  const isHero = kind === "hero";

  const savedConfig = findScopeConfig(kind, scope, configs);
  const inheritedConfig = findInheritedConfig(kind, scope.stageId, scope.round, configs);

  // What this scope says today: its own saved config, or a copy of whatever it
  // inherits — retyping the tournament's timer, rotation and pool onto every
  // round is the work organizers skipped, leaving rounds on rules nobody chose.
  const baseDraft = useMemo(
    () =>
      savedConfig != null
        ? pickBanDraftFromConfig(savedConfig)
        : rescopePickBanDraft(emptyPickBanDraft(kind), scope.stageId, scope.round, configs),
    [savedConfig, kind, scope.stageId, scope.round, configs]
  );

  const [draft, setDraft] = useState<PickBanDraft>(baseDraft);
  // Re-baseline on a scope or kind switch, and when another admin's write
  // arrives through the configs query.
  useEffect(() => setDraft(baseDraft), [baseDraft]);
  const [resetOpen, setResetOpen] = useState(false);

  const catalogueById = useMemo(
    () => new Map(catalogue.map((option) => [option.id, option])),
    [catalogue]
  );

  const series = resolveSeriesLength(scope.stageId, scope.round, stages, encounters);
  const sequence = effectiveSequence(draft, series.bestOf);
  const issues = validatePickBanDraft(draft, series.bestOf);
  const scopeLabel = describeScope({ stage_id: scope.stageId, round: scope.round });
  const scopeState = scopeConfigState(kind, scope, configs);
  // A scope with no config of its own always has something to save — either
  // the values it was prefilled with from the cascade, or a first rule set for
  // a scope nothing reaches. Only an already-saved config can be clean.
  const dirty = savedConfig == null || hasUnsavedChanges(draft, baseDraft);

  const patch = (values: Partial<PickBanDraft>) =>
    setDraft((current) => ({ ...current, ...values }));

  const toggleItem = (itemId: number) =>
    setDraft((current) => ({
      ...current,
      itemIds: current.itemIds.includes(itemId)
        ? current.itemIds.filter((id) => id !== itemId)
        : [...current.itemIds, itemId]
    }));

  const patchSlot = (index: number, slotPatch: Partial<PickBanDraft["slots"][number]>) =>
    setDraft((current) => ({
      ...current,
      slots: current.slots.map((slot, at) => (at === index ? { ...slot, ...slotPatch } : slot))
    }));

  const StepStrip = (
    <nav aria-label={t("stepsLabel")} className="flex flex-wrap gap-1">
      {PRE_GAME_STEPS.map((key, index) => (
        <Button
          key={key}
          type="button"
          size="sm"
          variant={key === step ? "default" : "ghost"}
          aria-current={key === step ? "step" : undefined}
          onClick={() => onStepChange(key)}
        >
          {index + 1} · {t(`step.${key}`)}
        </Button>
      ))}
    </nav>
  );

  return (
    <div className="flex flex-col gap-4">
      {canManage ? null : <p className="text-sm text-muted-foreground">{t("readOnly")}</p>}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="font-display text-base font-semibold">{scopeLabel}</h2>
        <span className="text-xs text-muted-foreground">{t(`scopeState.${scopeState}`)}</span>
      </div>


      {draft.inheritedFrom != null ? (
        <Alert>
          <Copy aria-hidden className="size-4" />
          <AlertDescription>
            {t("inheritedPrefill", {
              scope: describeScope({
                stage_id: draft.inheritedFrom.stageId,
                round: draft.inheritedFrom.round
              })
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      {StepStrip}

      <Card>
        <CardContent className="flex flex-col gap-5 pt-6">
          {step === "pool" ? (
            <PoolStep
              ids={ids}
              draft={draft}
              kind={kind}
              bestOf={series.bestOf}
              catalogue={catalogue}
              catalogueById={catalogueById}
              catalogueLoading={catalogueLoading}
              canManage={canManage}
              patch={patch}
              patchSlot={patchSlot}
              toggleItem={toggleItem}
            />
          ) : null}

          {step === "sequence" ? (
            <SequenceStep
              ids={ids}
              draft={draft}
              isHero={isHero}
              series={series}
              sequence={sequence}
              canManage={canManage}
              patch={patch}
            />
          ) : null}

          {step === "sides" ? (
            <SidesStep
              ids={ids}
              draft={draft}
              isHero={isHero}
              bestOf={series.bestOf}
              canManage={canManage}
              patch={patch}
            />
          ) : null}
        </CardContent>
      </Card>

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

      {/* The cascade line: what this scope inherits, and the way back to it.
          Outside the save bar deliberately — dropping an override is the
          common act on a scope with nothing else to save, and a control that
          only appears once the form is dirty could never do it. */}
      {inheritedConfig != null ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {t("overridesInherited", {
            scope: describeScope({
              stage_id: inheritedConfig.stage_id,
              round: inheritedConfig.round
            })
          })}
          {canManage && savedConfig != null ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={resetting}
              onClick={() => setResetOpen(true)}
            >
              <RotateCcw aria-hidden className="me-2 size-3.5" />
              {t("resetToInherited")}
            </Button>
          ) : null}
        </p>
      ) : null}

      <SaveBar
        dirty={dirty && canManage}
        saving={saving}
        primaryLabel={t("save")}
        summary={t("editingScope", { scope: scopeLabel })}
        onDiscard={() => setDraft(baseDraft)}
        // Save stays clickable with the reason on screen rather than greying
        // out a viewport away from the alert that explains it.
        onSave={() => {
          if (issues.length === 0) onSave(draft, series.bestOf);
        }}
      />

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        pending={resetting}
        intent={{
          title: t("resetConfirmTitle"),
          description: t("resetConfirmDescription", {
            scope: scopeLabel,
            source:
              inheritedConfig == null
                ? t("tournamentLevel")
                : describeScope({
                    stage_id: inheritedConfig.stage_id,
                    round: inheritedConfig.round
                  })
          }),
          confirmLabel: t("resetConfirmAction"),
          tone: "warning"
        }}
        onConfirm={() => {
          if (savedConfig != null) onResetToInherited(savedConfig.id);
          setResetOpen(false);
        }}
      />
    </div>
  );
}

// ── step 1: pool ─────────────────────────────────────────────────────────────

function PoolStep({
  ids,
  draft,
  kind,
  bestOf,
  catalogue,
  catalogueById,
  catalogueLoading,
  canManage,
  patch,
  patchSlot,
  toggleItem
}: Readonly<{
  ids: string;
  draft: PickBanDraft;
  kind: PickBanKind;
  bestOf: number;
  catalogue: CatalogueItem[];
  catalogueById: Map<number, CatalogueItem>;
  catalogueLoading: boolean;
  canManage: boolean;
  patch: (values: Partial<PickBanDraft>) => void;
  patchSlot: (index: number, slotPatch: Partial<PickBanDraft["slots"][number]>) => void;
  toggleItem: (itemId: number) => void;
}>) {
  const t = useTranslations("pickBan.admin");
  const isHero = kind === "hero";
  const slotCountMismatch =
    draft.mode === "slots" && draft.slots.length > 0 && draft.slots.length !== bestOf;

  return (
    <>
      <div>
        <FieldTitle className="text-sm">{t("poolSection")}</FieldTitle>
        <FieldDescription>{t("poolSectionHint")}</FieldDescription>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${ids}-mode`}>{t("modeLabel")}</FieldLabel>
          <Select
            value={draft.mode}
            disabled={!canManage}
            onValueChange={(value) => patch({ mode: value as MapVetoMode })}
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
            {isHero ? t("poolHeroLabel") : t("poolMapLabel")}
            <Badge variant="secondary">{t("poolCount", { count: draft.itemIds.length })}</Badge>
          </FieldTitle>
          <FieldDescription>{t("poolHint")}</FieldDescription>
          <CatalogueChips
            itemIds={draft.itemIds}
            catalogue={catalogueById}
            disabled={!canManage}
            onRemove={toggleItem}
            trailing={
              <CataloguePicker
                mode="multi"
                kind={kind}
                options={catalogue}
                selectedIds={draft.itemIds}
                disabled={catalogueLoading || !canManage}
                onToggle={toggleItem}
                onSelectVisible={(itemIds) =>
                  patch({
                    itemIds: [
                      ...draft.itemIds,
                      ...itemIds.filter((id) => !draft.itemIds.includes(id))
                    ]
                  })
                }
                onClearVisible={(itemIds) =>
                  patch({ itemIds: draft.itemIds.filter((id) => !itemIds.includes(id)) })
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
                {t("slotCountMismatch", { slots: draft.slots.length, maps: bestOf })}
              </AlertDescription>
            </Alert>
          ) : null}

          {draft.slots.map((slot, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FieldTitle className="text-sm">
                  {t("slotTitle", { n: index + 1 })}
                  <Badge variant="secondary">
                    {t("slotCandidates", { count: slot.candidates.length })}
                  </Badge>
                </FieldTitle>
                <div className="flex items-center gap-2">
                  <CataloguePicker
                    mode="single"
                    kind={kind}
                    triggerLabel={t("slotReserveAria", { n: index + 1 })}
                    triggerPrefix={t("slotReserve")}
                    value={slot.reserveItemId}
                    // The server rejects a reserve that is also a candidate,
                    // so it is never offered here.
                    options={catalogue.filter((option) => !slot.candidates.includes(option.id))}
                    disabled={catalogueLoading || !canManage}
                    onChange={(itemId) => patchSlot(index, { reserveItemId: itemId })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={!canManage}
                    aria-label={t("slotRemove", { n: index + 1 })}
                    onClick={() =>
                      patch({ slots: draft.slots.filter((_, at) => at !== index) })
                    }
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </div>
              </div>

              <CatalogueChips
                itemIds={slot.candidates}
                catalogue={catalogueById}
                disabled={!canManage}
                onRemove={(itemId) =>
                  patchSlot(index, {
                    candidates: slot.candidates.filter((id) => id !== itemId)
                  })
                }
                trailing={
                  <CataloguePicker
                    mode="multi"
                    kind={kind}
                    options={catalogue}
                    selectedIds={slot.candidates}
                    disabled={catalogueLoading || !canManage}
                    onToggle={(itemId) =>
                      patchSlot(index, {
                        candidates: slot.candidates.includes(itemId)
                          ? slot.candidates.filter((id) => id !== itemId)
                          : [...slot.candidates, itemId],
                        // A candidate can no longer be this slot's reserve.
                        reserveItemId:
                          slot.reserveItemId === itemId ? null : slot.reserveItemId
                      })
                    }
                    onSelectVisible={(itemIds) =>
                      patchSlot(index, {
                        candidates: [
                          ...slot.candidates,
                          ...itemIds.filter((id) => !slot.candidates.includes(id))
                        ],
                        // The catalogue offered here isn't narrowed like the
                        // reserve picker's is, so a bulk add can catch the
                        // current reserve; drop it rather than leave a
                        // candidate double-booked as its own slot's reserve.
                        reserveItemId:
                          slot.reserveItemId != null && itemIds.includes(slot.reserveItemId)
                            ? null
                            : slot.reserveItemId
                      })
                    }
                    onClearVisible={(itemIds) =>
                      patchSlot(index, {
                        candidates: slot.candidates.filter((id) => !itemIds.includes(id))
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
            disabled={!canManage}
            onClick={() =>
              patch({ slots: [...draft.slots, { candidates: [], reserveItemId: null }] })
            }
          >
            <Plus aria-hidden className="me-2 size-4" />
            {t("addSlot")}
          </Button>
        </div>
      )}
    </>
  );
}

// ── step 2: sequence ─────────────────────────────────────────────────────────

function SequenceStep({
  ids,
  draft,
  isHero,
  series,
  sequence,
  canManage,
  patch
}: Readonly<{
  ids: string;
  draft: PickBanDraft;
  isHero: boolean;
  series: SeriesLength;
  sequence: PickBanSequenceToken[];
  canManage: boolean;
  patch: (values: Partial<PickBanDraft>) => void;
}>) {
  const t = useTranslations("pickBan.admin");

  return (
    <>
      <div>
        <FieldTitle className="text-sm">{t("orderSection")}</FieldTitle>
        <FieldDescription>
          {isHero ? t("orderHeroHint") : t("orderSectionHint")}
        </FieldDescription>
      </div>

      {/* Slot mode resolves each round on its own; there is no series-wide
          order to author, and the custom preset is unstorable. */}
      {draft.mode === "slots" ? (
        <FieldDescription>{t("orderSlotsMode")}</FieldDescription>
      ) : (
        <>
          {/* A hero config has no bracket-generated option: its sequence is ONE
              round's steps, replayed per map of the series, while the generator
              answers the map question and emits picks and a decider a hero
              round cannot resolve. */}
          {isHero ? null : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${ids}-order`}>{t("orderLabel")}</FieldLabel>
                <Select
                  value={draft.orderMode}
                  disabled={!canManage}
                  onValueChange={(value) =>
                    patch({
                      orderMode: value as PickBanOrderMode,
                      // Authoring starts from the generated order rather than
                      // an empty list, so "custom" is an edit, not a blank page.
                      sequence:
                        value === "custom" && draft.sequence.length === 0
                          ? sequence
                          : draft.sequence
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

          {/* The generated order is a function of the pool, so it says nothing
              until there is one — "0 rounds played" would read as a setting
              rather than a missing prerequisite. */}
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
                  {!isHero &&
                  series.source === "round" &&
                  roundsPlayed(sequence) !== series.bestOf ? (
                    <Alert>
                      <AlertTriangle aria-hidden className="size-4" />
                      <AlertDescription>
                        {t("orderCustomMismatch", {
                          played: roundsPlayed(sequence),
                          expected: series.bestOf
                        })}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <StepList
                    sequence={draft.sequence}
                    allowProtect={draft.allowProtect}
                    allowDecider={!isHero}
                    disabled={!canManage}
                    onChange={(next) => patch({ sequence: next })}
                  />
                </>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

/** Read-only step chips: the generated order, or a preview of a custom one. */
function SequencePreview({ sequence }: Readonly<{ sequence: PickBanSequenceToken[] }>) {
  const t = useTranslations("pickBan.admin");
  if (sequence.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("sequenceEmpty")}</p>;
  }
  return (
    <ol className="flex flex-wrap gap-1.5">
      {sequence.map((token, index) => {
        const step = parseStepToken(token);
        return (
          <li
            key={`${token}-${index}`}
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs"
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
  onChange
}: Readonly<{
  sequence: PickBanSequenceToken[];
  /** Gates the protect action: the engine ignores it without the toggle. */
  allowProtect: boolean;
  /** False for a hero sequence, whose pool has no survivor to decide on. */
  allowDecider: boolean;
  disabled: boolean;
  onChange: (next: PickBanSequenceToken[]) => void;
}>) {
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
    ...(allowDecider ? (["decider"] as const) : [])
  ];

  return (
    <div className="flex flex-col gap-2">
      {sequence.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("sequenceEmpty")}</p>
      ) : null}

      <ol className="flex flex-col gap-2">
        {sequence.map((token, index) => {
          const step = parseStepToken(token);
          const position = index + 1;
          return (
            <li key={index} className="flex flex-wrap items-center gap-2">
              <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">
                {t("stepNumber", { n: position })}
              </span>

              <Select
                value={step.action}
                disabled={disabled}
                onValueChange={(value) =>
                  replace(
                    index,
                    buildStepToken(value as PickBanStepAction | "decider", step.side ?? "first")
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
                <span className="text-xs text-muted-foreground">{t("deciderAuto")}</span>
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

// ── step 3: sides ────────────────────────────────────────────────────────────

function SidesStep({
  ids,
  draft,
  isHero,
  bestOf,
  canManage,
  patch
}: Readonly<{
  ids: string;
  draft: PickBanDraft;
  isHero: boolean;
  bestOf: number;
  canManage: boolean;
  patch: (values: Partial<PickBanDraft>) => void;
}>) {
  const t = useTranslations("pickBan.admin");
  const protectUnused = protectHasNoStep(draft, bestOf);

  return (
    <>
      <div>
        <FieldTitle className="text-sm">{t("rulesSection")}</FieldTitle>
        <FieldDescription>{t("rulesSectionHint")}</FieldDescription>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${ids}-rotation`}>{t("firstBanRotation")}</FieldLabel>
          <Select
            value={draft.firstBanRotation}
            disabled={!canManage}
            onValueChange={(value) =>
              patch({ firstBanRotation: value as PickBanFirstBanRotation })
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
            disabled={!canManage}
            onValueChange={(value) => patch({ noRepeatScope: value as PickBanNoRepeatScope })}
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
              disabled={!canManage}
              placeholder={t("turnTimerPlaceholder")}
              className="w-28"
              value={draft.turnTimerSeconds}
              onValueChange={(value) => patch({ turnTimerSeconds: value })}
            />
            <span className="text-sm text-muted-foreground">{t("turnTimerUnit")}</span>
            {draft.turnTimerSeconds != null ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!canManage}
                onClick={() => patch({ turnTimerSeconds: null })}
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
          {/* One enum member exists server-side, so a control here would be a
              choice with nothing to choose. Stated instead of offered. */}
          <p className="text-sm font-medium">{t("firstPickRuleValue.higher_seed")}</p>
          <FieldDescription>{t("firstPickRuleHint")}</FieldDescription>
        </Field>
      </div>

      <Field orientation="horizontal">
        <Switch
          id={`${ids}-protect`}
          aria-describedby={`${ids}-protect-hint`}
          checked={draft.allowProtect}
          disabled={!canManage}
          onCheckedChange={(checked) => patch({ allowProtect: checked })}
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
            disabled={!canManage}
            onCheckedChange={(checked) => patch({ uniqueRolePerRound: checked })}
          />
          <FieldContent>
            <FieldLabel htmlFor={`${ids}-role`}>{t("uniqueRole")}</FieldLabel>
            <FieldDescription id={`${ids}-role-hint`}>{t("uniqueRoleHint")}</FieldDescription>
          </FieldContent>
        </Field>
      ) : null}
    </>
  );
}
