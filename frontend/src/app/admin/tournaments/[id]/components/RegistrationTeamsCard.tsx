"use client";

import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, ChevronDown, FolderInput, Loader2, RotateCcw } from "lucide-react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { usePermissions } from "@/hooks/usePermissions";
import { notify } from "@/lib/notify";
import { translateRegistrationTeamError } from "@/lib/registration-team-errors";
import { formatShortfall } from "@/lib/registration-team-shortfall";
import { ROSTER_SLOT_CODES } from "@/lib/roster-shape";
import { tournamentQueryKeys } from "@/lib/tournament-query-keys";
import { cn } from "@/lib/utils";
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

/** The states the ledger names. Anything outside it renders raw: the server
 *  derives `expired` from a pending row past its clock and may add more, and an
 *  untranslated word beats a missing message path on screen. */
const HISTORY_STATES = ["pending", "accepted", "declined", "revoked", "expired"] as const;

function memberName(member: RegistrationTeamMember): string {
  return member.display_name ?? member.battle_tag ?? `#${member.registration_id}`;
}

/**
 * One team's whole invite ledger, organizer side.
 *
 * Collapsed and unfetched until asked for: the chips above already answer the
 * usual question, and this read exists for the rarer one — was that slot
 * refused, or did the link merely lapse. The chips cannot answer it because the
 * team read returns only LIVE invites (a terminal row there would hold a roster
 * slot open).
 *
 * Its own component because a hook cannot run inside the team loop, and
 * deliberately local to this file: the captain's side has a separate one, and
 * sharing would couple two surfaces that ship independently.
 */
function TeamInviteHistory({
  tournamentId,
  workspaceId,
  teamId,
  slotLabel
}: Readonly<{
  tournamentId: number;
  workspaceId: number;
  teamId: number;
  slotLabel: (code: string | null) => string;
}>) {
  const t = useTranslations("registrationTeams");
  const format = useFormatter();
  const [open, setOpen] = useState(false);

  const historyQuery = useQuery({
    queryKey: tournamentQueryKeys.registrationInviteHistory(workspaceId, teamId),
    queryFn: () => registrationTeamService.listInviteHistoryAdmin(tournamentId, teamId),
    // Nothing pays for the ledger until someone opens it.
    enabled: open
  });

  const history = historyQuery.data;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="flex h-auto w-full justify-between px-2 py-1.5 text-xs"
        >
          <span>{t("history.toggle")}</span>
          <ChevronDown
            aria-hidden
            className={cn("size-4 transition-transform", open && "rotate-180")}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1 pt-2">
        {historyQuery.isLoading ? (
          <Skeleton className="h-12 w-full rounded-md" />
        ) : (
          <>
            {history && (
              <p className="text-xs text-muted-foreground">
                {t("history.cap", { used: history.cap_used, limit: history.cap_limit })}
                {/* Without the reset date "12 of 60" reads as the team's whole
                    lifetime, which is exactly what it stops being once an
                    organizer forgives the count. */}
                {history.cap_reset_at && (
                  <span className="ml-2">
                    {t("history.capReset", {
                      date: format.dateTime(new Date(history.cap_reset_at), EXPIRY_STAMP)
                    })}
                  </span>
                )}
              </p>
            )}
            {history?.items.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("history.empty")}</p>
            ) : (
              <ul className="space-y-1">
                {history?.items.map((entry) => {
                  const known = HISTORY_STATES.find((candidate) => candidate === entry.state);
                  return (
                    <li key={entry.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant={entry.state === "accepted" ? "secondary" : "outline"}>
                        {known ? t(`history.state.${known}`) : entry.state}
                      </Badge>
                      <span className="text-muted-foreground">{slotLabel(entry.slot_code)}</span>
                      <span className="text-muted-foreground">
                        {entry.target_battle_tag
                          ? t("invite.targetLabel", { name: entry.target_battle_tag })
                          : t("invite.linkLabel")}
                      </span>
                      {entry.is_substitute && (
                        <span className="text-muted-foreground">{t("member.substitute")}</span>
                      )}
                      {entry.invited_at && (
                        <span className="text-muted-foreground">
                          {t("history.issued", {
                            date: format.dateTime(new Date(entry.invited_at), EXPIRY_STAMP)
                          })}
                        </span>
                      )}
                      {entry.answered_at && (
                        <span className="text-muted-foreground">
                          {t("history.answered", {
                            date: format.dateTime(new Date(entry.answered_at), EXPIRY_STAMP)
                          })}
                        </span>
                      )}
                      {/* Same `revoked` state, materially different event: staff
                          pulled the offer, the captain did not. */}
                      {entry.revoked_by_organizer && (
                        <span className="text-muted-foreground">{t("history.byOrganizer")}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
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
  const [resetTarget, setResetTarget] = useState<RegistrationTeam | null>(null);
  const [withdrawMembers, setWithdrawMembers] = useState(true);
  // Kept after the toast expires: an organizer who looks away must still be able
  // to see which teams did not make it into the tournament (§12.5).
  const [skippedNames, setSkippedNames] = useState<string | null>(null);

  const canManageTeams = canAccessPermission("team.update", workspaceId);
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

  /** A withdrawn invite leaves the live chips AND lands in the ledger as
   *  `revoked_by_organizer`; a cap reset moves the ledger's floor. Both reads go. */
  const invalidateTeamInvites = (teamId: number) => {
    invalidateTeams();
    void queryClient.invalidateQueries({
      queryKey: tournamentQueryKeys.registrationInviteHistory(workspaceId, teamId)
    });
  };

  const revokeInviteMutation = useMutation({
    mutationFn: (input: { teamId: number; inviteId: number }) =>
      registrationTeamService.revokeInviteAdmin(tournamentId, input.inviteId),
    onSuccess: (_result, input) => {
      invalidateTeamInvites(input.teamId);
      notify.success(t("admin.revokeInviteSuccess"));
    },
    onError: (error) => notify.error(translateRegistrationTeamError(tErr, error))
  });

  /**
   * The escape hatch for the total invite cap, which counts every invite the
   * team ever created — so an invite/revoke cycle burns the ceiling on invites
   * nobody can see any more, and the refusal it produces used to name an
   * organizer intervention that no endpoint provided. This is that intervention.
   */
  const resetCapMutation = useMutation({
    mutationFn: (team: RegistrationTeam) =>
      registrationTeamService.resetInviteCap(tournamentId, team.id),
    onSuccess: (_result, team) => {
      invalidateTeamInvites(team.id);
      setResetTarget(null);
      notify.success(t("admin.resetCapSuccess", { team: team.name }));
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
                  <div className="flex flex-wrap items-center gap-2">
                    {canManageTeams && team.exported_team_id == null && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={resetCapMutation.isPending}
                        onClick={() => setResetTarget(team)}
                      >
                        <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
                        {t("admin.resetCap")}
                      </Button>
                    )}
                    {canManageTeams &&
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
                        {/* An organizer reaching into someone else's roster. Its
                            own label and a destructive variant keep it from
                            reading like the captain's own "Revoke" — the two are
                            the same effect but not the same act, and the ledger
                            records which one happened. */}
                        {canManageTeams && invite.state === "pending" && (
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            disabled={revokeInviteMutation.isPending}
                            onClick={() =>
                              revokeInviteMutation.mutate({ teamId: team.id, inviteId: invite.id })
                            }
                          >
                            {t("admin.revokeInvite")}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <TeamInviteHistory
                  tournamentId={tournamentId}
                  workspaceId={workspaceId}
                  teamId={team.id}
                  slotLabel={slotLabel}
                />
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

      {/* The admin area's existing confirmation primitive, same as the reject
          above: a forgiven count cannot be un-forgiven. */}
      <AlertDialog open={resetTarget != null} onOpenChange={(open) => !open && setResetTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin.resetCapConfirm", { team: resetTarget?.name ?? "" })}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetCapMutation.isPending}>
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={resetCapMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!resetTarget) return;
                resetCapMutation.mutate(resetTarget);
              }}
            >
              {t("admin.resetCap")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
