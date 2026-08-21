"use client";

import { useQuery } from "@tanstack/react-query";
import { UsersRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAuthProfile } from "@/hooks/useAuthProfile";
import { ROLES, type RoleCode } from "@/lib/roles";
import { isRoleSlotCode } from "@/lib/roster-shape";
import { isRegistrationOpen } from "@/lib/tournament-status";
import { tournamentQueryKeys } from "@/lib/tournament-query-keys";
import registrationService from "@/services/registration.service";
import registrationTeamService from "@/services/registration-team.service";
import type { Tournament } from "@/types/tournament.types";

import MyTeamPanel from "./MyTeamPanel";
import TeamRegistrationWizard from "./TeamRegistrationWizard";

/**
 * The viewer's own position in team registration: either "register a team" or the
 * roster-management panel for the team they are already on.
 *
 * Self-contained so the Teams tab hosts it with one line. It reuses the two query
 * keys the rest of the page already uses, so TanStack serves the roster read from
 * the same cache entry rather than issuing a second request.
 */
export default function MyTeamSection({ tournament }: Readonly<{ tournament: Tournament }>) {
  const t = useTranslations("registrationTeams");
  const { status: authStatus, user } = useAuthProfile();
  // Same derivation TournamentRegisterButton uses: the hook exposes a status, not
  // a boolean, and `authenticated` alone can still carry an undefined profile.
  const isAuthenticated = authStatus === "authenticated" && user != null;
  const [createOpen, setCreateOpen] = useState(false);

  const open = isRegistrationOpen(tournament);

  const myRegQuery = useQuery({
    queryKey: tournamentQueryKeys.registration(tournament.workspace_id, tournament.id),
    queryFn: () => registrationService.getMyRegistration(tournament.id),
    enabled: isAuthenticated,
  });
  const formQuery = useQuery({
    queryKey: tournamentQueryKeys.registrationForm(tournament.workspace_id, tournament.id),
    queryFn: () => registrationService.getForm(tournament.id),
    enabled: isAuthenticated && open,
  });
  const teamsQuery = useQuery({
    queryKey: tournamentQueryKeys.registrationTeams(tournament.workspace_id, tournament.id),
    queryFn: () => registrationTeamService.listPublic(tournament.id),
    enabled: isAuthenticated,
  });

  if (!isAuthenticated) return null;

  const myRegistration = myRegQuery.data ?? null;
  const brief = myRegistration?.team ?? null;

  // The brief names the team; the full row carries the roster, the open slots and
  // the invites the captain needs. The public list omits invites, so a captain
  // sees their own outstanding offers only after the roster read lands here —
  // which is the same request the tab already made.
  const myTeam = brief ? (teamsQuery.data?.items.find((team) => team.id === brief.id) ?? null) : null;

  if (myTeam) {
    return (
      <MyTeamPanel
        workspaceId={tournament.workspace_id}
        tournamentId={tournament.id}
        team={myTeam}
        isCaptain={brief?.is_captain ?? false}
      />
    );
  }

  // Registration closed, or the form is not loaded yet: nothing to say.
  if (!open || !formQuery.data) return null;

  // A live solo registration blocks founding a team — the server answers
  // `already_registered`, and a withdrawn registration cannot be resubmitted, so
  // this is a genuine dead end. Say so. Returning null here (the first version)
  // left the user staring at "TEAMS 0 registered" with no explanation and no
  // action, which is the same §12.5 failure this feature exists to avoid.
  if (myRegistration) {
    return (
      <p className="rounded-lg border border-[color:var(--aqt-border)] bg-muted/20 px-3 py-2 text-sm text-[color:var(--aqt-fg-muted)]">
        {t("create.blockedBySolo")}
      </p>
    );
  }

  /**
   * Slots the captain may occupy. Derived from the tournament's roster override
   * when it has one, because the server rejects a slot the shape does not define
   * (`slot_not_in_shape`). A role-less (all-`flex`) roster yields none, and the
   * captain flow is not offered — that shape needs a slot picker this UI does not
   * have yet.
   */
  const override = tournament.roster_slots_json ?? null;
  const availableSlots: RoleCode[] = override
    ? ROLES.filter((role) => (override[role.code] ?? 0) > 0).map((role) => role.code)
    : ROLES.map((role) => role.code);
  const rosterIsRoleLess = override != null && availableSlots.length === 0;
  if (rosterIsRoleLess || !availableSlots.every(isRoleSlotCode)) return null;

  return (
    <>
      <Button type="button" onClick={() => setCreateOpen(true)}>
        <UsersRound className="size-4" aria-hidden />
        {t("create.action")}
      </Button>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-2xl lg:max-w-3xl">
          <DialogTitle>{t("create.title")}</DialogTitle>
          <TeamRegistrationWizard
            workspaceId={tournament.workspace_id}
            tournamentId={tournament.id}
            tournamentName={tournament.name}
            form={formQuery.data}
            availableSlots={availableSlots}
            onClose={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
