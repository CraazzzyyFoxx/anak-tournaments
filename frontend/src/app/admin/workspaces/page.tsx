"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { WorkspacesBrowser } from "@/components/admin/workspaces/WorkspacesBrowser";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/usePermissions";

export default function WorkspacesPage() {
  const t = useTranslations("adminAccess.common");
  const tw = useTranslations("adminAccess.workspace");
  const { canManageAnyWorkspace, canUseCapability, isLoaded } = usePermissions();
  const [createOpen, setCreateOpen] = useState(false);

  if (!isLoaded) return <Skeleton className="h-64 w-full rounded-xl" />;

  // The same gate `admin-navigation.ts` puts on `/admin/workspaces`: the row
  // carries no permission, only `workspaceAdminVisible`, which for a null
  // workspace scope is exactly "administers at least one workspace".
  if (!canManageAnyWorkspace()) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{tw("unauthorized")}</CardTitle>
          <CardDescription>
            {tw("unauthorizedDescription")}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title={t("workspaces")}
        description={tw("description")}
        actions={
          /* Creating a workspace is open to any active account now (the backend
             caps how many one account may own), so this is no longer a
             superuser button — but the right is revocable per account through
             negative RBAC, and the backend refuses a denied one, so the button
             goes away with it rather than offering a guaranteed 403. */
          canUseCapability("workspace.self_create") ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-3.5" aria-hidden />
              {t("createWorkspace")}
            </Button>
          ) : null
        }
      />
      <WorkspacesBrowser createOpen={createOpen} onCreateOpenChange={setCreateOpen} />
    </div>
  );
}
