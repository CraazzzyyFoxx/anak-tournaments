"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type messages from "@/i18n/messages/en.json";
import type { ReactNode } from "react";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { useInSettingsPreview } from "@/components/kit/SettingsContinuation";
import { PageStateCard } from "@/components/ui/page-state-card";
import { usePermissions } from "@/hooks/usePermissions";
import type { Tournament } from "@/types/tournament.types";
import { tabFallback, useHubTournamentQuery } from "../hubQueries";
import { allowedSettingsSection, type SettingsSection, type TabAccess } from "../tab-guards";
import { SETTINGS_SECTION_LABEL_KEYS } from "./settings-sections";

interface SettingsSectionContext {
  tournament: Tournament;
  tournamentId: number;
  workspaceId: number;
  /** `tournament.update` — every section's edit grant except pre-game's. */
  canUpdateTournament: boolean;
  /** `team.create` — the edit grant of the two registration-form sections. */
  canTeamCreate: boolean;
}

export interface SettingsSectionProps {
  section: SettingsSection;
  description?: string;
  children: (context: SettingsSectionContext) => ReactNode;
}

/**
 * The frame of one settings section: heading, permission gate, and the
 * tournament every section body needs.
 *
 * The gate lives here rather than in the rail because hiding a link is not
 * access control — `/settings/danger` typed into the address bar has to be
 * refused too, and refusing it in eleven copies is how one of them ends up
 * missing.
 */
export function SettingsSectionPage({
  section,
  description,
  children
}: Readonly<SettingsSectionProps>) {
  const params = useParams<{ id: string }>();
  const t = useTranslations("adminTournament.settings");
  const tournamentId = Number(params.id);
  const { canAccessPermission, isLoaded: permissionsLoaded } = usePermissions();

  const tournamentQuery = useHubTournamentQuery(tournamentId);
  const tournament = tournamentQuery.data;
  const workspaceId = tournament?.workspace_id ?? null;

  const access: TabAccess = {
    canUpdateTournament: canAccessPermission("tournament.update", workspaceId),
    canUpdateEncounter: canAccessPermission("match.update", workspaceId),
    canTeamRead: canAccessPermission("team.read", workspaceId),
    canTeamCreate: canAccessPermission("team.create", workspaceId),
    canReadTournamentLink: canAccessPermission("tournament_link.read", workspaceId),
    canDeleteTournament: canAccessPermission("tournament.delete", workspaceId),
    teamFormation: tournament?.team_formation === "draft" ? "draft" : "balancer"
  };

  const sectionLabel = t(
    `sections.${SETTINGS_SECTION_LABEL_KEYS[section]}` as `sections.${keyof typeof messages.adminTournament.settings.sections}`
  );

  // As the next section's ghost the page is titled by the ghost itself; a
  // second h1 there would be a heading for something not open.
  const inPreview = useInSettingsPreview();
  const header = inPreview ? null : (
    <AdminPageHeader title={sectionLabel} description={description} />
  );

  if (tournamentQuery.isLoading || !permissionsLoaded) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        {tabFallback}
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <PageStateCard
          state="not-found"
          title={t("notFound")}
          description={t("notFoundDescription")}
        />
      </div>
    );
  }

  if (!allowedSettingsSection(section, access)) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <PageStateCard
          state="error"
          title={t("notPermitted")}
          description={t("notPermittedDescription", { section: sectionLabel })}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {header}
      {children({
        tournament,
        tournamentId,
        workspaceId: tournament.workspace_id,
        canUpdateTournament: access.canUpdateTournament,
        canTeamCreate: access.canTeamCreate
      })}
    </div>
  );
}
