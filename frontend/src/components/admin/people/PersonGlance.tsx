"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";

import { AccountStatusPills } from "@/components/admin/access/AccountCard";
import { PROVIDER_LABELS, StateBadge } from "@/components/admin/collectors/subscription-shared";
import { useLinkedAccount } from "@/components/admin/people/PersonAccountTab";
import { CurrentRankChips, useCurrentRanks } from "@/components/admin/people/PersonRankPanel";
import { EYEBROW_CLASS } from "@/components/kit/tone";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { adminQueryKeys } from "@/lib/admin/query-keys";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import { useWorkspaceStore } from "@/stores/workspace.store";

function GlanceRow({
  label,
  href,
  linkLabel,
  children
}: Readonly<{ label: string; href: string; linkLabel: string; children: ReactNode }>) {
  return (
    <div className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-start">
      <dt className={cn(EYEBROW_CLASS, "sm:pt-1")}>{label}</dt>
      <dd className="min-w-0">{children}</dd>
      <dd>
        <Link
          href={href}
          className="inline-flex items-center gap-0.5 whitespace-nowrap text-xs text-primary hover:underline sm:pt-1"
        >
          {linkLabel}
          <ChevronRight aria-hidden className="size-3.5" />
        </Link>
      </dd>
    </div>
  );
}

const MUTED = "text-sm text-muted-foreground";

/**
 * One line per thing that lives on its own tab: current ranks, subscription
 * verdicts, the login. The tables and histories behind them moved to Ranks,
 * Subscriptions and Account — the profile tab stays readable, and each line
 * still answers "is anything wrong here" without a click.
 */
export function PersonGlance({
  personId,
  canReadAuth
}: Readonly<{ personId: number; canReadAuth: boolean }>) {
  const t = useTranslations("adminPeople.glance");
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const ranks = useCurrentRanks(personId);
  const subscriptionsQuery = useQuery({
    queryKey: adminQueryKeys.subscriptionsCollection(workspaceId, personId),
    queryFn: () => adminService.getSubscriptionCollectionStatus(personId)
  });
  const { accountsQuery, linked } = useLinkedAccount(personId, canReadAuth);
  const tabHref = (tab: string) => `/admin/people/${personId}?tab=${tab}`;
  const subscriptions = subscriptionsQuery.data ?? [];

  return (
    <dl className="divide-y divide-border/60">
      <GlanceRow label={t("ranks")} href={tabHref("ranks")} linkLabel={t("rankCollection")}>
        {ranks.isLoading ? (
          <Skeleton className="h-7 w-48" />
        ) : ranks.ranks.length === 0 ? (
          <p className={MUTED}>{t("noRank")}</p>
        ) : (
          <CurrentRankChips ranks={ranks.ranks} />
        )}
      </GlanceRow>

      <GlanceRow label={t("subscriptions")} href={tabHref("subscriptions")} linkLabel={t("allChecks")}>
        {subscriptionsQuery.isLoading ? (
          <Skeleton className="h-7 w-48" />
        ) : subscriptions.length === 0 ? (
          <p className={MUTED}>{t("noVerdict")}</p>
        ) : (
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
            {subscriptions.map((row) => (
              <li
                key={`${row.workspace_id}-${row.provider}`}
                className="inline-flex items-center gap-1.5 text-sm"
              >
                <span className="font-medium">{PROVIDER_LABELS[row.provider] ?? row.provider}</span>
                <StateBadge state={row.state} />
                {row.tier_label ? (
                  <span className="text-xs text-muted-foreground">{row.tier_label}</span>
                ) : null}
                {row.workspace_name ? (
                  <span className="text-xs text-muted-foreground">· {row.workspace_name}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </GlanceRow>

      {canReadAuth ? (
        <GlanceRow label={t("account")} href={tabHref("account")} linkLabel={t("manageAccount")}>
          {accountsQuery.isLoading ? (
            <Skeleton className="h-7 w-48" />
          ) : !linked ? (
            <p className={MUTED}>{t("noAccount")}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">@{linked.username}</span>
              <AccountStatusPills account={linked} />
              {linked.roles.map((role) => (
                <Badge key={role.id} variant="outline" className="font-normal">
                  {role.name}
                </Badge>
              ))}
            </div>
          )}
        </GlanceRow>
      ) : null}
    </dl>
  );
}
