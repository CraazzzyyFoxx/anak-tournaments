"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";

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
import { tiebreakersForStageType } from "@/lib/tournament/tiebreakers";
import type { Team } from "@/types/team.types";
import type { StageType } from "@/types/tournament.types";

import {
  defaultTiebreakOrder,
  STAGE_TYPE_LABELS,
  type StageProjection
} from "@/lib/bracket/projection";
import { BracketPreview } from "../BracketPreview";
import type { SectionProps } from "./types";

export function GeneralSection({
  stage,
  form,
  onChange,
  isSuperuser,
  projection,
  teams
}: SectionProps & {
  isSuperuser: boolean;
  projection: StageProjection;
  /** Named on the preview's cards, so their logos and full names resolve. */
  teams: Team[];
}) {
  const t = useTranslations("adminBracket.settings");
  const tRoot = useTranslations("adminBracket");
  const ids = useId();

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-name`}>{t("name")}</Label>
          <Input
            id={`${ids}-name`}
            value={form.name}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-phase`}>{t("phase")}</Label>
          <NumberInput
            id={`${ids}-phase`}
            integer
            min={0}
            value={form.order}
            onValueChange={(next) => onChange({ order: next ?? 0 })}
          />
          <p className="text-xs text-muted-foreground">
            {t("phaseHelp")}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-type`}>{t("format")}</Label>
          <Select
            value={form.stageType}
            onValueChange={(value) => {
              const stageType = value as StageType;
              // The metric catalogues are disjoint across families: an FFA
              // order on a duel stage (or the other way round) is one the
              // engine silently drops, so the new format's default replaces it
              // rather than being saved as an order nothing evaluates.
              const catalogue = tiebreakersForStageType(stageType, form.ffaColumns).map(
                (metric) => metric.id
              );
              const runnable = form.tiebreakOrder.every((metricId) =>
                (catalogue as string[]).includes(metricId)
              );
              onChange(
                runnable
                  ? { stageType }
                  : {
                      stageType,
                      rankingPreset: "default",
                      tiebreakOrder: defaultTiebreakOrder(stageType, form.ffaColumns)
                    }
              );
            }}
            // A drawn template is a bracket of one shape: switching format
            // would leave the stage with a layout its engine cannot generate.
            disabled={!isSuperuser || stage.has_custom_bracket}
          >
            <SelectTrigger id={`${ids}-type`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(STAGE_TYPE_LABELS).map((value) => (
                <SelectItem key={value} value={value}>
                  {tRoot(`labels.types.${value}` as never)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {stage.has_custom_bracket ? (
            <p className="text-xs text-muted-foreground">
              {t("resetCustom")}
            </p>
          ) : null}
          {isSuperuser ? null : (
            <p className="text-xs text-muted-foreground">
              {t("superuserOnly")}
            </p>
          )}
        </div>

        {form.stageType === "swiss" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-rounds`}>{t("swissRounds")}</Label>
            <NumberInput
              id={`${ids}-rounds`}
              integer
              min={1}
              value={form.maxRounds === "" ? null : Number(form.maxRounds)}
              onValueChange={(next) => onChange({ maxRounds: next == null ? "" : String(next) })}
            />
          </div>
        ) : null}

        {form.stageType === "double_elimination" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-grand-final`}>{t("grandFinal")}</Label>
            <Select
              value={form.deGrandFinalType}
              onValueChange={(value) =>
                onChange({ deGrandFinalType: value as "no_reset" | "with_reset" })
              }
            >
              <SelectTrigger id={`${ids}-grand-final`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no_reset">{t("noReset")}</SelectItem>
                <SelectItem value="with_reset">{t("withReset")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}

      </div>

      <BracketPreview projection={projection} stage={stage} teams={teams} />
    </div>
  );
}
