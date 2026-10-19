"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { ApiKeysBrowser } from "@/components/admin/access/api-keys/ApiKeysBrowser";
import { PageStateCard } from "@/components/ui/page-state-card";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspaceStore } from "@/stores/workspace.store";

/**
 * Workspace API keys (T2, F15). The Access layout carries the header; the gate
 * is here because a key belongs to one workspace, so an account that can issue
 * keys in none of them has no screen to show.
 */
export default function AccessAdminApiKeysPage() {
  const ta = useTranslations("adminAccess.apiKeysUi");
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const fetchWorkspaces = useWorkspaceStore((state) => state.fetchWorkspaces);
  const { hasWorkspacePermission, isSuperuser, isWorkspaceAdmin } = usePermissions();

  useEffect(() => {
    if (workspaces.length === 0) {
      void fetchWorkspaces();
    }
  }, [fetchWorkspaces, workspaces.length]);

  const manageableWorkspaces = workspaces.filter(
    (workspace) =>
      isSuperuser ||
      isWorkspaceAdmin(workspace.id) ||
      hasWorkspacePermission(workspace.id, "team.create")
  );

  if (manageableWorkspaces.length === 0) {
    return (
      <PageStateCard
        state="empty"
        title={ta("noWorkspaceAdmin")}
        description={ta("noWorkspaceAdminDescription")}
      />
    );
  }

  return (
    <ApiKeysBrowser
      workspaces={manageableWorkspaces}
      currentWorkspaceId={currentWorkspaceId}
      isSuperuser={isSuperuser}
    />
  );
}
