"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import captainService from "@/services/captain.service";
import { Encounter } from "@/types/encounter.types";

interface MatchReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  encounter: Encounter;
}

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

  const [homeScore, setHomeScore] = useState(() =>
    String(encounter.score?.home ?? 0),
  );
  const [awayScore, setAwayScore] = useState(() =>
    String(encounter.score?.away ?? 0),
  );
  const [closeness, setCloseness] = useState<number>(() =>
    closenessFloatToStars(encounter.closeness),
  );

  const validationError = useMemo(() => {
    if (homeScore === "" || awayScore === "") {
      return "Заполните счет матча";
    }
    if (Number(homeScore) < 0 || Number(awayScore) < 0) {
      return "Счет не может быть отрицательным";
    }
    return null;
  }, [homeScore, awayScore]);

  const submitMutation = useMutation({
    mutationFn: () =>
      captainService.submitMatchReport(encounter.id, {
        home_score: Number(homeScore) || 0,
        away_score: Number(awayScore) || 0,
        closeness,
      }),
    onSuccess: () => {
      toast({ title: "Результат отправлен на подтверждение" });
      qc.invalidateQueries({ queryKey: ["tournament"] });
      qc.invalidateQueries({ queryKey: ["encounter"] });
      qc.invalidateQueries({ queryKey: ["bracket"] });
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Home score</Label>
            <Input
              type="number"
              min={0}
              value={homeScore}
              onChange={(e) => setHomeScore(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Away score</Label>
            <Input
              type="number"
              min={0}
              value={awayScore}
              onChange={(e) => setAwayScore(e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label className="text-sm">Близость матча</Label>
          <div className="mt-1 flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCloseness(n)}
                className="p-1"
                aria-label={`${n} звезд`}
              >
                <Star
                  className={`h-6 w-6 ${
                    n <= closeness
                      ? "fill-yellow-400 text-yellow-400"
                      : "text-muted-foreground"
                  }`}
                />
              </button>
            ))}
            <span className="ml-2 text-sm text-muted-foreground">
              {closeness}/5
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Репорт сохраняет только общий результат. Карты создаются отдельно
            при обработке лога.
          </p>
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
