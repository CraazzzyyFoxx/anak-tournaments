"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { LinkTabs, type LinkTabItem } from "@/components/kit/LinkTabs";
import { SaveBar } from "@/components/kit/SaveBar";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { notify } from "@/lib/notify";
import workspaceService from "@/services/workspace.service";
import type { QuotaScope } from "@/types/auth.types";
import { hasQuotaOverride } from "./dimensions";
import { QuotaLimitFields } from "./QuotaLimitFields";
import { QuotaUsagePanel } from "./QuotaUsagePanel";
import { useQuotaDraft, type QuotaDraft } from "./useQuotaDraft";
import { workspaceQueryKeys } from "@/lib/workspace/query-keys";

/** In table order: the tenant pool first, then the two per-principal buckets. */
const SCOPES: readonly QuotaScope[] = ["workspace", "key", "session"];

/** `?tab=` like every other admin tab row, so one scope's form is linkable. */
const SCOPE_PARAM = "tab";

/**
 * The workspace's quota policy: what the tenant pool may spend, and the ceiling
 * one key or one interactive session may take out of it.
 *
 * The three scopes are one form behind one `SaveBar`. Every scope stays mounted
 * and the inactive ones are hidden, so a half-typed override on another tab is
 * still unsaved work the bar counts and the guard protects.
 */
export function WorkspaceQuotaCard({ workspaceId }: Readonly<{ workspaceId: number }>) {
  const t = useTranslations("quota");
  const { isSuperuser } = usePermissions();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const fieldPrefix = useId();
  const [saving, setSaving] = useState(false);
  const usageQuery = useQuery({
    queryKey: workspaceQueryKeys.quotaUsage(workspaceId),
    queryFn: () => workspaceService.getQuotaUsage(workspaceId),
    staleTime: 0
  });

  // An unknown `?tab=` falls back to the tenant pool rather than rendering nothing.
  const requested = searchParams?.get(SCOPE_PARAM) ?? "";
  const active = SCOPES.find((scope) => scope === requested) ?? SCOPES[0];
  const policyOf = (scope: QuotaScope) =>
    usageQuery.data?.policy?.find((row) => row.scope === scope) ?? null;

  const forms: Record<QuotaScope, QuotaDraft> = {
    workspace: useQuotaDraft(policyOf("workspace")),
    key: useQuotaDraft(policyOf("key")),
    session: useQuotaDraft(policyOf("session"))
  };
  const changed = SCOPES.filter((scope) => forms[scope].dirty);

  // A field on a hidden tab cannot take focus: open the tab, focus after it renders.
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingFocus.current) return;
    document.getElementById(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  }, [active]);
  const showScope = (scope: QuotaScope, fieldId?: string) => {
    if (scope === active) {
      if (fieldId) document.getElementById(fieldId)?.focus();
      return;
    }
    pendingFocus.current = fieldId ?? null;
    router.replace(`${pathname}?${SCOPE_PARAM}=${scope}`, { scroll: false });
  };

  // Each scope is its own row and its own write, sent in table order. A refusal
  // stops the run on the scope that caused it, opens that tab and marks the
  // field; the scopes written before it re-seed clean from the refetch.
  const save = async () => {
    const blocked = changed.find((scope) => forms[scope].raised.length > 0 && !isSuperuser);
    if (blocked) {
      showScope(blocked, `${fieldPrefix}-${blocked}-${forms[blocked].raised[0]}`);
      return;
    }
    setSaving(true);
    try {
      for (const scope of changed) {
        try {
          await workspaceService.setQuota(workspaceId, scope, forms[scope].draft);
        } catch (error) {
          showScope(scope);
          if (!forms[scope].reject(error)) notify.apiError(error, { title: t("errors.saveFailed") });
          return;
        }
      }
      notify.success(t("saved"));
    } finally {
      setSaving(false);
      void queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.quotaUsage(workspaceId) });
    }
  };

  if (usageQuery.isError && !usageQuery.data) {
    return (
      <PageStateCard
        state="error"
        title={t("loadFailed")}
        onAction={() => void usageQuery.refetch()}
      />
    );
  }

  const tabs: LinkTabItem[] = SCOPES.map((scope) => ({
    key: scope,
    label: t(`scopes.${scope}.tab`),
    href: `${pathname}?${SCOPE_PARAM}=${scope}`,
    // Which scopes carry a row is the one thing tabbing away hides, so it rides
    // on the tab itself.
    dot: hasQuotaOverride(policyOf(scope)?.override ?? {})
      ? { tone: "info" as const, label: t("state.overridden") }
      : undefined
  }));

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-base font-semibold">{t("usageHeading")}</h2>
        {usageQuery.data ? (
          <QuotaUsagePanel usage={usageQuery.data} />
        ) : (
          <Skeleton className="h-40 w-full rounded-xl" />
        )}
      </section>

      <section className="space-y-3 border-t border-border pt-6">
        <h2 className="text-base font-semibold">{t("overrideHeading")}</h2>
        <p className="max-w-prose text-xs text-muted-foreground">
          {isSuperuser ? t("overrideHint") : t("overrideHintAdmin")}
        </p>
        {usageQuery.data ? (
          <>
            <LinkTabs items={tabs} activeKey={active} ariaLabel={t("overrideHeading")} />
            {SCOPES.map((scope) => (
              <div key={scope} hidden={scope !== active}>
                <QuotaLimitFields
                  idPrefix={`${fieldPrefix}-${scope}`}
                  values={forms[scope].draft}
                  inherited={policyOf(scope)?.inherited}
                  raised={forms[scope].raised}
                  canRaise={isSuperuser}
                  errors={forms[scope].errors}
                  disabled={saving}
                  onChange={forms[scope].set}
                />
              </div>
            ))}
          </>
        ) : (
          <Skeleton className="h-72 w-full rounded-xl" />
        )}
      </section>

      <SaveBar
        dirty={changed.length > 0}
        saving={saving}
        primaryLabel={t("save")}
        summary={t("changedScopes", {
          scopes: changed.map((scope) => t(`scopes.${scope}.tab`)).join(", ")
        })}
        onDiscard={() => SCOPES.forEach((scope) => forms[scope].reset())}
        onSave={() => void save()}
        // The `?tab=` links switch between parts of this one form and unmount
        // nothing, so they must not prompt; a reload or tab close still does.
        guardNavigation={false}
      />
    </div>
  );
}
