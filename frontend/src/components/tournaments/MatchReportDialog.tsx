"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";

import { EncounterScoreControls } from "@/components/tournaments/EncounterScoreControls";
import { getApiErrorMessage, isResultLockedError } from "@/lib/api-error";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { useTranslations } from "next-intl";
import captainService, { type CaptainReportSubmitResult } from "@/services/captain.service";
import mapService from "@/services/map.service";
import { CaptainReportsView } from "@/components/tournaments/CaptainReportsView";
import { buildMapCodeSlots } from "@/components/tournaments/matchReportSlots";
import type { CaptainReport, Encounter } from "@/types/encounter.types";

interface MatchReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  encounter: Encounter;
}

const MATCH_QUALITY_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

type MatchQuality = (typeof MATCH_QUALITY_OPTIONS)[number];

function closenessFloatToStars(closeness: number | null | undefined): MatchQuality {
  if (closeness == null || closeness <= 0) return 6;
  return Math.max(1, Math.min(10, Math.round(closeness * 10))) as MatchQuality;
}

function clampCloseness(value: number): MatchQuality {
  return Math.max(1, Math.min(10, Math.round(value))) as MatchQuality;
}

export function MatchReportDialog({ open, onOpenChange, encounter }: MatchReportDialogProps) {
  const resetKey = [
    encounter.id,
    encounter.score?.home ?? 0,
    encounter.score?.away ?? 0,
    encounter.closeness ?? "none"
  ].join(":");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <MatchReportDialogBody key={resetKey} encounter={encounter} onOpenChange={onOpenChange} />
      ) : null}
    </Dialog>
  );
}

function findOwnReport(
  reports: CaptainReport[],
  side: "home" | "away" | null,
  encounter: Encounter
): CaptainReport | null {
  if (side) {
    const bySide = reports.find((report) => report.side === side);
    if (bySide) return bySide;
    const teamId = side === "home" ? encounter.home_team_id : encounter.away_team_id;
    return reports.find((report) => report.team_id === teamId) ?? null;
  }
  return null;
}

function MatchReportDialogBody({ encounter, onOpenChange }: Omit<MatchReportDialogProps, "open">) {
  const qc = useQueryClient();
  const t = useTranslations();
  const homeTeamLabel = encounter.home_team?.name?.trim() || t("common.homeTeam");
  const awayTeamLabel = encounter.away_team?.name?.trim() || t("common.awayTeam");
  const isConfirmed = encounter.result_status === "confirmed";

  // The form holds only what the captain has actually edited. Everything else is
  // DERIVED from the server data below, so there is nothing to copy in an effect
  // and nothing that can clobber typed input when a query resolves late.
  const [draft, setDraft] = useState<{
    homeScore?: number;
    awayScore?: number;
    closeness?: MatchQuality;
    codes?: Record<number, string>;
  }>({});

  const reportsQuery = useQuery({
    queryKey: ["encounter", encounter.id, "reports"],
    queryFn: () => captainService.getReports(encounter.id),
    enabled: !isConfirmed
  });
  const roleQuery = useQuery({
    queryKey: ["encounter", encounter.id, "my-role"],
    queryFn: () => captainService.getMyRole(encounter.id),
    enabled: !isConfirmed
  });
  const mapPoolQuery = useQuery({
    queryKey: ["encounter", encounter.id, "map-pool-state"],
    queryFn: () => captainService.getMapPoolState(encounter.id),
    enabled: !isConfirmed
  });
  const mapsQuery = useQuery({
    queryKey: ["maps-all"],
    queryFn: () => mapService.getAll({ perPage: -1 }),
    staleTime: 5 * 60 * 1000,
    enabled: !isConfirmed
  });

  const slots = useMemo(
    () => buildMapCodeSlots(mapPoolQuery.data, encounter.best_of),
    [mapPoolQuery.data, encounter.best_of]
  );

  const mapNameById = useMemo(() => {
    const lookup = new Map<number, string>();
    for (const map of mapsQuery.data?.results ?? []) {
      lookup.set(map.id, map.name);
    }
    return lookup;
  }, [mapsQuery.data]);

  const ownReport = useMemo(
    () => findOwnReport(reportsQuery.data ?? [], roleQuery.data?.side ?? null, encounter),
    [reportsQuery.data, roleQuery.data?.side, encounter]
  );

  // Effective form values: the captain's edit if there is one, else their own
  // saved report, else the encounter's current score. Previously this was an
  // effect that copied `ownReport` into four `useState`s behind a `seededRef`
  // guard — a cascading render plus a race the guard existed to paper over.
  const homeScore = draft.homeScore ?? ownReport?.home_score ?? encounter.score?.home ?? 0;
  const awayScore = draft.awayScore ?? ownReport?.away_score ?? encounter.score?.away ?? 0;
  const closeness =
    draft.closeness ??
    (ownReport ? clampCloseness(ownReport.closeness) : closenessFloatToStars(encounter.closeness));
  const codes =
    draft.codes ??
    Object.fromEntries(
      (ownReport?.map_codes ?? []).map((code) => [code.map_index, code.code])
    );

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

  const submitMutation = useMutation({
    mutationFn: () =>
      captainService.submitReport(encounter.id, {
        home_score: homeScore,
        away_score: awayScore,
        closeness,
        map_codes: slots
          .map((slot) => ({ map_index: slot.mapIndex, code: (codes[slot.mapIndex] ?? "").trim() }))
          .filter((entry) => entry.code.length > 0)
      }),
    onSuccess: async (result: CaptainReportSubmitResult) => {
      if (result.result_status === "confirmed") {
        notify.success(t("matchReport.autoConfirmed"));
      } else if (result.result_status === "disputed") {
        notify.error(t("matchReport.autoDisputed"));
      } else {
        notify.success(t("matchReport.submittedForConfirmation"));
      }
      await refreshEncounterViews();
      onOpenChange(false);
    },
    onError: async (error) => {
      if (isResultLockedError(error)) {
        notify.error(t("matchReport.confirmedLockedTitle"), {
          description: t("matchReport.confirmedLockedBody")
        });
        // Data was stale (result got confirmed after the dialog opened); refresh
        // so the report action disappears, then close.
        await refreshEncounterViews();
        onOpenChange(false);
        return;
      }
      notify.apiError(error, {
        title: t("matchReport.submitErrorMessage"),
        description: getApiErrorMessage(error)
      });
    }
  });

  if (isConfirmed) {
    return (
      <DialogContent className="max-w-md">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-[color:var(--aqt-fg)] text-lg font-bold tracking-tight">
            {t("matchReport.confirmedLockedTitle")}
          </DialogTitle>
          <DialogDescription className="text-[color:var(--aqt-fg-muted)] text-sm font-semibold mt-1">
            {t("matchReport.confirmedLockedBody")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-6 flex flex-row items-center justify-end gap-2">
          <Button
            onClick={() => onOpenChange(false)}
            className="h-10 px-5 font-bold"
          >
            {t("matchEdit.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader className="space-y-1">
        <DialogTitle className="text-[color:var(--aqt-fg)] text-lg font-bold tracking-tight">
          {t("matchReport.title")}
        </DialogTitle>
        <DialogDescription className="text-[color:var(--aqt-fg-muted)] text-sm font-semibold mt-1">
          {encounter.home_team?.name} vs {encounter.away_team?.name}
        </DialogDescription>
      </DialogHeader>

      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 mt-2">
        <EncounterScoreControls
          idPrefix={`match-report-${encounter.id}`}
          homeScore={homeScore}
          awayScore={awayScore}
          homeLabel={homeTeamLabel}
          awayLabel={awayTeamLabel}
          presetLabel={t("matchReport.quickResult")}
          bestOf={encounter.best_of}
          onScoreChange={(score) =>
            setDraft((prev) => ({
              ...prev,
              homeScore: score.homeScore,
              awayScore: score.awayScore
            }))
          }
        />

        <div className="space-y-3 rounded-xl border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-2)] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[color:var(--aqt-fg-dim)]">
                {t("matchReport.matchQuality")}
              </p>
              <p className="mt-0.5 text-[11px] font-medium text-[color:var(--aqt-fg-dim)]">
                {t("matchReport.howClose")}
              </p>
            </div>
            <div className="rounded-lg border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-3)] px-3.5 py-1 text-xs font-bold text-[color:var(--aqt-fg)]">
              {t(`matchReport.qualityDescriptions.${closeness}`)}
            </div>
          </div>

          <div className="grid grid-cols-5 gap-2">
            {MATCH_QUALITY_OPTIONS.map((val) => {
              const isSelected = val === closeness;

              return (
                <button
                  key={val}
                  type="button"
                  className={cn(
                    "flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg border px-1.5 py-1.5 text-center transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    isSelected
                      ? "border-[color:color-mix(in_srgb,var(--aqt-gold)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-gold)_12%,transparent)] text-[color:var(--aqt-gold)] hover:bg-[color:color-mix(in_srgb,var(--aqt-gold)_20%,transparent)]"
                      : "border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-2)] text-[color:var(--aqt-fg-muted)] hover:bg-[color:var(--aqt-overlay-3)] hover:text-[color:var(--aqt-fg)]"
                  )}
                  onClick={() => setDraft((prev) => ({ ...prev, closeness: val }))}
                  aria-pressed={isSelected}
                  aria-label={t("matchReport.qualityAria", {
                    score: String(val),
                    description: t(`matchReport.qualityDescriptions.${val}`)
                  })}
                >
                  <Star
                    aria-hidden
                    className={cn(
                      "h-4.5 w-4.5 transition-colors duration-150",
                      isSelected
                        ? "fill-[color:var(--aqt-gold)] text-[color:var(--aqt-gold)]"
                        : "text-[color:var(--aqt-fg-faint)]"
                    )}
                  />
                  <span className="text-[10.5px] font-bold font-mono">{val}/10</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-3 text-[11px] text-[color:var(--aqt-fg-dim)] font-medium pt-1">
            <span>{t("matchReport.qualityLegend.oneSided")}</span>
            <span>{t("matchReport.qualityLegend.toTheEnd")}</span>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-2)] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[color:var(--aqt-fg-dim)]">
            {t("matchReport.mapCodes")}
          </p>
          <div className="space-y-2">
            {slots.map((slot) => {
              const name = slot.mapId != null ? mapNameById.get(slot.mapId) : undefined;
              const label = name ?? t("matchReport.mapLabel", { index: String(slot.mapIndex) });

              return (
                <div key={slot.mapIndex} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-xs font-semibold text-[color:var(--aqt-fg-muted)]">
                    {label}
                  </span>
                  <Input
                    value={codes[slot.mapIndex] ?? ""}
                    maxLength={32}
                    placeholder={t("matchReport.mapCodePlaceholder")}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        codes: { ...codes, [slot.mapIndex]: e.target.value }
                      }))
                    }
                    className="h-9 border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-2)] font-mono text-sm text-[color:var(--aqt-fg)]"
                  />
                </div>
              );
            })}
          </div>
        </div>

        <CaptainReportsView encounter={encounter} reports={reportsQuery.data ?? []} />

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
        <Button
          onClick={() => submitMutation.mutate()}
          disabled={!!validationError || submitMutation.isPending}
          className="h-10 px-5 font-bold"
        >
          {submitMutation.isPending ? t("matchReport.submitting") : t("matchReport.submit")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
