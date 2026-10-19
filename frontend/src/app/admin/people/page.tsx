"use client";

import { useTranslations } from "next-intl";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { PeopleBrowser } from "@/components/admin/people/list/PeopleBrowser";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

  if (!isLoaded) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted/40 motion-reduce:animate-none" />;
  }

  if (!canAccessPermission("user.read", workspaceId)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("unauthorized")}</CardTitle>
          <CardDescription>
            {t("noPermission")}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title={t("title")}
        description={t("description")}
      />
      <PeopleBrowser workspaceId={workspaceId} />
    </div>
  );
}
