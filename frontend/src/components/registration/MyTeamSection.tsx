"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { useAuthProfile } from "@/hooks/useAuthProfile";
import { isRegistrationOpen } from "@/lib/tournament-status";
import { tournamentQueryKeys } from "@/lib/tournament-query-keys";
import registrationService from "@/services/registration.service";
import registrationTeamService from "@/services/registration-team.service";
import type { Tournament } from "@/types/tournament.types";

import MyTeamPanel from "./MyTeamPanel";

/**
 * The viewer's own position in team registration: the roster-management panel for
 * the team they are on, or a line explaining why they cannot found one.
 *
 * Creating a team is NOT here — that button lives in the tournament header, in
 * `TeamRegistrationEntry`, beside the solo Register button so the two choices are
 * presented together.
 *
 * Reuses the query keys the rest of the page already uses, so TanStack serves the
 * roster read from the same cache entry rather than issuing a second request.
 */
export default function MyTeamSection({ tournament }: Readonly<{ tournament: Tournament }>) {
  const t = useTranslations("registrationTeams");
  const { status: authStatus, user } = useAuthProfile();
  // Same derivation TournamentRegisterButton uses: the hook exposes a status, not
  // a boolean, and `authenticated` alone can still carry an undefined profile.
  const isAuthenticated = authStatus === "authenticated" && user != null;

  const open = isRegistrationOpen(tournament);

  const myRegQuery = useQuery({
    queryKey: tournamentQueryKeys.registration(tournament.workspace_id, tournament.id),
    queryFn: () => registrationService.getMyRegistration(tournament.id),
    enabled: isAuthenticated,
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

  // Nothing to show: registration closed, or no registration to explain. The
  // "Register a team" button deliberately does NOT live here — it is in the
  // tournament header (`TeamRegistrationEntry`), beside the solo Register button,
  // so the two choices are presented together. Rendering it here too put two
  // identical buttons on one screen.
  if (!open || !myRegistration) return null;

  // A live solo registration means this player is a free agent: they cannot found
  // a team, but a captain CAN invite them, and accepting attaches the row they
  // already have. Returning null here (the first version) left them staring at
  // "TEAMS 0 registered" with no explanation — the §12.5 failure this feature
  // exists to avoid.
  return (
    <p className="rounded-lg border border-[color:var(--aqt-border)] bg-muted/20 px-3 py-2 text-sm text-[color:var(--aqt-fg-muted)]">
      {t("create.blockedBySolo")}
    </p>
  );
}
