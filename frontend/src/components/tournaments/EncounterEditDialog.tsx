"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";

import { EncounterScoreControls } from "@/components/admin/EncounterScoreControls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import adminService from "@/services/admin.service";
import type { EncounterUpdateInput } from "@/types/admin.types";
import { Encounter } from "@/types/encounter.types";

interface EncounterEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  encounter: Encounter;
}

const ENCOUNTER_STATUSES = ["open", "pending", "completed"] as const;

function closenessFloatToStars(closeness: number | null | undefined): number {
  if (closeness == null || closeness <= 0) return 0;
  return Math.max(1, Math.min(5, Math.round(closeness * 5)));
}

export function EncounterEditDialog({ open, onOpenChange, encounter }: EncounterEditDialogProps) {
  const resetKey = [
    encounter.id,
    encounter.score?.home ?? 0,
    encounter.score?.away ?? 0,
    encounter.status ?? "open",
    encounter.closeness ?? "none"
  ].join(":");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <EncounterEditDialogBody key={resetKey} encounter={encounter} onOpenChange={onOpenChange} />
      ) : null}
    </Dialog>
  );
}

function EncounterEditDialogBody({
  encounter,
  onOpenChange
}: Omit<EncounterEditDialogProps, "open">) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const homeTeamLabel = encounter.home_team?.name?.trim() || "Home team";
  const awayTeamLabel = encounter.away_team?.name?.trim() || "Away team";

  const [homeScore, setHomeScore] = useState(() => encounter.score?.home ?? 0);
  const [awayScore, setAwayScore] = useState(() => encounter.score?.away ?? 0);
  const [status, setStatus] = useState<string>(() => encounter.status ?? "open");
  const [stars, setStars] = useState<number>(() => closenessFloatToStars(encounter.closeness));

  const refreshEncounterViews = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["encounters"] }),
      qc.invalidateQueries({ queryKey: ["standings", encounter.tournament_id] }),
      qc.invalidateQueries({ queryKey: ["tournament"] }),
      qc.invalidateQueries({ queryKey: ["encounter"] }),
      qc.invalidateQueries({ queryKey: ["bracket"] })
    ]);
  };

  const validationError = useMemo(() => {
    if (homeScore < 0 || awayScore < 0) {
      return "Счет матча не может быть отрицательным";
    }
    return null;
  }, [homeScore, awayScore]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const encounterPayload: EncounterUpdateInput = {
        home_score: homeScore,
        away_score: awayScore,
        status,
        closeness: stars > 0 ? stars / 5 : null
      };
      await adminService.updateEncounter(encounter.id, encounterPayload);
    },
    onSuccess: async () => {
      toast({ title: "Матч обновлен" });
      await refreshEncounterViews();
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Не удалось сохранить";
      toast({ title: "Ошибка", description: message, variant: "destructive" });
    }
  });

  const confirmMutation = useMutation({
    mutationFn: () => adminService.confirmEncounterResult(encounter.id),
    onSuccess: async () => {
      toast({ title: "Результат подтверждён" });
      await refreshEncounterViews();
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Не удалось подтвердить";
      toast({ title: "Ошибка", description: message, variant: "destructive" });
    }
  });

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          Редактировать матч
          {encounter.result_status === "pending_confirmation" && (
            <Badge className="bg-amber-500/80 text-white">Ожидает подтверждения</Badge>
          )}
          {encounter.result_status === "disputed" && (
            <Badge className="bg-red-500/80 text-white">Спор</Badge>
          )}
        </DialogTitle>
        <DialogDescription>
          {encounter.home_team?.name} vs {encounter.away_team?.name}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <EncounterScoreControls
          idPrefix={`encounter-edit-${encounter.id}`}
          homeScore={homeScore}
          awayScore={awayScore}
          homeLabel={homeTeamLabel}
          awayLabel={awayTeamLabel}
          onScoreChange={(score) => {
            setHomeScore(score.homeScore);
            setAwayScore(score.awayScore);
          }}
          onPresetSelect={(score) => {
            setHomeScore(score.homeScore);
            setAwayScore(score.awayScore);
            setStatus("completed");
          }}
        />

        <div>
          <Label className="text-xs">Статус</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENCOUNTER_STATUSES.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-sm">Близость матча</Label>
          <div className="mt-1 flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setStars(n === stars ? 0 : n)}
                className="p-1"
                aria-label={`${n} звезд`}
              >
                <Star
                  className={`h-6 w-6 ${
                    n <= stars ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"
                  }`}
                />
              </button>
            ))}
            <span className="ml-2 text-sm text-muted-foreground">
              {stars > 0 ? `${stars}/5` : "не задано"}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Редактируется только общий результат. Карты появятся после обработки логов.
          </p>
        </div>

        {validationError && <p className="text-sm text-destructive">{validationError}</p>}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Отмена
        </Button>
        {encounter.result_status === "pending_confirmation" && (
          <Button
            variant="secondary"
            onClick={() => confirmMutation.mutate()}
            disabled={confirmMutation.isPending}
          >
            {confirmMutation.isPending ? "Подтверждение..." : "Подтвердить результат"}
          </Button>
        )}
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!!validationError || saveMutation.isPending}
        >
          {saveMutation.isPending ? "Сохранение..." : "Сохранить"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
