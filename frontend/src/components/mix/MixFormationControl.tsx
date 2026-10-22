"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";

import { NumberInput } from "@/components/ui/number-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { MixTeamFormation } from "@/services/custom-game.service";

type Formation = { team_formation: MixTeamFormation; draft_pick_seconds: number };

/** How a mix (or a host's new mixes of one game) forms teams: the balancer, or a captain draft on a pick clock. */
export function MixFormationControl({
  value,
  onChange,
  disabled = false,
  idPrefix,
}: Readonly<{ value: Formation; onChange: (next: Formation) => void; disabled?: boolean; idPrefix: string }>) {
  const t = useTranslations("mixes.header");
  // The header writes the mix on every change, so the clock commits once, when the field is left -- not "12" on the
  // way to "120". NumberInput reports the clamped (10..600) value, or null when emptied, right before its onBlur.
  const typed = useRef<number | null>(null);
  return (
    <span className="flex shrink-0 items-center gap-2">
      <Select
        value={value.team_formation}
        disabled={disabled}
        onValueChange={(next) => onChange({ ...value, team_formation: next as MixTeamFormation })}
      >
        <SelectTrigger id={`${idPrefix}-formation`} aria-label={t("formation")} size="sm" className="w-44 bg-background/50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="balance">{t("formationBalance")}</SelectItem>
          <SelectItem value="draft">{t("formationDraft")}</SelectItem>
        </SelectContent>
      </Select>
      {value.team_formation === "draft" ? (
        <NumberInput
          id={`${idPrefix}-pick-seconds`}
          integer
          min={10}
          max={600}
          aria-label={t("pickSeconds")}
          title={t("pickSeconds")}
          disabled={disabled}
          value={value.draft_pick_seconds}
          onValueChange={(next) => {
            typed.current = next;
          }}
          onBlur={() => {
            if (typed.current != null && typed.current !== value.draft_pick_seconds) {
              onChange({ ...value, draft_pick_seconds: typed.current });
            }
          }}
          size="sm"
          className="w-20 bg-background/50 px-2 tabular-nums"
        />
      ) : null}
    </span>
  );
}
