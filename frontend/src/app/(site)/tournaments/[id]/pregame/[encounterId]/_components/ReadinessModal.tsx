"use client";

import { Loader2, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface ReadinessModalProps {
  readiness: { home: boolean; away: boolean };
  viewerSide: "home" | "away" | null;
  pending: boolean;
  onReady: () => void;
}

/**
 * Gates the pregame room's captain-readiness step as an overlay instead of a
 * full-page replacement: the room behind it (header, phase list, a skeleton
 * of the pool that's about to load) is already visible, which reads truer
 * than a bare "come back later" card -- the room *is* open, it's just
 * waiting on both captains. Controlled `open` with no `onOpenChange`: same
 * as `ElectOpenerDialog`'s `AlertDialog`, it does not close on its own until
 * the readiness gate itself clears (both sides ready -> the parent stops
 * rendering it once the session appears).
 */
export function ReadinessModal({ readiness, viewerSide, pending, onReady }: ReadinessModalProps) {
  const t = useTranslations("pickBan.room");
  const viewerReady = viewerSide != null && readiness[viewerSide];

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-[color:var(--aqt-teal)]" aria-hidden />
            {t("notReadyTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>{t("notReadyHint")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {viewerSide != null ? (
            viewerReady ? (
              <span className="text-sm font-medium text-[color:var(--aqt-support)]">
                {t("ready.confirmed")} · {t("ready.waitingOpponent")}
              </span>
            ) : (
              <Button onClick={onReady} disabled={pending}>
                {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
                {pending ? t("ready.sending") : t("ready.button")}
              </Button>
            )
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
