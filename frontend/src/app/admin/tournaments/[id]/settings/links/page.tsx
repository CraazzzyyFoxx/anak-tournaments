"use client";

import dynamic from "next/dynamic";

import { usePermissions } from "@/hooks/usePermissions";
import { tabFallback } from "../../hubQueries";
import { SettingsSectionPage } from "../SettingsSection";

const TournamentLinksTab = dynamic(
  () =>
    import("../../components/TournamentLinksTab").then((module) => ({
      default: module.TournamentLinksTab
    })),
  { loading: () => tabFallback }
);

export default function LinksSettingsPage() {
  const { canAccessPermission } = usePermissions();

  return (
    <SettingsSectionPage
      section="links"
      description="Discord, broadcasts, VODs, bracket and rules shown on the tournament page."
    >
      {({ tournamentId, workspaceId }) => (
        <TournamentLinksTab
          tournamentId={tournamentId}
          canCreate={canAccessPermission("tournament_link.create", workspaceId)}
          canUpdate={canAccessPermission("tournament_link.update", workspaceId)}
          canDelete={canAccessPermission("tournament_link.delete", workspaceId)}
          canRepollStreams={canAccessPermission("stream.update", workspaceId)}
        />
      )}
    </SettingsSectionPage>
  );
}
