"use client";

import { useId } from "react";
import { ChevronDown, ChevronUp, Link2, Loader2 } from "lucide-react";

import { EYEBROW_CLASS, TONE_CLASS } from "@/components/admin/tone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { ALL_TIEBREAKERS } from "@/lib/tiebreakers";
import { BEST_OF_OPTIONS, stageBestOfRoundSections } from "@/lib/best-of";
import { cn } from "@/lib/utils";
import type { StageBestOfConfig } from "@/types/admin.types";
import type { Stage, StageType } from "@/types/tournament.types";

import {
  BRACKET_STAGE_TYPES,
  getStageStatus,
  getStageStatusTone,
  normalizeMaxRounds,
  RANKING_PRESETS,
  SEED_RANKING_LABELS,
  STAGE_TYPE_LABELS,
  tiebreakOrderForPreset,
  type SeedRanking,
  type StageProjection
} from "../projection";
import type { StageForm } from "../stageForm";
import { BracketPreview } from "./BracketPreview";

/*
 * The five editor sections, one per `?section=`.
 *
 * These are the field groups that used to live inside `StageManager`'s single
 * `Advanced` `Collapsible` — three levels of nesting deep, all mounted at once
 * and all saved by one button labelled "Save override". Promoted to sections
 * they are the same forms with the same payload; only the disclosure is gone.
 */

type SectionProps = Readonly<{
  stage: Stage;
  form: StageForm;
  onChange: (patch: Partial<StageForm>) => void;
}>;

export function GeneralSection({
  stage,
  form,
  onChange,
  isSuperuser,
  projection,
  hasEncounters
}: SectionProps & {
  isSuperuser: boolean;
  projection: StageProjection;
  hasEncounters: boolean;
}) {
  const ids = useId();

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-name`}>Name</Label>
          <Input
            id={`${ids}-name`}
            value={form.name}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-type`}>Format</Label>
          <Select
            value={form.stageType}
            onValueChange={(value) => onChange({ stageType: value as StageType })}
            disabled={!isSuperuser}
          >
            <SelectTrigger id={`${ids}-type`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STAGE_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isSuperuser ? null : (
            <p className="text-xs text-muted-foreground">
              Only superusers can modify stage type after creation.
            </p>
          )}
        </div>

        {form.stageType === "swiss" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-rounds`}>Swiss max rounds</Label>
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
            <Label htmlFor={`${ids}-grand-final`}>Grand final</Label>
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
                <SelectItem value="no_reset">No reset</SelectItem>
                <SelectItem value="with_reset">With reset</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <p className={EYEBROW_CLASS}>Status</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn(TONE_CLASS[getStageStatusTone(stage, hasEncounters)])}
            >
              {getStageStatus(stage, hasEncounters)}
            </Badge>
            {stage.is_published ? (
              <span className="text-xs text-muted-foreground">published to captains</span>
            ) : (
              <span className="text-xs text-muted-foreground">not visible to captains</span>
            )}
            {stage.challonge_slug ? (
              <a
                className="inline-flex items-center gap-1 rounded-full border border-primary/40 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                href={`https://challonge.com/${stage.challonge_slug}`}
                target="_blank"
                rel="noreferrer"
              >
                <Link2 className="size-3" aria-hidden />
                Challonge
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <BracketPreview projection={projection} />
    </div>
  );
}

export function SeedingSection({ form, onChange }: SectionProps) {
  const ids = useId();
  const isBracket = BRACKET_STAGE_TYPES.includes(form.stageType);
  const isGroups = !isBracket;

  return (
    <div className="flex flex-col gap-4">
      {form.stageType === "double_elimination" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-split`}>Group seeding</Label>
          <Select
            value={form.splitLowerBracket ? "split" : "all_upper"}
            onValueChange={(value) => onChange({ splitLowerBracket: value === "split" })}
          >
            <SelectTrigger id={`${ids}-split`} className="sm:w-[280px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all_upper">All advancing → Upper bracket</SelectItem>
              <SelectItem value="split">Split: half Upper, half Lower</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Uses the group stage&apos;s &quot;Teams advancing to playoff&quot; count; auto-wired on
            Activate &amp; generate.
          </p>
        </div>
      ) : null}

      {isBracket ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-seed-ranking`}>Bracket seeds</Label>
          <Select
            value={form.seedRanking}
            onValueChange={(value) => onChange({ seedRanking: value as SeedRanking })}
          >
            <SelectTrigger id={`${ids}-seed-ranking`} className="sm:w-[320px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SEED_RANKING_LABELS) as SeedRanking[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {SEED_RANKING_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Who is seed 1 in the generated bracket. Slot order keeps standings wiring.
          </p>
        </div>
      ) : null}

      {isGroups ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-advance`}>Teams advancing to playoff (per group)</Label>
          <NumberInput
            id={`${ids}-advance`}
            integer
            min={1}
            placeholder="Auto (derive from bracket)"
            className="sm:w-[280px]"
            value={form.advanceCount === "" ? null : Number(form.advanceCount)}
            onValueChange={(next) => onChange({ advanceCount: next == null ? "" : String(next) })}
          />
          <p className="text-xs text-muted-foreground">
            Top N from each group advance. Leave empty to auto-derive from the bracket wiring.
          </p>
        </div>
      ) : null}

      <p className="border-t border-border pt-3 text-xs text-muted-foreground">
        Filling the slots themselves is «Seed by SR» and «Auto-wire from groups» in the stage
        actions menu, or the Items section one team at a time.
      </p>
    </div>
  );
}

export function TiebreakersSection({
  stage,
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
  const ids = useId();

  const moveMetric = (index: number, delta: -1 | 1) => {
    const next = [...form.tiebreakOrder];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ tiebreakOrder: next });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-preset`}>Standings preset</Label>
          <Select
            value={form.rankingPreset}
            onValueChange={(value) =>
              onChange({
                rankingPreset: value,
                tiebreakOrder: tiebreakOrderForPreset(value, stage.stage_type)
              })
            }
          >
            <SelectTrigger id={`${ids}-preset`}>
              <SelectValue placeholder="System default" />
            </SelectTrigger>
            <SelectContent>
              {RANKING_PRESETS.map((preset) => (
                <SelectItem key={preset.value} value={preset.value}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {form.stageType === "swiss" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-bye`}>Swiss bye points</Label>
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-win`}>Win points override</Label>
          <NumberInput
            id={`${ids}-win`}
            placeholder={String(winPointsDefault)}
            value={form.scoringWin === "" ? null : Number(form.scoringWin)}
            onValueChange={(next) => onChange({ scoringWin: next == null ? "" : String(next) })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-draw`}>Draw points override</Label>
          <NumberInput
            id={`${ids}-draw`}
            placeholder={String(drawPointsDefault)}
            value={form.scoringDraw === "" ? null : Number(form.scoringDraw)}
            onValueChange={(next) => onChange({ scoringDraw: next == null ? "" : String(next) })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-loss`}>Loss points override</Label>
          <NumberInput
            id={`${ids}-loss`}
            placeholder={String(lossPointsDefault)}
            value={form.scoringLoss === "" ? null : Number(form.scoringLoss)}
            onValueChange={(next) => onChange({ scoringLoss: next == null ? "" : String(next) })}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className={EYEBROW_CLASS}>Tiebreaker evaluation order</h3>
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-xs text-primary"
            onClick={() =>
              onChange({
                tiebreakOrder: tiebreakOrderForPreset(form.rankingPreset, stage.stage_type)
              })
            }
          >
            Reset to preset defaults
          </Button>
        </div>
        <ol className="flex flex-col gap-1 rounded-lg border border-border bg-card p-2">
          {form.tiebreakOrder.map((metricId, index) => {
            const metricLabel =
              ALL_TIEBREAKERS.find((metric) => metric.id === metricId)?.label ?? metricId;
            return (
              <li
                key={metricId}
                className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-1 text-xs"
              >
                <span className="font-medium text-muted-foreground">
                  {index + 1}. <span className="text-foreground">{metricLabel}</span>
                </span>
                <span className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-foreground"
                    aria-label={`Move ${metricLabel} up`}
                    disabled={index === 0}
                    onClick={() => moveMetric(index, -1)}
                  >
                    <ChevronUp className="size-3.5" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-foreground"
                    aria-label={`Move ${metricLabel} down`}
                    disabled={index === form.tiebreakOrder.length - 1}
                    onClick={() => moveMetric(index, 1)}
                  >
                    <ChevronDown className="size-3.5" aria-hidden />
                  </Button>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

export function BestOfSection({
  stage,
  form,
  onChange,
  bracketTeamCount,
  onApplyToExisting,
  applying
}: SectionProps & {
  bracketTeamCount: number;
  onApplyToExisting: () => void;
  applying: boolean;
}) {
  const ids = useId();
  const isDoubleElimination = form.stageType === "double_elimination";

  const patchBestOf = (patch: Partial<StageBestOfConfig>) =>
    onChange({ bestOf: { ...form.bestOf, ...patch } });

  const setRound = (round: number, value: number | undefined) => {
    const byRound = { ...(form.bestOf.by_round ?? {}) };
    if (value == null) delete byRound[String(round)];
    else byRound[String(round)] = value;
    onChange({ bestOf: { ...form.bestOf, by_round: byRound } });
  };

  const sections = stageBestOfRoundSections({
    stageType: form.stageType,
    maxRounds: normalizeMaxRounds(form.maxRounds, stage.max_rounds ?? 5),
    bracketTeamCount,
    splitLowerBracket: form.stageType === "double_elimination" && form.splitLowerBracket,
    configuredRounds: Object.keys(form.bestOf.by_round ?? {}).map(Number)
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Best-of per round</h3>
        <Button size="sm" variant="ghost" disabled={applying} onClick={onApplyToExisting}>
          {applying ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Apply to existing matches
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Baked into matches on (re)generation. Use &quot;Apply to existing matches&quot; to backfill
        without regenerating.
        {isDoubleElimination
          ? " Upper and lower bracket rounds are configured separately."
          : ""}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-default`}>Default</Label>
          <Select
            value={form.bestOf.default != null ? String(form.bestOf.default) : "inherit"}
            onValueChange={(value) =>
              patchBestOf({ default: value === "inherit" ? undefined : Number(value) })
            }
          >
            <SelectTrigger id={`${ids}-default`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">Default (Bo3)</SelectItem>
              {BEST_OF_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>{`Bo${n}`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-final`}>{isDoubleElimination ? "Grand Final" : "Final"}</Label>
          <Select
            value={form.bestOf.final != null ? String(form.bestOf.final) : "none"}
            onValueChange={(value) =>
              patchBestOf({ final: value === "none" ? undefined : Number(value) })
            }
          >
            <SelectTrigger id={`${ids}-final`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                {isDoubleElimination ? "Same as upper bracket" : "Same as rounds"}
              </SelectItem>
              {BEST_OF_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>{`Bo${n}`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {sections.map((section) => (
        <div key={section.key} className="flex flex-col gap-2">
          {section.label ? (
            <h4 className="text-xs font-medium text-muted-foreground">{section.label}</h4>
          ) : null}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {section.rounds.map(({ round, label }) => (
              <div key={round} className="flex flex-col gap-1.5">
                <Label htmlFor={`${ids}-round-${round}`}>{label}</Label>
                <Select
                  value={
                    form.bestOf.by_round?.[String(round)] != null
                      ? String(form.bestOf.by_round[String(round)])
                      : "inherit"
                  }
                  onValueChange={(next) =>
                    setRound(round, next === "inherit" ? undefined : Number(next))
                  }
                >
                  <SelectTrigger id={`${ids}-round-${round}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">Default</SelectItem>
                    {BEST_OF_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)}>{`Bo${n}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
