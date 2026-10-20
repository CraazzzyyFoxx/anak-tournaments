"use client";

import { useTranslations } from "next-intl";

import { WorkspaceQuotaCard } from "@/components/admin/quota/WorkspaceQuotaCard";
import { PageStateCard } from "@/components/ui/page-state-card";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspaceStore } from "@/stores/workspace.store";

/**
 * Rate limits of the workspace this admin is working in.
 *
 * Gated on `workspace.update`, the permission behind `workspaces.quota_set`: a
 * workspace admin may only lower a number here, and the server is what enforces
 * that — raising one answers 422 and the offending field says so.
 */
export default function WorkspaceQuotaSettingsPage() {
  const t = useTranslations("adminSettings.quota");
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const { canAccessPermission } = usePermissions();

  if (workspaceId === null) {
    return (
      <PageStateCard
        state="empty"
        title={t("noWorkspace.title")}
        description={t("noWorkspace.description")}
      />
    );
  }

  if (!canAccessPermission("workspace.update", workspaceId)) {
    return (
      <PageStateCard
        state="error"
        title={t("notAvailable.title")}
        description={t("notAvailable.description")}
      />
    );
  }

  return <WorkspaceQuotaCard workspaceId={workspaceId} />;
}
