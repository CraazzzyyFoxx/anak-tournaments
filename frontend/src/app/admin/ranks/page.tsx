"use client";

import { useTranslations } from "next-intl";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { MixRankerActions } from "@/components/admin/ranks/MixRankerActions";
import { RankOverviewTable } from "@/components/admin/ranks/RankOverviewTable";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspaceStore } from "@/stores/workspace.store";

/**
 * Every rank value of every workspace member, flat and read-only.
 *
 * `team.update` rather than `rank.read`: the collector permission is about the
 * OverFast worker, while this table exposes each organiser's private book and
 * both computed effective numbers — the seeding weight of the workspace. That
 * is the roster owner's data, and the backend gates the endpoint the same way.
 */
export default function RankOverviewPage() {
  const t = useTranslations("admin.rankOverview");
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const { canAccessPermission, isLoaded } = usePermissions();

  if (!isLoaded) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }

  if (!canAccessPermission("team.update", workspaceId)) {
    return (
      <PageStateCard
        state="not-found"
        title={t("unauthorized.title")}
        description={t("unauthorized.description")}
      />
    );
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title={t("title")}
        actions={workspaceId != null ? <MixRankerActions workspaceId={workspaceId} /> : undefined}
      />
      <RankOverviewTable />
    </div>
  );
}
