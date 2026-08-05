"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import { tournamentQueryKeys } from "@/lib/tournament-query-keys";
import draftService from "@/services/draft.service";

import { useHubTournamentQuery } from "../hubQueries";

import { AdminControlRoom } from "./draft/AdminControlRoom";
import { DraftSetupWizard } from "./draft/DraftSetupWizard";

interface DraftSessionDashboardProps {
  tournamentId: number;
  canManage: boolean;
}

export function DraftSessionDashboard({ tournamentId, canManage }: DraftSessionDashboardProps) {
  const t = useTranslations("draftAdmin");
  const queryClient = useQueryClient();
  const boardKey = tournamentQueryKeys.draftBoard(tournamentId);
  const boardQuery = useQuery({
    queryKey: boardKey,
    queryFn: () => draftService.getTournamentBoard(tournamentId),
    enabled: Number.isFinite(tournamentId) && tournamentId > 0
  });
  const tournamentQuery = useHubTournamentQuery(tournamentId);
  const board = boardQuery.data ?? null;
  const session = board?.session ?? null;

  const lifecycleMutation = useMutation({
    mutationFn: (action: "pause" | "resume" | "cancel" | "export") =>
      draftService.lifecycle(tournamentId, session!.id, action),
    onSuccess: async (_result, action) => {
      notify.success(t("lifecycleSuccess", { action: t(`actions.${action}`) }));
      await queryClient.invalidateQueries({ queryKey: boardKey });
    },
    onError: (error) => notify.apiError(error)
  });

  // A draft cannot be configured without the tournament's roster shape: the
  // wizard reads rounds and roster size off it instead of deriving them.
  const rosterShape = tournamentQuery.data?.roster_shape ?? null;
  if (boardQuery.isLoading || tournamentQuery.isLoading) {
    return <div className="h-64 animate-pulse rounded-2xl bg-muted/50" />;
  }
  if (boardQuery.isError || tournamentQuery.isError || rosterShape == null) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-destructive/40 px-4 py-3 text-sm text-muted-foreground">
        <span className="min-w-0">
          <span className="font-medium text-foreground">{t("loadFailed")}</span>{" "}
          {t("loadFailedHint")}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void boardQuery.refetch();
            void tournamentQuery.refetch();
          }}
        >
          {t("retry")}
        </Button>
      </div>
    );
  }
  if (!canManage) {
    return (
      <p className="rounded-lg border border-dashed border-border/70 px-4 py-3 text-sm text-muted-foreground">
        {t("noPermission")}
      </p>
    );
  }

  if (board && session && (session.status === "live" || session.status === "paused")) {
    return <AdminControlRoom tournamentId={tournamentId} board={board} />;
  }

  const terminalSession =
    session && (session.status === "completed" || session.status === "cancelled") ? session : null;
  return (
    <div className="space-y-4">
      {terminalSession && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              {t("previousDraft")}
              <Badge variant="secondary">{t(`statuses.${terminalSession.status}`)}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t("previousDraftHint")}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/draft/${tournamentId}`} target="_blank">
                {t("openBoard")}
              </Link>
            </Button>
            {terminalSession.status === "completed" && (
              <Button
                size="sm"
                disabled={lifecycleMutation.isPending}
                onClick={() => lifecycleMutation.mutate("export")}
              >
                {t("actions.export")}
              </Button>
            )}
          </div>
        </div>
      )}
      <DraftSetupWizard
        tournamentId={tournamentId}
        board={terminalSession ? null : board}
        rosterShape={rosterShape}
      />
    </div>
  );
}
