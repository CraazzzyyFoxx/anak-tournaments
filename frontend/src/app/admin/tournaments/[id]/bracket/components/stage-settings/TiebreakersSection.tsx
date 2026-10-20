"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronUp } from "lucide-react";

import { EYEBROW_CLASS } from "@/components/kit/tone";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { tiebreakerLabel, tiebreakersForStageType } from "@/lib/tournament/tiebreakers";

import {
  FFA_RANKING_PRESETS,
  FFA_STAGE_TYPES,
  GROUP_STAGE_TYPES,
  RANKING_PRESETS,
  tiebreakOrderForPreset
} from "@/lib/bracket/projection";
import type { SectionProps } from "./types";

export function TiebreakersSection({
  form,
  onChange,
  winPointsDefault,
  drawPointsDefault,
  lossPointsDefault
}: SectionProps & {
  winPointsDefault: number;
  drawPointsDefault: number;
  lossPointsDefault: number;
}) {
  const t = useTranslations("adminBracket.settings");
  const tRoot = useTranslations("adminBracket");
  const ids = useId();
  // Which metrics the engine can compute here at all: a lobby has no opponent
  // pairing (no head-to-head, no Buchholz), a duel has no placement or score.
  const catalogue = tiebreakersForStageType(form.stageType, form.ffaColumns);
  const isGroups = GROUP_STAGE_TYPES.includes(form.stageType);

  // `points` is not a tiebreaker an organizer chooses: it is the ranking metric
  // every other step only separates ties on. The engine normalizes every saved
  // order the same way — `points` forced first, unknown or duplicated metrics
  // dropped — so it is not offered here as a movable or removable step.
  // Everything after it is free to reorder, and free to switch off: a metric
  // that is absent from `tiebreak_order` is simply not evaluated.
  const active = form.tiebreakOrder;
  const inactive = catalogue.filter((metric) => !form.tiebreakOrder.includes(metric.id));

  const isPinned = (index: number) => active[index] === "points";

  const moveMetric = (index: number, delta: -1 | 1) => {
    const next = [...active];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    if (isPinned(index) || isPinned(target)) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ tiebreakOrder: next });
  };

  const toggleMetric = (metricId: string, enabled: boolean) =>
    onChange({
      tiebreakOrder: enabled ? [...active, metricId] : active.filter((id) => id !== metricId)
    });

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-preset`}>{t("standingsPreset")}</Label>
          <Select
            value={form.rankingPreset}
            onValueChange={(value) =>
              onChange({
                rankingPreset: value,
                tiebreakOrder: tiebreakOrderForPreset(value, form.stageType, form.ffaColumns)
              })
            }
          >
            <SelectTrigger id={`${ids}-preset`}>
              <SelectValue placeholder={tRoot("labels.rankingPresets.default")} />
            </SelectTrigger>
            <SelectContent>
              {(FFA_STAGE_TYPES.includes(form.stageType)
                ? FFA_RANKING_PRESETS
                : RANKING_PRESETS
              ).map((preset) => (
                <SelectItem key={preset.value} value={preset.value}>
                  {tRoot(`labels.rankingPresets.${preset.labelKey}` as never)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {form.stageType === "swiss" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-bye`}>{t("byePoints")}</Label>
            <NumberInput
              id={`${ids}-bye`}
              placeholder={String(form.scoringWin || winPointsDefault)}
              value={form.swissByePoints === "" ? null : Number(form.swissByePoints)}
              onValueChange={(next) =>
                onChange({ swissByePoints: next == null ? "" : String(next) })
              }
            />
          </div>
        ) : null}
      </div>

      {/* Points for beating an opponent. An FFA lobby has none to beat: its
          points come from the place and the score of each game. */}
      {isGroups ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-win`}>{t("winOverride")}</Label>
            <NumberInput
              id={`${ids}-win`}
              placeholder={String(winPointsDefault)}
              value={form.scoringWin === "" ? null : Number(form.scoringWin)}
              onValueChange={(next) => onChange({ scoringWin: next == null ? "" : String(next) })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-draw`}>{t("drawOverride")}</Label>
            <NumberInput
              id={`${ids}-draw`}
              placeholder={String(drawPointsDefault)}
              value={form.scoringDraw === "" ? null : Number(form.scoringDraw)}
              onValueChange={(next) => onChange({ scoringDraw: next == null ? "" : String(next) })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-loss`}>{t("lossOverride")}</Label>
            <NumberInput
              id={`${ids}-loss`}
              placeholder={String(lossPointsDefault)}
              value={form.scoringLoss === "" ? null : Number(form.scoringLoss)}
              onValueChange={(next) => onChange({ scoringLoss: next == null ? "" : String(next) })}
            />
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className={EYEBROW_CLASS}>{t("tiebreakOrder")}</h3>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-primary"
            onClick={() =>
              onChange({
                tiebreakOrder: tiebreakOrderForPreset(
                  form.rankingPreset,
                  form.stageType,
                  form.ffaColumns
                )
              })
            }
          >
            {t("resetDefaults")}
          </Button>
        </div>
        <ol className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
          {active.map((metricId, index) => {
            const metricLabel =
              catalogue.find((metric) => metric.id === metricId)?.label ??
              tiebreakerLabel(metricId, undefined, form.ffaColumns);
            const isRankingMetric = metricId === "points";
            return (
              <li
                key={metricId}
                className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
              >
                <span className="flex items-center gap-2 font-medium text-muted-foreground">
                  <Checkbox
                    checked
                    disabled={isRankingMetric}
                    aria-label={t("useMetric", { metric: metricLabel })}
                    onCheckedChange={() => toggleMetric(metricId, false)}
                  />
                  <span className="tabular-nums">{index + 1}.</span>
                  <span className="text-foreground">{metricLabel}</span>
                  {isRankingMetric ? (
                    <span className={EYEBROW_CLASS}>{t("rankingMetric")}</span>
                  ) : null}
                </span>
                <span className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-foreground"
                    aria-label={t("moveUp", { metric: metricLabel })}
                    disabled={index === 0 || isPinned(index) || isPinned(index - 1)}
                    onClick={() => moveMetric(index, -1)}
                  >
                    <ChevronUp className="size-3.5" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-foreground"
                    aria-label={t("moveDown", { metric: metricLabel })}
                    disabled={
                      index === active.length - 1 || isPinned(index) || isPinned(index + 1)
                    }
                    onClick={() => moveMetric(index, 1)}
                  >
                    <ChevronDown className="size-3.5" aria-hidden />
                  </Button>
                </span>
              </li>
            );
          })}
        </ol>
        {inactive.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-dashed border-border px-3 py-2">
            <span className={EYEBROW_CLASS}>{t("notEvaluated")}</span>
            {inactive.map((metric) => (
              <span key={metric.id} className="flex items-center gap-2 text-xs opacity-70">
                <Checkbox
                  checked={false}
                  aria-label={t("useMetric", { metric: metric.label })}
                  onCheckedChange={() => toggleMetric(metric.id, true)}
                />
                <span className="text-muted-foreground">{metric.label}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
