"use client";

// The workspace-scoped half of subscription admin: which providers exist, and the
// single rule every tournament in the workspace enforces. Both used to live in the
// per-tournament registration form builder, which re-asked the same question for
// every new tournament.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";

import SubscriptionProvidersCard from "@/components/admin/subscriptions/SubscriptionProviderCard";
import SubscriptionRequirementEditor from "@/components/admin/subscriptions/SubscriptionRequirementEditor";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { notify } from "@/lib/notify";
import balancerAdminService from "@/services/balancer-admin.service";
import type { SubscriptionRequirement } from "@/types/registration.types";

const EMPTY_REQUIREMENT: SubscriptionRequirement = { mode: "all", requirements: [] };

/** Rule equality as the SERVER sees it: mode plus the provider/threshold set. Order is
 *  not part of the rule (`parse_requirement` dedupes into a dict and the Kleene
 *  composition is commutative), so reordering the editor's rows must not be reported as
 *  a policy change. */
function sameRule(a: SubscriptionRequirement, b: SubscriptionRequirement): boolean {
  if ((a.mode ?? "all") !== (b.mode ?? "all")) return false;
  const key = (r: SubscriptionRequirement) =>
    JSON.stringify(
      (r.requirements ?? [])
        .map((row) => `${row.provider}:${row.min_tier_rank ?? 1}`)
        .sort()
    );
  return key(a) === key(b);
}

export function WorkspaceSubscriptionPanel({ workspaceId }: { workspaceId: number }) {
  return (
    <div className="space-y-6">
      <SubscriptionProvidersCard workspaceId={workspaceId} />
      <WorkspaceRequirementCard workspaceId={workspaceId} />
    </div>
  );
}

/** Exported so its own behaviour can be exercised without the provider card's
 *  queries and second Save button in the way. */
export function WorkspaceRequirementCard({ workspaceId }: { workspaceId: number }) {
  const t = useTranslations("subscriptionWorkspace");
  const queryClient = useQueryClient();
  const requirementKey = ["subscription-requirement", workspaceId] as const;

  const requirementQuery = useQuery({
    queryKey: requirementKey,
    queryFn: () => balancerAdminService.getSubscriptionRequirement(workspaceId),
    refetchOnWindowFocus: false
  });

  // The editor's `availableProviders` contract is "configured AND enabled", and the
  // card above is the only surface that enables them — so read the same list it
  // renders instead of hardcoding the provider pair the form builder guessed at.
  // Same query key, so enabling a provider there refreshes the options here.
  const providersQuery = useQuery({
    queryKey: ["subscription-providers", workspaceId] as const,
    queryFn: () => balancerAdminService.listSubscriptionProviders(workspaceId),
    refetchOnWindowFocus: false
  });
  const availableProviders = (providersQuery.data?.configs ?? [])
    .filter((config) => config.enabled)
    .map((config) => config.provider);

  const stored = requirementQuery.data?.requirement ?? EMPTY_REQUIREMENT;
  // `null` means "no local edits", so a refetch that changes nothing cannot
  // clobber an in-progress rule the admin has not saved yet.
  const [draft, setDraft] = useState<SubscriptionRequirement | null>(null);
  const value = draft ?? stored;

  const save = useMutation({
    mutationFn: () =>
      balancerAdminService.upsertSubscriptionRequirement(workspaceId, { requirement: value }),
    onSuccess: async () => {
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: requirementKey });
      notify.success(t("saved"));
    },
    onError: (error: unknown) =>
      notify.error(error instanceof Error ? error.message : t("saveFailed"))
  });

  // Any change to a live rule changes who is admitted, across every tournament in the
  // workspace at once -- so the warning tracks CHANGE, not just emptying. Tightening
  // Boosty 1 -> 3, or `any` -> `all`, retroactively refuses patrons the gate already
  // let in, which mid-tournament is as consequential as disarming it. `draft === null`
  // means untouched, and `sameRule` absorbs an edit-then-revert.
  const changed = draft !== null && !sameRule(value, stored);
  // Emptying is called out separately: it disarms every tournament whose own
  // `require_subscription` toggle is still on, and those then admit everybody without
  // saying so -- the opposite failure from the one above.
  const disarming = (value.requirements?.length ?? 0) === 0;
  // The server counts the tournaments actually gated by this rule (same predicate the
  // collector sweeps on), so the copy can name the blast radius instead of gesturing at it.
  const enforcingTournaments = requirementQuery.data?.enforcing_tournaments ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle asChild>
          <h2>{t("title")}</h2>
        </CardTitle>
        <CardDescription className="max-w-prose">{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {requirementQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        ) : requirementQuery.isError ? (
          <p className="text-sm text-danger">{t("loadError")}</p>
        ) : (
          <>
            <SubscriptionRequirementEditor
              value={value}
              availableProviders={availableProviders}
              onChange={setDraft}
            />

            {changed && (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-2.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                <p className="max-w-prose text-xs text-warning">
                  {t(disarming ? "warning.disarming" : "warning.changed", {
                    count: enforcingTournaments
                  })}
                </p>
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button
                type="button"
                onClick={() => save.mutate()}
                disabled={save.isPending || draft === null}
              >
                {save.isPending ? t("saving") : t("save")}
              </Button>
              {draft !== null && !save.isPending && (
                <span className="text-xs text-muted-foreground">{t("unsavedChanges")}</span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
