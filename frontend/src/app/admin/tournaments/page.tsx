"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { TournamentsBrowser } from "@/components/admin/tournaments/list/TournamentsBrowser";
import { Button } from "@/components/ui/button";
import { useGameScope } from "@/hooks/useGameScope";
import { usePermissions } from "@/hooks/usePermissions";
import { DISCIPLINE_PARAM } from "@/lib/site/discipline-scope";
import { useWorkspaceStore } from "@/stores/workspace.store";

export default function TournamentsPage() {
  const t = useTranslations("adminTournaments.list");
  const { canAccessPermission } = usePermissions();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const canCreate = canAccessPermission("tournament.create", currentWorkspaceId);
  // The wizard defaults its game field to the list's filtered game.
  const game = useGameScope({ axis: currentWorkspaceId ?? "all" }).game;

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title={t("title")}
        actions={
          canCreate ? (
            <Button asChild size="sm">
              <Link href={game ? `/admin/tournaments/new?${DISCIPLINE_PARAM}=${game}` : "/admin/tournaments/new"}>
                {t("create")}
              </Link>
            </Button>
          ) : null
        }
      />
      <TournamentsBrowser />
    </div>
  );
}
