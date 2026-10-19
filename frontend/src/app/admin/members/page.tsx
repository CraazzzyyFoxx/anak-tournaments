"use client";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { MembersBrowser } from "@/components/admin/members/MembersBrowser";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { useTranslations } from "next-intl";

export default function WorkspaceMembersPage() {
  const t = useTranslations("adminAccess.common");
  const tw = useTranslations("adminAccess.workspace");
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const getCurrentWorkspace = useWorkspaceStore((s) => s.getCurrentWorkspace);
  const workspaceName = getCurrentWorkspace()?.name ?? t("thisWorkspace");

  // Exclusive branch: no workspace selected means the table below never renders,
  // so this header is the page's only `<h1>`.
  if (!currentWorkspaceId) {
    return (
      <div className="flex flex-col gap-6">
        <AdminPageHeader
          title={tw("membersTitle")}
          description={tw("membersDescription")}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title={tw("membersTitle")}
        description={tw("manageMembers", { workspace: workspaceName })}
      />
      <MembersBrowser workspaceId={currentWorkspaceId} workspaceName={workspaceName} />
    </div>
  );
}
