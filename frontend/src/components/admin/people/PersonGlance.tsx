"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ShieldAlert, UserX } from "lucide-react";

import { StatusIcon } from "@/components/admin/StatusIcon";
import { PROVIDER_LABELS } from "@/components/admin/collectors/subscription-shared";
import { useLinkedAccount } from "@/components/admin/people/PersonAccountTab";
import { SubscriptionStateIcon } from "@/components/admin/people/PersonSubscriptionPanel";
import { EYEBROW_CLASS } from "@/components/kit/tone";
import { Skeleton } from "@/components/ui/skeleton";
import { adminQueryKeys } from "@/lib/admin/query-keys";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import rankService from "@/services/rank.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { CurrentRank } from "@/types/rank.types";

const ROLE_KEYS = ["tank", "damage", "support", "flex"] as const;

/** OverFast's lowercase division, cased for display: "Diamond 2". */
function divisionLabel(rank: CurrentRank, unrankedLabel: string): string {
  if (!rank.is_ranked || !rank.division) return unrankedLabel;
  const division = rank.division.charAt(0).toUpperCase() + rank.division.slice(1);
  return rank.tier != null ? `${division} ${rank.tier}` : division;
}

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
  const tRole = useTranslations("common.roles");
  const tRank = useTranslations("adminPeople.rank");
  const tAccount = useTranslations("adminAccess.common");
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const ranksQuery = useQuery({
    queryKey: adminQueryKeys.rankCurrent(personId),
    queryFn: () => rankService.getUserCurrentRanks(personId)
  });
  const ranks = (ranksQuery.data?.ranks ?? []).filter((rank) => rank.is_ranked);
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
        {ranksQuery.isLoading ? (
          <Skeleton className="h-5 w-48" />
        ) : ranks.length === 0 ? (
          <p className={MUTED}>{t("noRank")}</p>
        ) : (
          <p className="text-sm tabular-nums">
            {ranks
              .map((rank) => {
                const role = (ROLE_KEYS as readonly string[]).includes(rank.role)
                  ? tRole(rank.role as (typeof ROLE_KEYS)[number])
                  : rank.role;
                return `${role} ${divisionLabel(rank, tRank("unranked"))}`;
              })
              .join(" · ")}
          </p>
        )}
      </GlanceRow>

      <GlanceRow label={t("subscriptions")} href={tabHref("subscriptions")} linkLabel={t("allChecks")}>
        {subscriptionsQuery.isLoading ? (
          <Skeleton className="h-5 w-48" />
        ) : subscriptions.length === 0 ? (
          <p className={MUTED}>{t("noVerdict")}</p>
        ) : (
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
            {subscriptions.map((row) => (
              <li
                key={`${row.workspace_id}-${row.provider}`}
                className="inline-flex items-center gap-1.5 text-sm"
              >
                {row.state ? <SubscriptionStateIcon state={row.state} /> : null}
                <span className="font-medium">{PROVIDER_LABELS[row.provider] ?? row.provider}</span>
                {row.tier_label || row.workspace_name ? (
                  <span className="text-caption text-muted-foreground">
                    {[row.tier_label, row.workspace_name].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </GlanceRow>

      {canReadAuth ? (
        <GlanceRow label={t("account")} href={tabHref("account")} linkLabel={t("manageAccount")}>
          {accountsQuery.isLoading ? (
            <Skeleton className="h-5 w-48" />
          ) : !linked ? (
            <p className={MUTED}>{t("noAccount")}</p>
          ) : (
            <div className="space-y-0.5">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                @{linked.username}
                {!linked.is_active ? (
                  <StatusIcon icon={UserX} label={tAccount("inactive")} variant="muted" />
                ) : linked.is_superuser ? (
                  <StatusIcon icon={ShieldAlert} label={tAccount("superuser")} variant="destructive" />
                ) : null}
              </p>
              {linked.roles.length > 0 ? (
                <p className="text-caption text-muted-foreground">
                  {linked.roles.map((role) => role.name).join(" · ")}
                </p>
              ) : null}
            </div>
          )}
        </GlanceRow>
      ) : null}
    </dl>
  );
}
