"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";

import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { notify } from "@/lib/notify";
import {
  TOURNAMENT_PHASES,
  VALID_TRANSITIONS
} from "@/lib/tournament/lifecycle";
import adminService from "@/services/admin.service";
import type { Tournament, TournamentStatus } from "@/types/tournament.types";
import { invalidateTournamentWorkspace } from "@/lib/tournament/workspace-query-keys";

/**
 * The hub header's one action: a "Change status" menu.
 *
 * The header pill is the status readout, so this control does not restate it:
 * it lists only where the tournament can go. Every `tournament.update` holder
 * gets the transitions the state machine allows; a superuser additionally gets
 * every other status, sent with `force`, and the finished flag. Picking a
 * status asks for confirmation (a status change moves the public page).
 * Nothing to offer means no menu at all.
 */
export function TournamentStatusControl({
  tournament,
  canUpdate,
  isSuperuser
}: Readonly<{
  tournament: Tournament;
  /** `tournament.update`, the grant the status RPC checks. */
  canUpdate: boolean;
  isSuperuser: boolean;
}>) {
  const t = useTranslations("adminTournament.status");
  const tActions = useTranslations("adminTournament.hubActions");
  const tStatus = useTranslations("common.statusBadge");
  const queryClient = useQueryClient();
  const [pendingStatus, setPendingStatus] = useState<TournamentStatus | null>(null);

  const allowed = VALID_TRANSITIONS[tournament.status];
  const options = canUpdate
    ? TOURNAMENT_PHASES.filter(
        (status) => status !== tournament.status && (isSuperuser || allowed.includes(status))
      )
    : [];
  const canToggleFinished = canUpdate && isSuperuser;

  // Failures surface through the global MutationCache toast.
  const mutation = useMutation({
    mutationFn: (status: TournamentStatus) =>
      adminService.transitionTournamentStatus(tournament.id, {
        status,
        force: !allowed.includes(status)
      }),
    onSuccess: () => {
      setPendingStatus(null);
      invalidateTournamentWorkspace(queryClient, tournament.id);
    }
  });

  const toggleFinishedMutation = useMutation({
    mutationFn: () => adminService.toggleTournamentFinished(tournament.id),
    onSuccess: () => {
      invalidateTournamentWorkspace(queryClient, tournament.id);
      notify.success(tournament.is_finished ? tActions("reopened") : tActions("finished"));
    }
  });

  if (options.length === 0 && !canToggleFinished) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            {t("menu")}
            <ChevronDown className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {options.map((status) => (
            <DropdownMenuItem key={status} onSelect={() => setPendingStatus(status)}>
              {tStatus(status)}
            </DropdownMenuItem>
          ))}
          {canToggleFinished ? (
            <>
              {options.length > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                disabled={toggleFinishedMutation.isPending}
                onSelect={() => toggleFinishedMutation.mutate()}
              >
                {tournament.is_finished ? tActions("reopen") : tActions("markFinished")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={pendingStatus !== null}
        onOpenChange={(open) => (open ? undefined : setPendingStatus(null))}
        intent={{
          title: pendingStatus
            ? t("setTo", { status: tStatus(pendingStatus) })
            : t("change"),
          description:
            pendingStatus && !allowed.includes(pendingStatus)
              ? t("bypass", { current: tStatus(tournament.status), next: tStatus(pendingStatus) })
              : t("manual"),
          confirmLabel: pendingStatus
            ? t("set", { status: tStatus(pendingStatus) })
            : t("setStatus"),
          tone: pendingStatus && !allowed.includes(pendingStatus) ? "warning" : "neutral"
        }}
        pending={mutation.isPending}
        onConfirm={() => {
          if (pendingStatus) mutation.mutate(pendingStatus);
        }}
      />
    </>
  );
}
