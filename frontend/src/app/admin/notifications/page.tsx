"use client";

import { useTranslations } from "next-intl";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { NotificationsBrowser } from "@/components/admin/notifications/NotificationsBrowser";
import { EmptyNote } from "@/components/kit/EmptyNote";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspaceStore } from "@/stores/workspace.store";

export default function AdminWorkspaceNotificationsPage() {
  const { canAccessPermission, isLoaded } = usePermissions();
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const t = useTranslations<never>();

  if (!isLoaded) return <Skeleton className="h-64 w-full rounded-xl" />;

  if (workspaceId == null) {
    return (
      <div className="space-y-4">
        <AdminPageHeader
          title={t("notifications.workspaceAdmin.title")}
          description={t("notifications.workspaceAdmin.description")}
        />
        <EmptyNote className="text-center">
          {t("notifications.workspaceAdmin.pickWorkspace")}
        </EmptyNote>
      </div>
    );
  }

  if (!canAccessPermission("notification.read", workspaceId)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("notifications.workspaceAdmin.unauthorized.title")}</CardTitle>
          <CardDescription>
            {t("notifications.workspaceAdmin.unauthorized.description")}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <NotificationsBrowser
      workspaceId={workspaceId}
      // Two grants, two questions — the server checks them separately, so a
      // `notification.read` holder gets the table with no retire control at all.
      canRetire={canAccessPermission("notification.delete", workspaceId)}
    />
  );
}
