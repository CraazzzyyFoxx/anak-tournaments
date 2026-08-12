"use client";

import { useId, useState } from "react";
import { Lock, Users } from "lucide-react";
import { useTranslations } from "next-intl";

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
import { EYEBROW_CLASS, TONE_CLASS } from "@/components/admin/tone";
import { cn } from "@/lib/utils";
import {
  ROSTER_SLOT_CODES,
  orderSlotCodes,
  slotsTotal,
  type RosterShape,
  type RosterSlotCode,
  type RosterSlotMap
} from "@/lib/roster-shape";

import {
  MAX_SLOT_COUNT,
  ROSTER_SHAPE_MODES,
  draftRoundsPreview,
  initialSelection,
  payloadTotalError,
  previewSlotRows,
  selectMode,
  setSlotCount,
  slotsPayload,
  type RosterShapeSelection
} from "./roster-shape-editor.model";

/**
 * Role hues, straight off the design-book role tokens (`--aqt-tank`,
 * `--aqt-damage`, `--aqt-support`) that every other role surface uses. Colour is
 * never the only cue: each chip and each stepper still carries its role name.
 */
const SLOT_CHIP: Record<RosterSlotCode, string> = {
  tank: "border-[color:var(--aqt-tank)]/35 bg-[color:var(--aqt-tank)]/12 text-[color:var(--aqt-tank)]",
  dps: "border-[color:var(--aqt-damage)]/35 bg-[color:var(--aqt-damage)]/12 text-[color:var(--aqt-damage)]",
  support:
    "border-[color:var(--aqt-support)]/35 bg-[color:var(--aqt-support)]/12 text-[color:var(--aqt-support)]",
  flex: "border-border/60 bg-muted/25 text-muted-foreground"
};

const SLOT_DOT: Record<RosterSlotCode, string> = {
  tank: "bg-[color:var(--aqt-tank)]",
  dps: "bg-[color:var(--aqt-damage)]",
  support: "bg-[color:var(--aqt-support)]",
  flex: "bg-muted-foreground"
};

interface RosterShapeEditorProps {
  /** Stored tournament override, straight off `Tournament.roster_slots_json`. */
  value: RosterSlotMap | null;
  /**
   * Server-resolved shape (`Tournament.roster_shape`). Every derived number --
   * team size, draft rounds, whether any slot asks for a role -- is read from
   * here; `null` only when the read did not opt into the entity.
   */
  effective: RosterShape | null;
  /**
   * `true` while a draft session is in flight. The write-path guard would reject
   * a change, so the form says so up front instead of letting the save 400.
   */
  locked?: boolean;
  disabled?: boolean;
  /** Emits the value for `TournamentUpdate.roster_slots_json`; `null` = inherit. */
  onChange: (next: RosterSlotMap | null) => void;
  className?: string;
}

export function RosterShapeEditor({
  value,
  effective,
  locked = false,
  disabled = false,
  onChange,
  className
}: RosterShapeEditorProps) {
  const t = useTranslations("rosterShape");
  const errorId = useId();
  const inherited = effective?.slots ?? {};
  const [selection, setSelection] = useState<RosterShapeSelection>(() =>
    initialSelection(value, inherited)
  );
  // `value` is the payload, which cannot express the editor's whole state: it
  // drops the counts kept under `inherit` and the mode behind an override that
  // equals a preset. So it is re-seeded only when the prop actually diverges
  // from what this editor last emitted -- a parent reset or a background
  // refetch -- and never on the editor's own round trip through the parent.
  //
  // Adjusted during render rather than in an effect: React re-runs the component
  // with the new state before committing, so the stale selection is never
  // painted. An effect would paint it first, then correct it -- and would trip
  // react-hooks/set-state-in-effect for exactly that reason.
  const [lastEmitted, setLastEmitted] = useState(() => JSON.stringify(value));
  const incoming = JSON.stringify(value);
  if (incoming !== lastEmitted) {
    setLastEmitted(incoming);
    setSelection(initialSelection(value, inherited));
  }

  const apply = (next: RosterShapeSelection) => {
    setSelection(next);
    const payload = slotsPayload(next);
    setLastEmitted(JSON.stringify(payload));
    onChange(payload);
  };

  const error = payloadTotalError(slotsPayload(selection));
  const readOnly = locked || disabled;
  const isInherit = selection.mode === "inherit";
  // In inherit mode the resolved shape IS the outcome, so the totals line reads
  // the server numbers; an override shows the live edit.
  const shownTotal = isInherit && effective ? effective.team_size : slotsTotal(selection.slots);
  const shownRounds = effective
    ? draftRoundsPreview(shownTotal, effective)
    : Math.max(shownTotal - 1, 0);
  const previewSlots = previewSlotRows(isInherit ? inherited : selection.slots);

  // Where the shape comes from, keyed off the mode being EDITED rather than the
  // saved resolution: while an override is in the form, saying "inherited from
  // the workspace" describes a state the admin is in the middle of leaving.
  const sourceNote = (() => {
    if (!effective) return null;
    if (!isInherit) return t("overriding");
    if (effective.source === "tournament") return t("willInherit");
    return t("inherited", {
      source: t(
        effective.source === "workspace"
          ? "inheritedSources.workspace"
          : "inheritedSources.default"
      ),
      shape: orderSlotCodes(effective.slots)
        .map((code) => `${effective.slots[code]} ${t(`slotCodes.${code}`)}`)
        .join(" · ")
    });
  })();

  return (
    <Card className={cn("border-border/40 bg-card/50", className)}>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-primary" aria-hidden />
          <CardTitle asChild className="text-sm font-semibold">
            <h2>{t("title")}</h2>
          </CardTitle>
        </div>
        <CardDescription className="text-xs">{t("description")}</CardDescription>
      </CardHeader>

      {/* Two panes: what you set on the left, what it produces on the right.
          Before this they were seven full-width paragraphs of identical 12px
          text, so the one number that matters -- team size -- read as a
          footnote under the controls. */}
      <CardContent className="grid items-start gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-8">
        <div className="space-y-4">
          {locked && (
            <p
              className={cn(
                "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
                TONE_CLASS.warning
              )}
            >
              <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {t("locked")}
            </p>
          )}

          <div>
            <Label htmlFor="settings-roster-shape-mode" className="text-xs">
              {t("mode")}
            </Label>
            <Select
              value={selection.mode}
              disabled={readOnly}
              onValueChange={(next) =>
                apply(selectMode(selection, next as RosterShapeSelection["mode"]))
              }
            >
              <SelectTrigger id="settings-roster-shape-mode" className="mt-1.5 bg-background/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROSTER_SHAPE_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {t(`modes.${mode}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sourceNote && <p className="mt-2 text-xs text-muted-foreground">{sourceNote}</p>}
          </div>

          {!isInherit && (
            <div>
              <span className={EYEBROW_CLASS}>{t("slots")}</span>
              {/* Counters, not text fields: 0-12 in a 4rem box beside its role
                  colour, instead of four full-width inputs holding one digit. */}
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ROSTER_SLOT_CODES.map((code) => (
                  <div
                    key={code}
                    className="rounded-lg border border-border/50 bg-muted/20 p-2 text-center"
                  >
                    <Label
                      htmlFor={`settings-roster-slot-${code}`}
                      className="flex items-center justify-center gap-1.5 text-xs"
                    >
                      <span
                        aria-hidden
                        className={cn("size-1.5 shrink-0 rounded-full", SLOT_DOT[code])}
                      />
                      {t(`slotCodes.${code}`)}
                    </Label>
                    <NumberInput
                      id={`settings-roster-slot-${code}`}
                      integer
                      min={0}
                      max={MAX_SLOT_COUNT}
                      disabled={readOnly}
                      aria-invalid={error !== null}
                      aria-describedby={error ? errorId : undefined}
                      value={selection.slots[code] ?? 0}
                      onValueChange={(next) => apply(setSlotCount(selection, code, next ?? 0))}
                      className="mt-1.5 h-8 bg-background/50 text-center tabular-nums"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p
              id={errorId}
              className={cn("rounded-lg border px-3 py-2 text-xs", TONE_CLASS.danger)}
              role="alert"
            >
              {t(`errors.${error}`)}
            </p>
          )}
        </div>

        {/* The answer to "what did I just configure" without starting a draft:
            the slot list a captain will be handed, as one wrapped strip rather
            than a column that grew a row per slot. */}
        <div className="rounded-lg border border-border/50 bg-muted/20 p-3 lg:max-w-3xl">
          <span className={EYEBROW_CLASS}>{t("preview")}</span>
          <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
            {t("total", { total: shownTotal, rounds: shownRounds })}
          </p>
          {previewSlots.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">{t("previewEmpty")}</p>
          ) : (
            <ol className="mt-2.5 flex flex-wrap gap-1.5">
              {previewSlots.map((code, index) => (
                <li
                  key={`${code}-${index}`}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                    SLOT_CHIP[code]
                  )}
                >
                  <span className="tabular-nums opacity-60">{index + 1}</span>
                  <span className="font-medium">{t(`slotCodes.${code}`)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
