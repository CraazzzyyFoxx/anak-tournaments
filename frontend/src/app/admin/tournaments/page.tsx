"use client";

import { useTranslations } from "next-intl";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { TournamentsBrowser } from "@/components/admin/tournaments/list/TournamentsBrowser";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/hooks/usePermissions";
import { useQueryParams } from "@/hooks/useQueryParams";
import { useWorkspaceStore } from "@/stores/workspace.store";

export default function TournamentsPage() {
  const t = useTranslations("adminTournaments.list");
  const { canAccessPermission } = usePermissions();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const canCreate = canAccessPermission("tournament.create", currentWorkspaceId);
  // `?create=1` is the browser's "Create tournament" dialog.
  const { setParams } = useQueryParams({ shallow: true, resetOnChange: [] });

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title={t("title")}
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => setParams({ create: 1 })}>
              {t("create")}
            </Button>
          ) : null
        }
      />
      <TournamentsBrowser />
    </div>
  );
}
