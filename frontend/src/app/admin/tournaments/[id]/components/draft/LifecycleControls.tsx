"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";

import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import type { DraftBoard } from "@/types/draft.types";
import type { DraftLifecycleAction } from "@/hooks/useDraftData";
import { useDraftMutations } from "@/hooks/useDraftData";

interface LifecycleControlsProps {
  tournamentId: number;
  board: DraftBoard;
  /** The server refuses to resume while no feasible role assignment remains. */
  resumeBlocked?: boolean;
}

type ConfirmedAction = Extract<DraftLifecycleAction, "rollback" | "cancel" | "export"> | "autopick";

/**
 * The control room's lifecycle actions: pause and resume fire at once (both
 * are reversible); the ones that END or REWIND a session sit behind a confirm.
 *
 * Extra time and override steer a pick in flight and stay in the draft room's
 * admin dock, where the board they act on is visible.
 */
export function LifecycleControls({ tournamentId, board, resumeBlocked = false }: Readonly<LifecycleControlsProps>) {
  const t = useTranslations("draftAdmin.controlRoom");
  const tDraft = useTranslations("draftAdmin");
  const resumeReasonId = useId();
  const mutations = useDraftMutations(tournamentId);
  const [confirmedAction, setConfirmedAction] = useState<ConfirmedAction | null>(null);
  const session = board.session;
  const currentPick = board.current_pick;
  const resolvedCount = board.picks.filter((pick) =>
    ["completed", "autopicked", "skipped"].includes(pick.status)
  ).length;

  const toggleClock = () => {
    const action = session.status === "paused" ? "resume" : "pause";
    mutations.lifecycle.mutate(
      { sessionId: session.id, action },
      {
        onSuccess: () => notify.success(tDraft("lifecycleSuccess", { action: tDraft(`actions.${action}`) })),
        onError: (error) => notify.apiError(error)
      }
    );
  };

  const runConfirmed = () => {
    const action = confirmedAction;
    if (!action) return;
    if (action === "autopick") {
      if (!currentPick) return;
      mutations.autopick.mutate(
        { pickId: currentPick.id, version: currentPick.version },
        {
          onSuccess: () => {
            notify.success(t("actionSuccess.autopick"));
            setConfirmedAction(null);
          },
          onError: (error) => notify.apiError(error)
        }
      );
      return;
    }
    mutations.lifecycle.mutate(
      { sessionId: session.id, action },
      {
        onSuccess: (result) => {
          const advisories = "advisories" in result ? result.advisories : [];
          const showResult = advisories.length ? notify.warning : notify.success;
          showResult(t(`actionSuccess.${action}`), {
            description: advisories.join("\n"),
            duration: advisories.length ? Infinity : undefined,
            classNames: { description: "whitespace-pre-line" }
          });
          setConfirmedAction(null);
        },
        onError: (error) => notify.apiError(error)
      }
    );
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {session.status === "live" && (
          <Button variant="outline" disabled={mutations.lifecycle.isPending} onClick={toggleClock}>
            {tDraft("actions.pause")}
          </Button>
        )}
        {session.status === "paused" && (
          <Button
            disabled={resumeBlocked || mutations.lifecycle.isPending}
            aria-describedby={resumeBlocked ? resumeReasonId : undefined}
            onClick={toggleClock}
          >
            {tDraft("actions.resume")}
          </Button>
        )}
        {session.status === "live" && currentPick && (
          <Button variant="outline" onClick={() => setConfirmedAction("autopick")}>
            {t("actions.autopick")}
          </Button>
        )}
        {resolvedCount > 0 && ["live", "paused", "completed"].includes(session.status) && (
          <Button variant="outline" onClick={() => setConfirmedAction("rollback")}>
            {t("actions.rollback")}
          </Button>
        )}
        {["live", "paused", "ready"].includes(session.status) && (
          <Button variant="destructive" onClick={() => setConfirmedAction("cancel")}>
            {t("actions.cancel")}
          </Button>
        )}
        {session.status === "completed" && (
          <Button onClick={() => setConfirmedAction("export")}>{t("actions.export")}</Button>
        )}
        {session.status === "paused" && resumeBlocked && (
          <p id={resumeReasonId} className="basis-full text-caption text-muted-foreground">
            {t("resumeBlocked")}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={confirmedAction != null}
        onOpenChange={(open) => !open && setConfirmedAction(null)}
        intent={{
          title: confirmedAction ? t(`confirm.${confirmedAction}.title`) : "",
          description: confirmedAction ? t(`confirm.${confirmedAction}.description`) : "",
          confirmLabel: confirmedAction ? t(`actions.${confirmedAction}`) : "",
          tone: confirmedAction === "cancel" ? "danger" : "warning"
        }}
        pending={mutations.lifecycle.isPending || mutations.autopick.isPending}
        onConfirm={runConfirmed}
      />
    </>
  );
}
