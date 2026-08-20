"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { MatchReportForm, matchReportDraftKey } from "@/components/tournaments/MatchReportForm";
import type { Encounter } from "@/types/encounter.types";

interface MatchReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  encounter: Encounter;
}

/**
 * The series report as a modal, for the bracket and the encounter page. The
 * form itself is `MatchReportForm`, which the pre-game room mounts inline as
 * the last step of its loop — this file is only the shell.
 */
export function MatchReportDialog({ open, onOpenChange, encounter }: Readonly<MatchReportDialogProps>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <MatchReportDialogBody encounter={encounter} onOpenChange={onOpenChange} /> : null}
    </Dialog>
  );
}

function MatchReportDialogBody({
  encounter,
  onOpenChange
}: Readonly<Omit<MatchReportDialogProps, "open">>) {
  const t = useTranslations();

  // Reachable only from stale data — the callers hide the report action on a
  // confirmed result — so this states the reason instead of offering a form the
  // server would refuse.
  if (encounter.result_status === "confirmed") {
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
          <Button onClick={() => onOpenChange(false)} className="h-10 px-5 font-bold">
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

      <MatchReportForm
        key={matchReportDraftKey(encounter)}
        encounter={encounter}
        onSubmitted={() => onOpenChange(false)}
        fieldsClassName="max-h-[70vh] overflow-y-auto pr-1 mt-2"
        cancelAction={
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-10 px-5 font-semibold"
          >
            {t("matchEdit.cancel")}
          </Button>
        }
      />
    </DialogContent>
  );
}
