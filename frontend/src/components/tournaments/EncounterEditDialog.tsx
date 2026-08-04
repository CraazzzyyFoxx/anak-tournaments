"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";

import { EncounterScoreControls } from "@/components/tournaments/EncounterScoreControls";
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
import { notify } from "@/lib/notify";
import { useTranslations } from "next-intl";
import adminService from "@/services/admin.service";
import captainService from "@/services/captain.service";
import { CaptainReportsView } from "@/components/tournaments/CaptainReportsView";
import type { EncounterEditableStatus, EncounterUpdateInput } from "@/types/admin.types";
import { Encounter } from "@/types/encounter.types";
import { cn } from "@/lib/utils";

interface EncounterEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  encounter: Encounter;
}

// Editable statuses only. Completion moves score, status, result_status and
// the audit row together, so it belongs to the result action below.
const ENCOUNTER_STATUSES = ["open", "pending"] as const;
const BEST_OF_OPTIONS = [1, 2, 3, 5, 7] as const;

function closenessFloatToStars(closeness: number | null | undefined): number {
  if (closeness == null || closeness <= 0) return 0;
  return Math.max(1, Math.min(10, Math.round(closeness * 10)));
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
  const t = useTranslations();
  const homeTeamLabel = encounter.home_team?.name?.trim() || t("common.homeTeam");
  const awayTeamLabel = encounter.away_team?.name?.trim() || t("common.awayTeam");

  const [homeScore, setHomeScore] = useState(() => encounter.score?.home ?? 0);
  const [awayScore, setAwayScore] = useState(() => encounter.score?.away ?? 0);
  const [status, setStatus] = useState<string>(() => encounter.status ?? "open");
  const [stars, setStars] = useState<number>(() => closenessFloatToStars(encounter.closeness));
  const [bestOf, setBestOf] = useState<number>(() => encounter.best_of ?? 3);

  const reportsQuery = useQuery({
    queryKey: ["encounter", encounter.id, "reports"],
    queryFn: () => captainService.getReports(encounter.id)
  });

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
      return t("matchEdit.negativeScoreError");
    }
    return null;
  }, [homeScore, awayScore, t]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const encounterPayload: EncounterUpdateInput = {
        home_score: homeScore,
        away_score: awayScore,
        status: status as EncounterEditableStatus,
        closeness: stars > 0 ? stars / 10 : null,
        best_of: bestOf
      };
      await adminService.updateEncounter(encounter.id, encounterPayload);
    },
    onSuccess: async () => {
      notify.success(t("matchEdit.matchUpdated"));
      await refreshEncounterViews();
      onOpenChange(false);
    }
  });

  // Confirming takes the numbers currently on screen, so "fix the score and
  // confirm it" is one request instead of an edit racing a confirm.
  const confirmMutation = useMutation({
    mutationFn: () =>
      adminService.setEncounterResult(encounter.id, {
        home_score: homeScore,
        away_score: awayScore,
        ...(stars > 0 ? { closeness: stars } : {})
      }),
    onSuccess: async () => {
      notify.success(t("matchEdit.resultConfirmed"));
      await refreshEncounterViews();
      onOpenChange(false);
    },
    onError: (error) => {
      notify.apiError(error, { title: t("matchEdit.confirmErrorMessage") });
    }
  });

  const reopenMutation = useMutation({
    mutationFn: () => adminService.reopenEncounterResult(encounter.id),
    onSuccess: async () => {
      notify.success(t("matchEdit.resultReopened"));
      await refreshEncounterViews();
      onOpenChange(false);
    },
    onError: (error) => {
      notify.apiError(error, { title: t("matchEdit.reopenErrorMessage") });
    }
  });

  return (
    <DialogContent className="max-w-md">
      <DialogHeader className="space-y-1">
        <DialogTitle className="flex items-center gap-2 text-[color:var(--aqt-fg)] text-lg font-bold tracking-tight">
          {t("matchEdit.title")}
          {encounter.result_status === "pending_confirmation" && (
            <Badge className="border-0 bg-warning text-warning-foreground">
              {t("matchEdit.pendingConfirmation")}
            </Badge>
          )}
          {encounter.result_status === "disputed" && (
            <Badge className="border-0 bg-destructive text-destructive-foreground">{t("matchEdit.disputed")}</Badge>
          )}
        </DialogTitle>
        <DialogDescription className="text-[color:var(--aqt-fg-muted)] text-sm font-semibold mt-1">
          {encounter.home_team?.name} vs {encounter.away_team?.name}
        </DialogDescription>
      </DialogHeader>

      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 mt-2">
        <EncounterScoreControls
          idPrefix={`encounter-edit-${encounter.id}`}
          homeScore={homeScore}
          awayScore={awayScore}
          homeLabel={homeTeamLabel}
          awayLabel={awayTeamLabel}
          bestOf={bestOf}
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

        <div className="space-y-1.5">
          <Label className="text-[13px] font-bold text-[color:var(--aqt-fg-muted)]">{t("matchEdit.bestOf")}</Label>
          <Select value={String(bestOf)} onValueChange={(value) => setBestOf(Number(value))}>
            <SelectTrigger className="w-full rounded-lg border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-2)] font-semibold text-[color:var(--aqt-fg)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BEST_OF_OPTIONS.map((n) => (
                <SelectItem
                  key={n}
                  value={String(n)}
                  className="cursor-pointer"
                >
                  {`BO${n}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[13px] font-bold text-[color:var(--aqt-fg-muted)]">{t("matchEdit.status")}</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full rounded-lg border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-2)] font-semibold text-[color:var(--aqt-fg)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENCOUNTER_STATUSES.map((item) => (
                <SelectItem
                  key={item}
                  value={item}
                  className="cursor-pointer"
                >
                  {t(`matchEdit.statuses.${item}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[13px] font-bold text-[color:var(--aqt-fg-muted)]">
            {t("matchEdit.matchCloseness")}
          </Label>
          <div className="flex items-center gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setStars(n === stars ? 0 : n)}
                aria-pressed={n <= stars}
                aria-label={t("matchEdit.starsAria", { count: n })}
                className="rounded p-0.5 transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <Star
                  aria-hidden
                  className={cn(
                    "h-5 w-5 transition-colors duration-150",
                    n <= stars
                      ? "fill-[color:var(--aqt-gold)] text-[color:var(--aqt-gold)]"
                      : "text-[color:var(--aqt-fg-faint)]"
                  )}
                />
              </button>
            ))}
            <span className="ml-2 text-xs font-bold text-[color:var(--aqt-fg-muted)]">
              {stars > 0 ? `${stars}/10` : t("matchEdit.notSet")}
            </span>
          </div>
          <p className="text-[11px] text-[color:var(--aqt-fg-dim)] font-medium leading-normal mt-1">
            {t("matchEdit.closenessHint")}
          </p>
        </div>

        {(reportsQuery.data?.reports?.length ?? 0) > 0 && (
          <CaptainReportsView
            encounter={encounter}
            reports={reportsQuery.data?.reports ?? []}
            form={reportsQuery.data?.form}
          />
        )}

        {validationError && <p className="text-sm text-destructive font-semibold">{validationError}</p>}
      </div>

      <DialogFooter className="mt-6 flex flex-row items-center justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => onOpenChange(false)}
          className="h-10 px-5 font-semibold"
        >
          {t("matchEdit.cancel")}
        </Button>
        {encounter.result_status === "confirmed" ? (
          <Button
            variant="secondary"
            onClick={() => reopenMutation.mutate()}
            disabled={reopenMutation.isPending}
            className="h-10 px-5 font-semibold"
          >
            {reopenMutation.isPending ? t("matchEdit.reopening") : t("matchEdit.reopenResult")}
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={() => confirmMutation.mutate()}
            disabled={confirmMutation.isPending}
            className="h-10 px-5 font-semibold"
          >
            {confirmMutation.isPending ? t("matchEdit.confirming") : t("matchEdit.confirmResult")}
          </Button>
        )}
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!!validationError || saveMutation.isPending}
          className="h-10 px-5 font-bold"
        >
          {saveMutation.isPending ? t("matchEdit.saving") : t("matchEdit.save")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
