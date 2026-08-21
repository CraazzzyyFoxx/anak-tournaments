"use client";

import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, FolderInput, Loader2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { usePermissions } from "@/hooks/usePermissions";
import { notify } from "@/lib/notify";
import { translateRegistrationTeamError } from "@/lib/registration-team-errors";
import { formatShortfall } from "@/lib/registration-team-shortfall";
import { ROSTER_SLOT_CODES } from "@/lib/roster-shape";
import { tournamentQueryKeys } from "@/lib/tournament-query-keys";
import registrationTeamService from "@/services/registration-team.service";
import type {
  RegistrationTeam,
  RegistrationTeamMember,
  RegistrationTeamStatus
} from "@/types/registration-team.types";
import { invalidateTournamentWorkspace } from "./tournamentWorkspace.queryKeys";

/**
 * Organizer view of the registered teams (§8 of the team-registration design).
 *
 * The reason this card exists is the shortfall: a captain's team enters the
 * tournament only with a full roster, so "who is still incomplete" is the one
 * question an organizer asks before formation closes — it is rendered per team
 * rather than hidden behind a status badge.
 *
 * Unlike the public roster this view also shows the invites, and it is the only
 * place that can reject a team or materialize the complete ones into
 * `tournament.team` (the export). Both are server-authorized; the buttons follow
 * the same permissions so a caller is not offered an action that will 403.
 */
const STATUS_VARIANT: Record<
  RegistrationTeamStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  forming: "secondary",
  complete: "default",
  rejected: "destructive",
  disbanded: "outline"
};

const EXPIRY_STAMP = {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
} as const;

function memberName(member: RegistrationTeamMember): string {
  return member.display_name ?? member.battle_tag ?? `#${member.registration_id}`;
}

export function RegistrationTeamsCard({
  tournamentId,
  workspaceId
}: Readonly<{
  tournamentId: number;
  workspaceId: number;
}>) {
  const t = useTranslations("registrationTeams");
  // Backend messages are English; every rejection here carries a machine code
  // and MUST go through the translator (§12.2).
  const tErr = useTranslations("registrationTeams.errors");
  const tSlot = useTranslations("rosterShape.slotCodes");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const { canAccessPermission } = usePermissions();

  const terminalToggleId = useId();
  const withdrawCheckboxId = useId();
  const [includeTerminal, setIncludeTerminal] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<RegistrationTeam | null>(null);
  const [withdrawMembers, setWithdrawMembers] = useState(true);
  // Kept after the toast expires: an organizer who looks away must still be able
  // to see which teams did not make it into the tournament (§12.5).
  const [skippedNames, setSkippedNames] = useState<string | null>(null);

  const canReject = canAccessPermission("team.update", workspaceId);
  const canExport = canAccessPermission("team.create", workspaceId);

  const teamsQuery = useQuery({
    queryKey: tournamentQueryKeys.registrationTeamsAdmin(
      workspaceId,
      tournamentId,
      includeTerminal
    ),
    queryFn: () => registrationTeamService.listAdmin(tournamentId, { includeTerminal })
  });

  /** Both admin variants plus the public roster: a reject or an export changes
   *  every one of them, and the two admin flags are separate cache entries. */
  const invalidateTeams = () => {
    for (const flag of [false, true]) {
      void queryClient.invalidateQueries({
        queryKey: tournamentQueryKeys.registrationTeamsAdmin(workspaceId, tournamentId, flag)
      });
    }
    void queryClient.invalidateQueries({
      queryKey: tournamentQueryKeys.registrationTeams(workspaceId, tournamentId)
    });
  };

  const rejectMutation = useMutation({
    mutationFn: (input: { teamId: number; withdrawMembers: boolean }) =>
      registrationTeamService.reject(tournamentId, input.teamId, {
        withdrawMembers: input.withdrawMembers
      }),
    onSuccess: () => {
      invalidateTeams();
      setRejectTarget(null);
      notify.success(t("admin.rejectSuccess"));
    },
    onError: (error) => notify.error(translateRegistrationTeamError(tErr, error))
  });

  const exportMutation = useMutation({
    // No team ids: every complete team goes.
    mutationFn: () => registrationTeamService.exportRegistered(tournamentId),
    onSuccess: (result) => {
      invalidateTeams();
      // The export writes `tournament.team` rows, which the bracket and the
      // public pages read.
      invalidateTournamentWorkspace(queryClient, tournamentId, workspaceId);

      const names = result.skipped.map((item) => item.name).join(", ");
      setSkippedNames(names || null);
      const description = names ? t("admin.exportSkipped", { names }) : undefined;

      if (result.imported_teams === 0) {
        notify.info(t("admin.exportNothing"), { description });
        return;
      }
      notify.success(t("admin.exportSuccess", { count: result.imported_teams }), { description });
    },
    onError: (error) => notify.error(translateRegistrationTeamError(tErr, error))
  });

  /** Slot codes are shared vocabulary; an unknown one renders raw rather than
   *  throwing on a missing message. */
  const slotLabel = (code: string | null): string => {
    const known = ROSTER_SLOT_CODES.find((candidate) => candidate === code);
    return known ? tSlot(known) : (code ?? "—");
  };

  const teams = teamsQuery.data?.items ?? [];
  const unassignedPlayers = teamsQuery.data?.unassigned_players ?? 0;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>{t("admin.title")}</CardTitle>
            <CardDescription>
              {t("list.count", { count: teamsQuery.data?.total ?? 0 })}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex shrink-0 items-center gap-2">
              <Switch
                id={terminalToggleId}
                checked={includeTerminal}
                onCheckedChange={setIncludeTerminal}
              />
              <Label htmlFor={terminalToggleId} className="cursor-pointer text-sm font-normal">
                {t("admin.includeTerminal")}
              </Label>
            </div>
            {canExport && (
              <Button
                type="button"
                disabled={exportMutation.isPending}
                onClick={() => exportMutation.mutate()}
              >
                {exportMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <FolderInput className="mr-2 h-4 w-4" aria-hidden />
                )}
                {t("admin.export")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* The export materializes registered TEAMS. A player on no team is
              invisible to it, and on a team-registration tournament neither the
              balancer nor the draft runs either — so they silently never become a
              tournament.player. Before pressing export is the only moment this is
              still cheap to fix, which is why the warning sits above the button's
              own results rather than in the toast. */}
          {unassignedPlayers > 0 && (
            <Alert>
              <AlertDescription>
                {t("admin.unassigned", { count: unassignedPlayers })}
              </AlertDescription>
            </Alert>
          )}

          {skippedNames && (
            <Alert variant="destructive">
              <AlertDescription>
                {t("admin.exportSkipped", { names: skippedNames })}
              </AlertDescription>
            </Alert>
          )}

          {teamsQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-24 w-full rounded-lg" />
            </div>
          ) : teams.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("list.empty")}</p>
          ) : (
            teams.map((team) => (
              <div key={team.id} className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{team.name}</span>
                    <Badge variant={STATUS_VARIANT[team.status]}>{t(`status.${team.status}`)}</Badge>
                    {team.exported_team_id != null && (
                      <Badge variant="outline">{tCommon("rostered")}</Badge>
                    )}
                  </div>
                  {canReject &&
                    team.exported_team_id == null &&
                    (team.status === "forming" || team.status === "complete") && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setWithdrawMembers(true);
                          setRejectTarget(team);
                        }}
                      >
                        <Ban className="mr-2 h-4 w-4" aria-hidden />
                        {t("admin.reject")}
                      </Button>
                    )}
                </div>

                {/* The whole point of the card: what is still missing. */}
                {team.is_complete ? (
                  <p className="text-sm font-medium text-success">{t("list.complete")}</p>
                ) : (
                  <p className="text-sm font-medium text-warning">
                    {t("list.shortfall", { slots: formatShortfall(team.open_slots, tSlot) })}
                  </p>
                )}

                {team.members.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {team.members.map((member) => (
                      <li
                        key={member.registration_id}
                        className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs"
                      >
                        <span className="font-medium">{memberName(member)}</span>
                        <span className="text-muted-foreground">{slotLabel(member.slot_code)}</span>
                        {member.is_captain && (
                          <Badge variant="secondary">{t("member.captain")}</Badge>
                        )}
                        {member.is_substitute && (
                          <Badge variant="outline">{t("member.substitute")}</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {team.max_substitutes > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t("list.substitutes", {
                      used: team.substitutes_used,
                      max: team.max_substitutes
                    })}
                  </p>
                )}

                {team.invites.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("invite.pendingEmpty")}</p>
                ) : (
                  <ul className="space-y-1">
                    {team.invites.map((invite) => (
                      <li key={invite.id} className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant={invite.state === "pending" ? "secondary" : "outline"}>
                          {t(`inviteState.${invite.state}`)}
                        </Badge>
                        <span className="text-muted-foreground">{slotLabel(invite.slot_code)}</span>
                        <span className="text-muted-foreground">
                          {invite.target_battle_tag
                            ? t("invite.targetLabel", { name: invite.target_battle_tag })
                            : t("invite.linkLabel")}
                        </span>
                        {invite.is_substitute && (
                          <span className="text-muted-foreground">{t("member.substitute")}</span>
                        )}
                        {invite.expires_at && (
                          <span className="text-muted-foreground">
                            {t("invite.expiresAt", {
                              date: format.dateTime(new Date(invite.expires_at), EXPIRY_STAMP)
                            })}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={rejectTarget != null}
        onOpenChange={(open) => !open && setRejectTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin.rejectConfirm", { team: rejectTarget?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("admin.rejectWithdrawHint")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-start gap-2">
            <Checkbox
              id={withdrawCheckboxId}
              checked={withdrawMembers}
              onCheckedChange={(checked) => setWithdrawMembers(checked === true)}
            />
            <Label
              htmlFor={withdrawCheckboxId}
              className="cursor-pointer text-sm font-normal leading-snug"
            >
              {t("admin.rejectWithdraw")}
            </Label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rejectMutation.isPending}>
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={rejectMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!rejectTarget) return;
                rejectMutation.mutate({ teamId: rejectTarget.id, withdrawMembers });
              }}
            >
              {t("admin.reject")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
