"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, CircleSlash, HelpCircle, type LucideIcon } from "lucide-react";
import { useFormatter } from "@/lib/datetime/client";

import { StatusIcon } from "@/components/admin/StatusIcon";
import { Button } from "@/components/ui/button";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import { useWorkspaceStore } from "@/stores/workspace.store";

import {
  PROVIDER_LABELS,
  StateBadge,
  formatDate,
  formatRelative,
  useSubscriptionLabels
} from "@/components/admin/collectors/subscription-shared";
import { EmptyNote } from "@/components/kit/EmptyNote";
import { Spinner } from "@/components/ui/spinner";
import { adminQueryKeys } from "@/lib/admin/query-keys";

const STATE_ICON: Record<string, { icon: LucideIcon; variant: "success" | "warning" | "info" | "destructive" }> = {
  active: { icon: CircleCheck, variant: "success" },
  inactive: { icon: CircleSlash, variant: "warning" },
  unknown: { icon: HelpCircle, variant: "info" },
  error: { icon: CircleAlert, variant: "destructive" }
};

/** One check state as a toned glyph, its word as the tooltip: for lines and logs, not tables. */
export function SubscriptionStateIcon({ state }: Readonly<{ state: string }>) {
  const labels = useSubscriptionLabels();
  const meta = STATE_ICON[state] ?? STATE_ICON.unknown;
  return <StatusIcon icon={meta.icon} label={labels.state[state] ?? state} variant={meta.variant} />;
}

// ─── Per-player check timeline ───────────────────────────────────────────────

/**
 * That player's own slice of the check log, newest first.
 *
 * The counterpart of `RankHistory` on the rank tab: the entitlement table only
 * holds the latest verdict, so this is the only place a flap ("active on Monday,
 * inactive on Friday, active again after a re-subscribe") is visible at all.
 */
function PlayerCheckTimeline({ userId }: Readonly<{ userId: number }>) {
  const t = useTranslations("adminPeople.subscription");
  const format = useFormatter();
  const labels = useSubscriptionLabels();
  // Scoped server-side to the injected workspace; see `admin.service.ts`.
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const query = useQuery({
    queryKey: adminQueryKeys.subscriptionsUserHistory(workspaceId, userId),
    queryFn: () => adminService.getSubscriptionCheckLog({ user_id: userId, limit: 100 })
  });
  const rows = query.data ?? [];

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{t("history")}</h3>
      {query.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : query.isError ? (
        <PageStateCard state="error" onAction={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyNote>{t("emptyHistory")}</EmptyNote>
      ) : (
        <ol className="max-h-72 divide-y divide-border/60 overflow-y-auto pr-1">
          {rows.map((row) => {
            const reason = row.error ?? (row.reason ? labels.reason(row.reason) : null);
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 text-sm">
                <SubscriptionStateIcon state={row.state} />
                <span className="tabular-nums text-muted-foreground">
                  {formatDate(format, row.created_at)}
                </span>
                <span className="font-medium">{PROVIDER_LABELS[row.provider] ?? row.provider}</span>
                <span className="text-caption text-muted-foreground">
                  {[
                    row.tier_label ?? (row.tier_rank != null ? t("tierValue", { rank: row.tier_rank }) : null),
                    labels.source[row.source] ?? row.source
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {reason ? (
                  <span className={cn("truncate text-caption", row.error ? "text-danger" : "text-muted-foreground")}>
                    {reason}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// ─── Per-player entitlements ─────────────────────────────────────────────────

/**
 * One player's subscription verdicts, with the re-check controls.
 *
 * Moved out of the subscription collector screen: a person's entitlements
 * belong on their card (People › Identity).
 */
export function SubscriptionPlayerPanel({
  userId,
  label
}: Readonly<{ userId: number; label: string }>) {
  const t = useTranslations("adminPeople.subscription");
  const format = useFormatter();
  const labels = useSubscriptionLabels();
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const statusQuery = useQuery({
    queryKey: adminQueryKeys.subscriptionsCollection(workspaceId, userId),
    queryFn: () => adminService.getSubscriptionCollectionStatus(userId)
  });
  const rows = statusQuery.data ?? [];

  const triggerMutation = useMutation({
    mutationFn: (providers: string[] | null) =>
      adminService.triggerSubscriptionCollection({ user_id: userId, providers }),
    onSuccess: (result) => {
      notify.success(
        result.checked === 0
          ? t("nothingToCheck")
          : t("checked", { count: result.checked })
      );
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.subscriptions() });
    },
    onError: (error) =>
      notify.apiError(error, { title: t("recheckError") })
  });

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t("entitlements")}</h3>
          <Button
            size="sm"
            disabled={triggerMutation.isPending}
            onClick={() => triggerMutation.mutate(null)}
          >
            {triggerMutation.isPending ? <Spinner className="mr-1.5 size-3.5" /> : null}
            {t("recheck")}
          </Button>
        </div>

        {statusQuery.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : statusQuery.isError ? (
          <PageStateCard state="error" onAction={() => void statusQuery.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyNote>{t("empty")}</EmptyNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("workspace")}</TableHead>
                <TableHead>{t("provider")}</TableHead>
                <TableHead>{t("state")}</TableHead>
                <TableHead>{t("tier")}</TableHead>
                <TableHead>{t("checkedLabel")}</TableHead>
                <TableHead>{t("reason")}</TableHead>
                <TableHead className="text-right">{t("action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.workspace_id}-${row.provider}`}>
                  <TableCell className="text-sm">
                    {row.workspace_name ?? row.workspace_id}
                  </TableCell>
                  <TableCell className="font-medium">
                    {PROVIDER_LABELS[row.provider] ?? row.provider}
                  </TableCell>
                  <TableCell title={row.source ?? undefined}>
                    <StateBadge state={row.state} />
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-muted-foreground">
                    {row.tier_label ?? (row.tier_rank != null ? t("tierValue", { rank: row.tier_rank }) : null)}
                  </TableCell>
                  <TableCell
                    className="text-sm tabular-nums text-muted-foreground"
                    title={row.checked_at ? formatDate(format, row.checked_at) : undefined}
                  >
                    {row.checked_at ? formatRelative(format, row.checked_at) : null}
                  </TableCell>
                  <TableCell className="max-w-40 truncate text-xs text-muted-foreground">
                    {row.reason ? labels.reason(row.reason) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={triggerMutation.isPending}
                      onClick={() => triggerMutation.mutate([row.provider])}
                      aria-label={t("recheckFor", { provider: PROVIDER_LABELS[row.provider] ?? row.provider, label })}
                    >
                      {t("recheck")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <PlayerCheckTimeline userId={userId} />
    </div>
  );
}
