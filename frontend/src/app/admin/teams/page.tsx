"use client";

import { useTranslations } from "next-intl";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { TeamsBrowser } from "@/components/admin/teams/list/TeamsBrowser";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspaceStore } from "@/stores/workspace.store";

export default function TeamsPage() {
  const t = useTranslations("adminPeople.teams");
  const { canAccessPermission, isLoaded } = usePermissions();
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);

  if (!isLoaded) return <Skeleton className="h-64 w-full rounded-xl" />;

  if (!canAccessPermission("team.read", workspaceId)) {
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
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title={t("title")}
        description={t("description")}
      />
      <TeamsBrowser />
    </div>
  );
}
