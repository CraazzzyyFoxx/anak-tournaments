"use client";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { MembersBrowser } from "@/components/admin/members/MembersBrowser";
import { PageStateCard } from "@/components/ui/page-state-card";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { useTranslations } from "next-intl";

export default function WorkspaceMembersPage() {
  const t = useTranslations("adminAccess.common");
  const tw = useTranslations("adminAccess.workspace");
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const getCurrentWorkspace = useWorkspaceStore((s) => s.getCurrentWorkspace);
  const workspaceName = getCurrentWorkspace()?.name ?? t("thisWorkspace");

  return (
    <div className="space-y-4">
      <AdminPageHeader title={tw("membersTitle")} />
      {currentWorkspaceId ? (
        <MembersBrowser workspaceId={currentWorkspaceId} workspaceName={workspaceName} />
      ) : (
        <PageStateCard state="empty" description={tw("membersDescription")} />
      )}
    </div>
  );
}
