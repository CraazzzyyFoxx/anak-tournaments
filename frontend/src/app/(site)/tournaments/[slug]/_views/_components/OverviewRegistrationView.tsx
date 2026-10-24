"use client";

import { useTranslations } from "next-intl";

import { ProfileStat } from "@/components/profile/atoms";
import { useFormatter } from "@/lib/datetime/client";
import { isRegistrationOpen } from "@/lib/tournament/status";
import type { Registration, RegistrationListResponse } from "@/types/registration.types";
import type { Tournament } from "@/types/tournament.types";

import { PhaseTimeline, ViewerTimeZone } from "../../_components/PhaseTimeline";
import { hasTeamLineup } from "../tournamentOverview.model";
import { OverviewColumns, OverviewSection, SectionLink } from "./OverviewCards";
import { OverviewMapsSection } from "./OverviewMapsSection";
import { OverviewTeamsSection } from "./OverviewTeamsSection";
import { CapacityValue, RegistrationSummary } from "./RegistrationSummary";

/**
 * A: before the first whistle (§3A). The phase timeline leads, full width:
 * before the start, where the tournament stands IS the news. Under it the
 * phase's own story — who signed up while the field forms, the teams once it
 * is set — beside the reference column, and the first round's maps last.
 */
export function OverviewRegistrationView({
  tournament,
  registrationList,
  registrations,
  overviewHref,
  clockNow,
  aboutCard,
  formatCard,
  linksCard
}: Readonly<{
  tournament: Tournament;
  registrationList: RegistrationListResponse | null;
  registrations: readonly Registration[];
  overviewHref: string;
  clockNow: number | null;
  aboutCard: React.ReactNode;
  formatCard: React.ReactNode;
  linksCard: React.ReactNode;
}>) {
  const t = useTranslations();
  const format = useFormatter();

  const teamsCount = tournament.teams_count ?? 0;
  const isTeamRegistration = tournament.team_formation === "registration";
  // Who signed up last is news only while someone still can: after the window
  // closes, "1 day ago" under a closed registration reads as stale.
  const registrationOpen = clockNow !== null && isRegistrationOpen(tournament, clockNow);
  const submitted = [...registrations]
    .filter((registration) => registration.submitted_at !== null)
    .sort((left, right) => String(right.submitted_at).localeCompare(String(left.submitted_at)));
  const latest = submitted
    .slice(0, 3)
    .map((registration) => registration.primary_handle)
    .filter((handle): handle is string => typeof handle === "string" && handle.length > 0);
  const latestAt = submitted[0]?.submitted_at ?? null;
  const latestAgo =
    latestAt !== null && clockNow !== null
      ? format.relativeTime(new Date(latestAt), clockNow)
      : null;

  const registrationSection = (
    <OverviewSection
      title={t("tournamentDetail.overview.registration.title")}
      action={
        <SectionLink href={`${overviewHref}/participants`}>
          {t("tournamentDetail.overview.registration.all")}
        </SectionLink>
      }
    >
      {isTeamRegistration ? (
        <div className="grid grid-cols-2 gap-4 sm:max-w-md">
          <ProfileStat label={t("tournamentDetail.overview.registration.teams")} value={teamsCount} />
          <ProfileStat
            label={t("tournamentDetail.overview.registration.total")}
            value={
              <CapacityValue
                value={registrationList?.total ?? tournament.registrations_count ?? 0}
                max={registrationList?.max_participants}
              />
            }
          />
        </div>
      ) : (
        <>
          {/* "Tanks are short" — the same figures the participants page
              falls back to when the roster itself is hidden. */}
          <RegistrationSummary
            workspaceId={tournament.workspace_id}
            discipline={tournament.discipline}
            total={registrationList?.total ?? registrations.length}
            roleCounts={registrationList?.role_counts ?? {}}
            maxParticipants={registrationList?.max_participants}
          />
          {registrationOpen && latest.length > 0 ? (
            <p className="mt-3 truncate text-caption text-[color:var(--aqt-fg-faint)]">
              {t("tournamentDetail.overview.registration.latest")}: {latest.join(" · ")}
              {latestAgo ? ` · ${latestAgo}` : null}
            </p>
          ) : null}
        </>
      )}
    </OverviewSection>
  );

  return (
    <div className="grid min-w-0 gap-10">
      {/* ① Where the tournament stands. A tournament with no schedule has no
          timeline to lead with, and no heading over an empty band either. */}
      {(tournament.phase_schedule ?? []).length > 0 ? (
        <OverviewSection
          id="phases"
          title={t("tournamentDetail.overview.phases.title")}
          action={<ViewerTimeZone />}
        >
          <PhaseTimeline tournament={tournament} orientation="horizontal" />
        </OverviewSection>
      ) : null}

      <OverviewColumns
        main={
          <>
            {/* ② The field: sign-ups while it forms, the teams once it is set. */}
            {hasTeamLineup(tournament) ? (
              <OverviewTeamsSection tournament={tournament} overviewHref={overviewHref} />
            ) : (
              registrationSection
            )}
            {aboutCard}
          </>
        }
        aside={
          <>
            {formatCard}
            {linksCard}
          </>
        }
      />

      <OverviewMapsSection tournament={tournament} overviewHref={overviewHref} />
    </div>
  );
}
