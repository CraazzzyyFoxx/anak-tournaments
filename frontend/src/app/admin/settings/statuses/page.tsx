"use client";

import { useTranslations } from "next-intl";

import { StatusesBrowser } from "@/components/admin/statuses/StatusesBrowser";
import { PageStateCard } from "@/components/ui/page-state-card";
import { useWorkspaceStore } from "@/stores/workspace.store";

export default function WorkspaceStatusesSettingsPage() {
  const t = useTranslations("adminSettings.statuses");
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

  return <StatusesBrowser workspaceId={workspaceId} />;
}
