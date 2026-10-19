"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Globe } from "lucide-react";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AuditBrowser } from "@/components/admin/audit/AuditBrowser";
import { ALL_WORKSPACES, SCOPE_PARAM } from "@/components/admin/audit/model";
import { EmptyNote } from "@/components/kit/EmptyNote";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspaceStore } from "@/stores/workspace.store";

export default function AdminAuditPage() {
  const t = useTranslations("adminMatches.audit");
  const { isSuperuser, canAccessPermission, isLoaded } = usePermissions();
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const searchParams = useSearchParams();
  // A superuser with no workspace picked has no narrower scope to fall back to,
  // so the feed IS platform-wide — the badge and the boundary note have to say
  // so rather than claim a workspace they are not filtering by. Read off the
  // scope chip's own param: the gate below needs it before the chips exist.
  const allWorkspaces =
    isSuperuser && (searchParams.get(SCOPE_PARAM) === ALL_WORKSPACES || workspaceId == null);

  if (!isLoaded) return <Skeleton className="h-64 w-full rounded-xl" />;

  // A non-superuser request without a workspace is a 422, not a wider feed, so
  // there is nothing to ask for until one is picked. Asked before the permission
  // gate: without a scope there is no scope to hold a grant in, and "unauthorized"
  // would be the wrong thing to say to someone who has simply picked nothing.
  if (!isSuperuser && workspaceId == null) {
    return (
      <div className="space-y-6">
        <AdminPageHeader title={t("title")} description={t("description")} />
        <EmptyNote className="text-center">
          {t("scopeDescription")}
        </EmptyNote>
      </div>
    );
  }

  // The same grant `AuditTrailButton` asks for, in the scope this feed queries.
  // The server requires `audit.read` in the requested workspace, so without it
  // every request on this screen is a 403 — saying so once beats a table of them.
  if (!canAccessPermission("audit.read", allWorkspaces ? null : workspaceId)) {
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
    <div className="space-y-6">
      <AdminPageHeader
        title={t("title")}
        description={t("readOnlyDescription")}
        meta={
          allWorkspaces ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Globe aria-hidden className="size-3.5" />
              {t("everyWorkspace")}
            </span>
          ) : null
        }
      />

      <AuditBrowser
        workspaceId={workspaceId}
        allWorkspaces={allWorkspaces}
        isSuperuser={isSuperuser}
      />
    </div>
  );
}
