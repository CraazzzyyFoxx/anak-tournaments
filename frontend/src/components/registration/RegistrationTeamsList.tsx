"use client";

import { useQuery } from "@tanstack/react-query";
import { Crown, LifeBuoy } from "lucide-react";
import { useTranslations } from "next-intl";

import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { Badge } from "@/components/ui/badge";
import { normalizePlayerRole } from "@/lib/player-role";
import { formatShortfall } from "@/lib/registration-team-shortfall";
import { tournamentQueryKeys } from "@/lib/tournament-query-keys";
import { cn } from "@/lib/utils";
import registrationTeamService from "@/services/registration-team.service";
import type {
  RegistrationTeam,
  RegistrationTeamMember,
  RegistrationTeamStatus
} from "@/types/registration-team.types";
import type { Tournament } from "@/types/tournament.types";

/**
 * One tint recipe per lifecycle state, written out literally because Tailwind
 * only emits arbitrary values it can see verbatim in the source.
 */
const STATUS_TONE: Record<RegistrationTeamStatus, string> = {
  forming:
    "border-[color:var(--aqt-amber)]/40 bg-[color:var(--aqt-amber)]/10 text-[color:var(--aqt-amber)]",
  complete:
    "border-[color:var(--aqt-teal)]/40 bg-[color:var(--aqt-teal)]/10 text-[color:var(--aqt-teal)]",
  rejected:
    "border-[color:var(--aqt-rose)]/40 bg-[color:var(--aqt-rose)]/10 text-[color:var(--aqt-rose)]",
  disbanded:
    "border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-2)] text-[color:var(--aqt-fg-dim)]"
};

function RosterRow({ member }: Readonly<{ member: RegistrationTeamMember }>) {
  const t = useTranslations();
  const role = member.slot_code ? normalizePlayerRole(member.slot_code) : null;

  return (
    <li className="flex items-center gap-2 text-sm">
      <PlayerRoleIcon role={role} size={16} decorative />
      <span className="min-w-0 flex-1 truncate text-[color:var(--aqt-fg)]">
        {member.display_name ?? member.battle_tag ?? "—"}
      </span>
      {member.is_captain ? (
        <span
          className="inline-flex items-center gap-1 text-xs text-[color:var(--aqt-gold)]"
          title={t("registrationTeams.member.captain")}
        >
          <Crown className="size-3.5" aria-hidden />
          <span className="sr-only">{t("registrationTeams.member.captain")}</span>
        </span>
      ) : null}
      {member.is_substitute ? (
        <span
          className="inline-flex items-center gap-1 text-xs text-[color:var(--aqt-fg-dim)]"
          title={t("registrationTeams.member.substitute")}
        >
          <LifeBuoy className="size-3.5" aria-hidden />
          <span className="sr-only">{t("registrationTeams.member.substitute")}</span>
        </span>
      ) : null}
    </li>
  );
}

function RegistrationTeamCard({ team }: Readonly<{ team: RegistrationTeam }>) {
  const t = useTranslations();
  const tSlot = useTranslations("rosterShape.slotCodes");
  // Starters before substitutes, captain first — the order a roster is read in.
  const roster = [...team.members].sort(
    (a, b) =>
      Number(a.is_substitute) - Number(b.is_substitute) ||
      Number(b.is_captain) - Number(a.is_captain)
  );

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-1)] p-4">
      <header className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 truncate font-onest text-base font-semibold text-[color:var(--aqt-fg)]">
          {team.name}
        </h3>
        <Badge variant="outline" className={cn("shrink-0", STATUS_TONE[team.status])}>
          {t(`registrationTeams.status.${team.status}`)}
        </Badge>
      </header>

      {/*
        Members only, never `team.invites`: the public endpoint omits them
        server-side precisely so the roster cannot leak who was asked and
        declined. Rendering them here would put that back.
      */}
      <ul className="flex flex-col gap-1.5">
        {roster.map((member) => (
          <RosterRow key={member.registration_id} member={member} />
        ))}
      </ul>

      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[color:var(--aqt-border)] pt-2 text-xs">
        <span
          className={
            team.is_complete
              ? "text-[color:var(--aqt-teal)]"
              : "text-[color:var(--aqt-fg-muted)]"
          }
        >
          {team.is_complete
            ? t("registrationTeams.list.complete")
            : t("registrationTeams.list.shortfall", { slots: formatShortfall(team.open_slots, tSlot) })}
        </span>
        {team.max_substitutes > 0 ? (
          <span className="text-[color:var(--aqt-fg-dim)]">
            {t("registrationTeams.list.substitutes", {
              used: team.substitutes_used,
              max: team.max_substitutes
            })}
          </span>
        ) : null}
      </footer>
    </article>
  );
}

/**
 * The registered teams of a tournament, as cards.
 *
 * Lives on the Participants page rather than behind its own tab. A dedicated tab
 * put three sections in one conceptual space (`Teams`, `Participants`,
 * `Registered teams`) and, worse, duplicated the `Teams` tab outright once the
 * organizer exported: both then listed the same teams. Participants is where you
 * already go to see who entered, so the team view belongs above that list.
 *
 * Renders nothing at all when there are no registered teams, so a solo tournament
 * — and a team tournament before anyone registers — pays no vertical space. The
 * page's own empty/error states cover the participant list; a second empty card
 * here would just be noise.
 */
export default function RegistrationTeamsList({
  tournament
}: Readonly<{ tournament: Tournament }>) {
  const t = useTranslations();
  const teamsQuery = useQuery({
    queryKey: tournamentQueryKeys.registrationTeams(tournament.workspace_id, tournament.id),
    queryFn: () => registrationTeamService.listPublic(tournament.id)
  });

  const teams = teamsQuery.data?.items ?? [];
  const freeAgents = teamsQuery.data?.unassigned_players ?? 0;
  // Nothing registered at all: stay silent. A free-agent count alone is still
  // worth showing, because it is what tells a captain there are people to recruit.
  if (teams.length === 0 && freeAgents === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-onest text-lg font-semibold text-[color:var(--aqt-fg)]">
          {t("registrationTeams.list.title")}
        </h2>
        <span className="text-sm text-[color:var(--aqt-fg-muted)]">
          {t("registrationTeams.list.count", { count: teams.length })}
        </span>
        {freeAgents > 0 ? (
          <span className="text-sm text-[color:var(--aqt-amber)]">
            {t("registrationTeams.list.freeAgents", { count: freeAgents })}
          </span>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {teams.map((team) => (
          <RegistrationTeamCard key={team.id} team={team} />
        ))}
      </div>
    </section>
  );
}
