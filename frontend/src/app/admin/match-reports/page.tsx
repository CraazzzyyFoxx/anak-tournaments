"use client";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { EncounterReportsBrowser } from "@/components/admin/EncounterReportsBrowser";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspaceStore } from "@/stores/workspace.store";

/**
 * Captain reports across every tournament in the workspace.
 *
 * The same component the tournament hub mounts, with the tournament scope
 * unpinned — a dispute is worth seeing before you know which event it belongs
 * to, which is exactly what the hub tab cannot offer.
 */
export default function MatchReportsPage() {
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const { canAccessPermission } = usePermissions();

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Match reports"
        description="Captain-submitted results across every tournament in the workspace"
      />
      <EncounterReportsBrowser
        tournamentId={null}
        workspaceId={workspaceId}
        canUpdateEncounter={canAccessPermission("match.update", workspaceId)}
      />
    </div>
  );
}
