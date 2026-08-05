"use client";

import { useState } from "react";
import { Lock, Users } from "lucide-react";
import { useTranslations } from "next-intl";

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
}

export function RosterShapeEditor({
  value,
  effective,
  locked = false,
  disabled = false,
  onChange
}: RosterShapeEditorProps) {
  const t = useTranslations("rosterShape");
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

  return (
    <section className="space-y-3 border-t border-border/30 pt-4">
      <div className="flex items-center gap-2">
        <Users className="size-3.5 text-primary" aria-hidden />
        <h3 className={EYEBROW_CLASS}>{t("title")}</h3>
      </div>
      <p className="text-xs text-muted-foreground">{t("description")}</p>

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
      </div>

      {/* Inheritance stated, not implied: an inherited shape is shown together
          with where it comes from, so the numbers below are never mistaken for
          this tournament's own setting. */}
      {effective && effective.source !== "tournament" && (
        <p className="rounded-lg border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
          {t("inherited", {
            source: t(
              effective.source === "workspace"
                ? "inheritedSources.workspace"
                : "inheritedSources.default"
            ),
            shape: orderSlotCodes(effective.slots)
              .map((code) => `${effective.slots[code]} ${t(`slotCodes.${code}`)}`)
              .join(" · ")
          })}
        </p>
      )}
      {effective?.source === "tournament" && (
        <p className="text-xs text-muted-foreground">{t("overriding")}</p>
      )}

      {!isInherit && (
        <div>
          <span className="text-xs text-muted-foreground">{t("slots")}</span>
          <div className="mt-1.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {ROSTER_SLOT_CODES.map((code) => (
              <div key={code}>
                <Label htmlFor={`settings-roster-slot-${code}`} className="text-xs">
                  {t(`slotCodes.${code}`)}
                </Label>
                <NumberInput
                  id={`settings-roster-slot-${code}`}
                  integer
                  min={0}
                  max={MAX_SLOT_COUNT}
                  disabled={readOnly}
                  value={selection.slots[code] ?? 0}
                  onValueChange={(next) => apply(setSlotCount(selection, code, next ?? 0))}
                  className="mt-1.5 bg-background/50"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs tabular-nums text-muted-foreground">
        {t("total", { total: shownTotal, rounds: shownRounds })}
      </p>

      {error && (
        <p className={cn("rounded-lg border px-3 py-2 text-xs", TONE_CLASS.danger)} role="alert">
          {t(`errors.${error}`)}
        </p>
      )}

      {/* The answer to "what did I just configure" without starting a draft: the
          slot list a captain will be handed, one row per slot. */}
      <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
        <span className={EYEBROW_CLASS}>{t("preview")}</span>
        {previewSlots.length === 0 ? (
          <p className="mt-1.5 text-xs text-muted-foreground">{t("previewEmpty")}</p>
        ) : (
          <ol className="mt-1.5 space-y-1">
            {previewSlots.map((code, index) => (
              <li
                key={`${code}-${index}`}
                className="flex items-center gap-2 text-xs text-foreground/90"
              >
                <span className="w-4 tabular-nums text-muted-foreground">{index + 1}</span>
                <span
                  className={cn(
                    "rounded border px-1.5 py-0.5",
                    code === "flex" ? TONE_CLASS.neutral : TONE_CLASS.accent
                  )}
                >
                  {t(`slotCodes.${code}`)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
