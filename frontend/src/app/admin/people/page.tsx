"use client";

import { useTranslations } from "next-intl";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { PeopleBrowser } from "@/components/admin/people/list/PeopleBrowser";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspaceStore } from "@/stores/workspace.store";

/**
 * People — every player identity in the workspace, and what is attached to it.
 *
 * Replaces `/admin/users` (the identity list) and `/admin/players` (the
 * cross-tournament roster table, now the Participations tab of one person).
 */
export default function PeoplePage() {
  const t = useTranslations("adminPeople.people");
  const { canAccessPermission, isLoaded } = usePermissions();
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);

  return (
    <PermissionGate
      loaded={isLoaded}
      allowed={canAccessPermission("user.read", workspaceId)}
      description={t("noPermission")}
    >
      <div className="space-y-4">
        <AdminPageHeader title={t("title")} description={t("description")} />
        <PeopleBrowser workspaceId={workspaceId} />
      </div>
    </PermissionGate>
  );
}
