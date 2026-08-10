"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { notify } from "@/lib/notify";
import pickBanService from "@/services/pickBan.service";

interface MapReportDialogProps {
  encounterId: number;
  mapId: number;
  mapName: string;
  /** The captain's own team side — decides which score field is "yours". */
  side: "home" | "away";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The captain's own report, when they already filed one — this is an edit. */
  filed?: { home_score: number; away_score: number } | null;
  /** Query keys to invalidate once the report lands (encounter + pick-ban state). */
  invalidateKeys: unknown[][];
}

/**
 * Per-map result confirmation: each captain reports their own team's score for
 * ONE map independently. Agreement resolves the map immediately (advances any
 * pick-ban round waiting on it); disagreement leaves both reports standing for
 * an admin (see `map_report.submit_map_report`).
 */
export function MapReportDialog({
  encounterId,
  mapId,
  mapName,
  side,
  open,
  onOpenChange,
  filed = null,
  invalidateKeys,
}: MapReportDialogProps) {
  const t = useTranslations("pickBan.room.mapReport");
  const queryClient = useQueryClient();
  // The dialog is mounted on demand, so seeding state is enough to reopen an
  // already-filed report as an edit rather than a blank form.
  const [yourScore, setYourScore] = useState(filed == null ? 0 : side === "home" ? filed.home_score : filed.away_score);
  const [opponentScore, setOpponentScore] = useState(
    filed == null ? 0 : side === "home" ? filed.away_score : filed.home_score,
  );

  const mutation = useMutation({
    mutationFn: () =>
      pickBanService.reportMap(encounterId, mapId, {
        home_score: side === "home" ? yourScore : opponentScore,
        away_score: side === "home" ? opponentScore : yourScore,
      }),
    onSuccess: (result) => {
      if (result.disputed) {
        notify.error(t("disputed"), { description: t("disputedHint") });
      } else if (!result.resolved) {
        notify.info(t("waitingOpponent"));
      } else {
        notify.success(t("resolved"));
      }
      onOpenChange(false);
    },
    onError: (error) => notify.apiError(error, { title: t("failed") }),
    onSettled: () => {
      for (const key of invalidateKeys) void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{mapName}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="map-report-your-score">{t("yourScore")}</Label>
            <NumberInput
              id="map-report-your-score"
              min={0}
              integer
              value={yourScore}
              onValueChange={(v) => setYourScore(v ?? 0)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="map-report-opponent-score">{t("opponentScore")}</Label>
            <NumberInput
              id="map-report-opponent-score"
              min={0}
              integer
              value={opponentScore}
              onValueChange={(v) => setOpponentScore(v ?? 0)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            {mutation.isPending ? t("sending") : t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
