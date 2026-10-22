"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, ChevronDown } from "lucide-react";

import { ConfirmDialog, type ConfirmIntent } from "@/components/kit/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { notify } from "@/lib/notify";
import {
  TOURNAMENT_PHASES,
  VALID_TRANSITIONS,
  phaseRank
} from "@/lib/tournament/lifecycle";
import adminService from "@/services/admin.service";
import type { Tournament, TournamentStatus } from "@/types/tournament.types";
import { invalidateTournamentWorkspace } from "@/lib/tournament/workspace-query-keys";
import { effectivePhases } from "../overview/effective-phases";

type Pending = { kind: "status"; status: TournamentStatus } | { kind: "finished" };

/**
 * The hub header's status actions (DESIGN.md §14 "Header actions").
 *
 * A primary `→ Next` button for the first forward transition the state machine
 * allows into one of this tournament's own phases (`effectivePhases`: no Draft
 * unless it forms teams by draft, no Archived — bookkeeping after the end, so
 * menu only); a "Change status" menu that shows
 * the current status checked, then the allowed transitions and, for a
 * superuser, every other status as a
 * labelled "Forced" group (sent with `force`); and the finished flag as its own
 * button, since it is a flag and not a pick from the status list. Everything
 * needs `tournament.update`, so without it nothing renders. Every action goes
 * through the one `ConfirmDialog` with a swapped intent.
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
  const [pending, setPending] = useState<Pending | null>(null);
  const allowedLabelId = useId();
  const forcedLabelId = useId();

  const current = tournament.status;
  const allowed = VALID_TRANSITIONS[current];
  const chain = effectivePhases({ teamFormation: tournament.team_formation }).map((phase) => phase.key);
  const next = allowed.find((status) => phaseRank(status) > phaseRank(current) && chain.includes(status));
  const allowedOptions = TOURNAMENT_PHASES.filter((status) => allowed.includes(status));
  const forcedOptions = isSuperuser
    ? TOURNAMENT_PHASES.filter((status) => status !== current && !allowed.includes(status))
    : [];

  // Failures surface through the global MutationCache toast.
  const mutation = useMutation({
    mutationFn: (status: TournamentStatus) =>
      adminService.transitionTournamentStatus(tournament.id, {
        status,
        force: !allowed.includes(status)
      }),
    onSuccess: () => {
      setPending(null);
      invalidateTournamentWorkspace(queryClient, tournament.id);
    }
  });

  const toggleFinishedMutation = useMutation({
    mutationFn: () => adminService.toggleTournamentFinished(tournament.id),
    onSuccess: () => {
      setPending(null);
      invalidateTournamentWorkspace(queryClient, tournament.id);
      notify.success(tournament.is_finished ? tActions("unfinished") : tActions("finished"));
    }
  });

  if (!canUpdate) return null;

  const finishLabel = tournament.is_finished ? tActions("markNotFinished") : tActions("markFinished");
  const pick = (status: TournamentStatus) => setPending({ kind: "status", status });

  let intent: ConfirmIntent;
  if (pending?.kind === "finished") {
    intent = tournament.is_finished
      ? {
          title: tActions("unfinishTitle"),
          description: tActions("unfinishDescription", { status: tStatus("live") }),
          confirmLabel: finishLabel,
          tone: "warning"
        }
      : {
          title: tActions("finishTitle"),
          description: tActions("finishDescription", { status: tStatus("completed") }),
          confirmLabel: finishLabel,
          tone: "neutral"
        };
  } else {
    const status = pending?.status;
    const forced = status !== undefined && !allowed.includes(status);
    intent = {
      title: status ? t("setTo", { status: tStatus(status) }) : t("change"),
      description: forced
        ? t("bypass", { current: tStatus(current), next: tStatus(status) })
        : t("manual"),
      confirmLabel: status ? t("set", { status: tStatus(status) }) : t("setStatus"),
      tone: forced ? "warning" : "neutral"
    };
  }

  return (
    <>
      {next ? (
        <Button size="sm" aria-label={t("advance", { status: tStatus(next) })} onClick={() => pick(next)}>
          <ArrowRight className="size-4" aria-hidden />
          {tStatus(next)}
        </Button>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            {t("menu")}
            <ChevronDown className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/* The current status, for orientation: checked, never a choice. */}
          <DropdownMenuCheckboxItem checked disabled className="data-[disabled]:opacity-100">
            {tStatus(current)}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup aria-labelledby={allowedLabelId}>
            <DropdownMenuLabel id={allowedLabelId} inset>
              {t("allowedGroup")}
            </DropdownMenuLabel>
            {allowedOptions.map((status) => (
              <DropdownMenuItem key={status} inset onSelect={() => pick(status)}>
                {tStatus(status)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          {forcedOptions.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup aria-labelledby={forcedLabelId}>
                <DropdownMenuLabel id={forcedLabelId} inset>
                  {t("forcedGroup")}
                </DropdownMenuLabel>
                {forcedOptions.map((status) => (
                  <DropdownMenuItem key={status} inset onSelect={() => pick(status)}>
                    <AlertTriangle className="text-warning" aria-hidden />
                    {tStatus(status)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {isSuperuser ? (
        <Button
          variant="outline"
          size="sm"
          disabled={toggleFinishedMutation.isPending}
          onClick={() => setPending({ kind: "finished" })}
        >
          {toggleFinishedMutation.isPending ? <Spinner /> : null}
          {finishLabel}
        </Button>
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => (open ? undefined : setPending(null))}
        intent={intent}
        pending={mutation.isPending || toggleFinishedMutation.isPending}
        onConfirm={() => {
          if (pending?.kind === "finished") toggleFinishedMutation.mutate();
          else if (pending) mutation.mutate(pending.status);
        }}
      />
    </>
  );
}
