"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";

import { EncounterScoreControls } from "@/components/admin/EncounterScoreControls";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import captainService from "@/services/captain.service";
import { Encounter } from "@/types/encounter.types";

interface MatchReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  encounter: Encounter;
}

const MATCH_QUALITY_OPTIONS = [
  { value: 1, label: "1/5", description: "В одни ворота" },
  { value: 2, label: "2/5", description: "Пойдет" },
  { value: 3, label: "3/5", description: "Можно и лучше" },
  { value: 4, label: "4/5", description: "Плотно" },
  { value: 5, label: "5/5", description: "Я сосал меня е&%ли" },
] as const;

function closenessFloatToStars(closeness: number | null | undefined): number {
  if (closeness == null || closeness <= 0) return 3;
  return Math.max(1, Math.min(5, Math.round(closeness * 5)));
}

export function MatchReportDialog({
  open,
  onOpenChange,
  encounter,
}: MatchReportDialogProps) {
  const resetKey = [
    encounter.id,
    encounter.score?.home ?? 0,
    encounter.score?.away ?? 0,
    encounter.closeness ?? "none",
  ].join(":");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <MatchReportDialogBody
          key={resetKey}
          encounter={encounter}
          onOpenChange={onOpenChange}
        />
      ) : null}
    </Dialog>
  );
}

function MatchReportDialogBody({
  encounter,
  onOpenChange,
}: Omit<MatchReportDialogProps, "open">) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const homeTeamLabel = encounter.home_team?.name?.trim() || "Home team";
  const awayTeamLabel = encounter.away_team?.name?.trim() || "Away team";

  const [homeScore, setHomeScore] = useState(() => encounter.score?.home ?? 0);
  const [awayScore, setAwayScore] = useState(() => encounter.score?.away ?? 0);
  const [closeness, setCloseness] = useState<number>(() =>
    closenessFloatToStars(encounter.closeness),
  );

  const refreshEncounterViews = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["encounters"] }),
      qc.invalidateQueries({ queryKey: ["standings", encounter.tournament_id] }),
      qc.invalidateQueries({ queryKey: ["tournament"] }),
      qc.invalidateQueries({ queryKey: ["encounter"] }),
      qc.invalidateQueries({ queryKey: ["bracket"] }),
    ]);
  };

  const validationError = useMemo(() => {
    if (homeScore < 0 || awayScore < 0) {
      return "Счет не может быть отрицательным";
    }
    return null;
  }, [homeScore, awayScore]);

  const submitMutation = useMutation({
    mutationFn: () =>
      captainService.submitMatchReport(encounter.id, {
        home_score: homeScore,
        away_score: awayScore,
        closeness,
      }),
    onSuccess: async () => {
      toast({ title: "Результат отправлен на подтверждение" });
      await refreshEncounterViews();
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : "Не удалось отправить";
      toast({ title: "Ошибка", description: message, variant: "destructive" });
    },
  });

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Репорт матча</DialogTitle>
        <DialogDescription>
          {encounter.home_team?.name} vs {encounter.away_team?.name}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <EncounterScoreControls
          idPrefix={`match-report-${encounter.id}`}
          homeScore={homeScore}
          awayScore={awayScore}
          homeLabel={homeTeamLabel}
          awayLabel={awayTeamLabel}
          presetLabel="Быстрый результат"
          onScoreChange={(score) => {
            setHomeScore(score.homeScore);
            setAwayScore(score.awayScore);
          }}
        />

        <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
                Качество матча
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground/60">
                Насколько близкой была серия
              </p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/70 px-3 py-1.5 text-sm font-semibold">
              {MATCH_QUALITY_OPTIONS.find((option) => option.value === closeness)?.description ??
                `${closeness}/5`}
            </div>
          </div>

          <div className="grid grid-cols-5 gap-2">
            {MATCH_QUALITY_OPTIONS.map((option) => {
              const isSelected = option.value === closeness;

              return (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center gap-1 rounded-md border px-2 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    isSelected
                      ? "border-yellow-400/70 bg-yellow-500/10 text-yellow-300"
                      : "border-border/60 bg-background/60 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                  onClick={() => setCloseness(option.value)}
                  aria-pressed={isSelected}
                  aria-label={`Качество матча ${option.label}: ${option.description}`}
                >
                  <Star
                    className={cn(
                      "h-4 w-4",
                      isSelected ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground",
                    )}
                  />
                  <span className="text-xs font-semibold">{option.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>1 - односторонний матч</span>
            <span>5 - до последнего</span>
          </div>
        </div>

        {validationError && (
          <p className="text-sm text-destructive">{validationError}</p>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Отмена
        </Button>
        <Button
          onClick={() => submitMutation.mutate()}
          disabled={!!validationError || submitMutation.isPending}
        >
          {submitMutation.isPending ? "Отправка..." : "Отправить"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
