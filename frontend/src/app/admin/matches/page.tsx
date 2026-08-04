"use client";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ParsedMatchesBrowser } from "@/components/admin/ParsedMatchesBrowser";
import { useWorkspaceStore } from "@/stores/workspace.store";

/**
 * Parsed maps across every tournament in the workspace.
 *
 * The same component the tournament hub mounts, with the tournament scope
 * unpinned. Ingestion problems cluster by upload batch rather than by
 * tournament, so the workspace-wide view is where a broken parser run is
 * actually visible.
 */
export default function AdminMatchesPage() {
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Parsed matches"
        description="Every played map across every tournament in the workspace"
      />
      <ParsedMatchesBrowser tournamentId={null} workspaceId={workspaceId} />
    </div>
  );
}
