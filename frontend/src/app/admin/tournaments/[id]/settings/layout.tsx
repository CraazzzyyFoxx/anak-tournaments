"use client";

import { useParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type messages from "@/i18n/messages/en.json";
import type { ReactNode } from "react";

import { SectionNav, type SectionNavGroup } from "@/components/kit/SectionNav";
import { usePermissions } from "@/hooks/usePermissions";
import { useHubTournamentQuery } from "../hubQueries";
import { allowedSettingsSection, SETTINGS_SECTIONS, type TabAccess } from "../tab-guards";
import { SETTINGS_SECTION_GROUPS, SETTINGS_SECTION_LABEL_KEYS } from "./settings-sections";

/**
 * Navigation of the settings hub (T5) — and nothing else.
 *
 * No queries and no subscriptions live here: the hub shell is the single
 * realtime mount, and the tournament read below is the same cached key the
 * shell already resolved (TanStack dedupes the observer), needed only to
 * decide which sections this caller may open.
 */
export default function TournamentSettingsLayout({
  children
}: Readonly<{ children: ReactNode }>) {
  const params = useParams<{ id: string }>();
  const t = useTranslations("adminTournament.settings");
  const tournamentId = Number(params.id);
  // `/admin/tournaments/14/settings/pre-game` → section `pre-game`.
  const sectionSegment = usePathname().split("/").filter(Boolean).at(-1) ?? "";
  const activeKey = (SETTINGS_SECTIONS as readonly string[]).includes(sectionSegment)
    ? sectionSegment
    : "";

  const { canAccessPermission } = usePermissions();
  const tournamentQuery = useHubTournamentQuery(tournamentId);
  const workspaceId = tournamentQuery.data?.workspace_id ?? null;

  const access: TabAccess = {
    canUpdateTournament: canAccessPermission("tournament.update", workspaceId),
    canUpdateEncounter: canAccessPermission("match.update", workspaceId),
    canTeamRead: canAccessPermission("team.read", workspaceId),
    canTeamCreate: canAccessPermission("team.create", workspaceId),
    canReadTournamentLink: canAccessPermission("tournament_link.read", workspaceId),
    canDeleteTournament: canAccessPermission("tournament.delete", workspaceId),
    teamFormation: tournamentQuery.data?.team_formation === "draft" ? "draft" : "balancer"
  };

  type SectionKey = keyof typeof messages.adminTournament.settings.sections;
  type GroupKey = keyof typeof messages.adminTournament.settings.groups;
  const sectionLabel = (key: SectionKey) =>
    t(`sections.${key}` as `sections.${SectionKey}`);
  const groupLabel = (key: GroupKey) => t(`groups.${key}` as `groups.${GroupKey}`);

  const groups: SectionNavGroup[] = SETTINGS_SECTION_GROUPS.map((group) => ({
    label: group.labelKey ? groupLabel(group.labelKey) : group.label,
    items: group.sections.map((section) => ({
      key: section,
      label: sectionLabel(SETTINGS_SECTION_LABEL_KEYS[section]),
      href: `/admin/tournaments/${tournamentId}/settings/${section}`,
      tone: section === "danger" ? ("danger" as const) : undefined,
      hidden: !allowedSettingsSection(section, access)
    }))
  }));

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
      <SectionNav groups={groups} activeKey={activeKey} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
