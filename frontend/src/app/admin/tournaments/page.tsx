"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { TournamentsBrowser } from "@/components/admin/tournaments/list/TournamentsBrowser";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspaceStore } from "@/stores/workspace.store";

export default function TournamentsPage() {
  const t = useTranslations("adminTournaments.list");
  const router = useRouter();
  const { canAccessPermission } = usePermissions();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const canCreate = canAccessPermission("tournament.create", currentWorkspaceId);

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title={t("title")}
        description={t("description")}
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => router.push("/admin/tournaments/new")}>
              <Plus className="size-3.5" aria-hidden />
              {t("create")}
            </Button>
          ) : null
        }
      />
      <TournamentsBrowser />
    </div>
  );
}
