"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { useBracketRoundLabel } from "@/hooks/useBracketRoundLabel";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { BEST_OF_OPTIONS, stageBestOfRoundSections } from "@/lib/tournament/best-of";
import type { StageBestOfConfig } from "@/types/tournament.types";

import { FFA_STAGE_TYPES, normalizeMaxRounds } from "@/lib/bracket/projection";
import { Spinner } from "@/components/ui/spinner";
import type { SectionProps } from "./types";

export function BestOfSection({
  stage,
  form,
  onChange,
  bracketTeamCount,
  lowerBracketTeamCount,
  plannedRounds,
  onApplyToExisting,
  applying
}: SectionProps & {
  bracketTeamCount: number;
  lowerBracketTeamCount: number;
  /** The engine's own rounds, from the editor's `planned-rounds` query. */
  plannedRounds?: readonly number[];
  onApplyToExisting: () => void;
  applying: boolean;
}) {
  const t = useTranslations("adminBracket.settings");
  const tRoot = useTranslations("adminBracket");
  const formatRound = useBracketRoundLabel();
  const ids = useId();
  const isDoubleElimination = form.stageType === "double_elimination";
  // An FFA lobby plays games, not a series: `best_of` is how many games it
  // plans (`FfaEncounterService.create_lobby`), resolved from round 1 alone.
  // "Bo5" and a final override would both be reading it as a duel.
  const isFfa = FFA_STAGE_TYPES.includes(form.stageType);

  const patchBestOf = (patch: Partial<StageBestOfConfig>) =>
    onChange({ bestOf: { ...form.bestOf, ...patch } });

  const setRound = (round: number, value: number | undefined) => {
    const byRound = { ...form.bestOf.by_round };
    if (value == null) delete byRound[String(round)];
    else byRound[String(round)] = value;
    onChange({ bestOf: { ...form.bestOf, by_round: byRound } });
  };

  // A lobby has one round, and the generator reads round 1 only: a per-round
  // grid here would offer keys no lobby carries.
  const sections = isFfa
    ? []
    : stageBestOfRoundSections({
        stageType: form.stageType,
        maxRounds: normalizeMaxRounds(form.maxRounds, stage.max_rounds ?? 5),
        bracketTeamCount,
        lowerBracketTeamCount:
          form.stageType === "double_elimination" ? lowerBracketTeamCount : 0,
        plannedRounds,
        configuredRounds: Object.keys(form.bestOf.by_round).map(Number),
        formatRound
      });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          {isFfa ? t("lobbyLength") : t("bestOfRound")}
        </h3>
        <Button size="sm" variant="ghost" disabled={applying} onClick={onApplyToExisting}>
          {applying ? <Spinner /> : null}
          {t("applyExisting")}
        </Button>
      </div>
      {/* One expression, not JSX text: Next's SWC transform drops the leading
          space of a multi-line text node that follows an expression and carries
          an HTML entity, which read as "Baked into lobbieson (re)generation". */}
      <p className="text-xs text-muted-foreground">
        {t("baked", { target: isFfa ? t("lobbies") : t("matches") })}
        {isDoubleElimination ? ` ${t("separateBrackets")}` : ""}
      </p>

      <div className={isFfa ? "grid gap-3" : "grid grid-cols-2 gap-3"}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-default`}>{isFfa ? t("gamesPerLobby") : t("default")}</Label>
          <Select
            value={String(form.bestOf.default)}
            onValueChange={(value) => patchBestOf({ default: Number(value) })}
          >
            <SelectTrigger id={`${ids}-default`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BEST_OF_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {isFfa ? t("games", { count: n }) : `Bo${n}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isFfa ? null : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-final`}>{isDoubleElimination ? t("grandFinalCap") : t("final")}</Label>
            <Select
              value={form.bestOf.final != null ? String(form.bestOf.final) : "none"}
              onValueChange={(value) =>
                patchBestOf({ final: value === "none" ? null : Number(value) })
              }
            >
              <SelectTrigger id={`${ids}-final`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  {isDoubleElimination ? t("sameUpper") : t("sameRounds")}
                </SelectItem>
                {BEST_OF_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>{`Bo${n}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {sections.map((section) => (
        <div key={section.key} className="flex flex-col gap-2">
          {section.label ? (
            <h4 className="text-xs font-medium text-muted-foreground">
              {tRoot(`bestOfSections.${section.key}` as never)}
            </h4>
          ) : null}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {section.rounds.map(({ round, label }) => (
              <div key={round} className="flex flex-col gap-1.5">
                <Label htmlFor={`${ids}-round-${round}`}>{label}</Label>
                <Select
                  value={
                    form.bestOf.by_round[String(round)] != null
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
                    <SelectItem value="inherit">{t("default")}</SelectItem>
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
