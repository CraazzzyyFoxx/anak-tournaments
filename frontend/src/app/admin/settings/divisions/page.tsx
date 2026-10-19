"use client";

import { useTranslations } from "next-intl";

import { DivisionsBrowser } from "@/components/admin/divisions/DivisionsBrowser";
import { PageStateCard } from "@/components/ui/page-state-card";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspaceStore } from "@/stores/workspace.store";

/**
 * Settings › Divisions (T5 section, F11).
 *
 * The section renders bare — the settings layout owns the page header, the rail
 * and the `<main>`.
 */
export default function DivisionsSettingsPage() {
  const t = useTranslations("adminSettings.divisions");
  const { isSuperuser, canAccessPermission } = usePermissions();
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);

  if (workspaceId === null) {
    return (
      <PageStateCard
        state="empty"
        title={t("noWorkspace.title")}
        description={t("noWorkspace.description")}
      />
    );
  }

  if (!isSuperuser && !canAccessPermission("division_grid.read", workspaceId)) {
    return (
      <PageStateCard
        state="not-found"
        title={t("unavailable.title")}
        description={t("unavailable.description")}
      />
    );
  }

  return <DivisionsBrowser workspaceId={workspaceId} />;
}
