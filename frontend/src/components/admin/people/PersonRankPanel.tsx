"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFormatter } from "@/lib/datetime/client";

import RankHistory from "@/components/RankHistory";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { notify } from "@/lib/notify";
import adminService from "@/services/admin.service";
import { useWorkspaceStore } from "@/stores/workspace.store";

import { StatusBadge, formatDate } from "@/components/admin/collectors/rank-shared";
import { EmptyNote } from "@/components/kit/EmptyNote";
import { Spinner } from "@/components/ui/spinner";
import { adminQueryKeys } from "@/lib/admin/query-keys";

/**
 * One player's rank collection state, with the re-fetch controls.
 *
 * Moved out of the rank collector screen: a person's rank belongs on their
 * card (People › Identity). The current ranks are on the Profile tab's glance
 * and in the overview table above this panel, so they are not repeated here.
 */
export function RankPlayerPanel({ userId }: Readonly<{ userId: number }>) {
  const t = useTranslations("adminPeople.rank");
  const format = useFormatter();
  const queryClient = useQueryClient();
  // Scoped server-side to the injected workspace; see `admin.service.ts`.
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(new Set());

  const statusQuery = useQuery({
    queryKey: adminQueryKeys.rankCollection(workspaceId, userId),
    queryFn: () => adminService.getRankCollectionStatus(userId)
  });
  const rows = statusQuery.data ?? [];

  const triggerMutation = useMutation({
    mutationFn: (socialAccountIds: number[] | null) =>
      adminService.triggerRankCollection({ user_id: userId, social_account_ids: socialAccountIds }),
    onSuccess: (result) => {
      notify.success(t("queued", { count: result.enqueued }));
      setSelectedTagIds(new Set());
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.rank() });
    },
    onError: (error) =>
      notify.apiError(error, { title: t("queueError") })
  });

  const toggleTag = (id: number) =>
    setSelectedTagIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t("collection")}</h3>
          {rows.length > 0 ? (
            <div className="flex items-center gap-2">
              {selectedTagIds.size > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={triggerMutation.isPending}
                  onClick={() => triggerMutation.mutate([...selectedTagIds])}
                >
                  <span className="tabular-nums">{t("collectSelected", { count: selectedTagIds.size })}</span>
                </Button>
              )}
              <Button
                size="sm"
                disabled={triggerMutation.isPending}
                onClick={() => triggerMutation.mutate(null)}
              >
                {triggerMutation.isPending ? <Spinner className="mr-1.5 size-3.5" /> : null}
                {t("collectAll")}
              </Button>
            </div>
          ) : null}
        </div>

        {statusQuery.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : statusQuery.isError ? (
          <PageStateCard state="error" onAction={() => void statusQuery.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyNote>{t("noTags")}</EmptyNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>{t("battleTag")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead>{t("lastChecked")}</TableHead>
                <TableHead>{t("lastSuccess")}</TableHead>
                <TableHead className="text-right">{t("failures")}</TableHead>
                <TableHead className="text-right">{t("action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.social_account_id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedTagIds.has(row.social_account_id)}
                      onCheckedChange={() => toggleTag(row.social_account_id)}
                      aria-label={t("select", { battleTag: row.battle_tag })}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{row.battle_tag}</TableCell>
                  <TableCell title={row.last_error ?? undefined}>
                    <StatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-muted-foreground">
                    {row.last_checked_at ? formatDate(format, row.last_checked_at) : null}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-muted-foreground">
                    {row.last_success_at ? formatDate(format, row.last_success_at) : null}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {row.consecutive_failures || null}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={triggerMutation.isPending}
                      onClick={() => triggerMutation.mutate([row.social_account_id])}
                      aria-label={t("collectFor", { battleTag: row.battle_tag })}
                    >
                      {t("collect")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <RankHistory userId={userId} title={t("history")} />
    </div>
  );
}
