"use client";

import { MissingGridNotice } from "@/components/divisions/MissingGridNotice";
import { usePermissions } from "@/hooks/usePermissions";

/**
 * {@link MissingGridNotice} for a players read the server refused on `axis` (the read's workspace, or `"all"`).
 * Across communities no workspace grid applies; on a workspace only its own grid managers are sent to its settings.
 */
export function UsersMissingGrid({
  discipline,
  gameName,
  axis
}: Readonly<{ discipline: string; gameName: string; axis: number | "all" | null | undefined }>) {
  const { canAccessAnyPermission } = usePermissions();
  return (
    <MissingGridNotice
      discipline={discipline}
      gameName={gameName}
      acrossCommunities={axis === "all"}
      canManage={
        typeof axis === "number" && canAccessAnyPermission(["division_grid.create", "division_grid.update"], axis)
      }
    />
  );
}
