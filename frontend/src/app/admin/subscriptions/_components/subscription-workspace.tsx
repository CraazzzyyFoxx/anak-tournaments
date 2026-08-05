"use client";

// The workspace-scoped half of subscription admin: which providers exist, and the
// single rule every tournament in the workspace enforces. Both used to live in the
// per-tournament registration form builder, which re-asked the same question for
// every new tournament.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

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
      notify.success("Workspace subscription requirement saved");
    },
    onError: (error: unknown) =>
      notify.error(
        error instanceof Error ? error.message : "Failed to save the subscription requirement"
      )
  });

  // Emptying the rule disarms every tournament in the workspace at once, including
  // ones whose own `require_subscription` toggle is still on — those then admit
  // everybody without saying so. No endpoint aggregates that count (the toggle
  // lives on each tournament's own registration form, so counting would be one
  // request per tournament), so warn about the action rather than quote a number.
  const clearing =
    (stored.requirements?.length ?? 0) > 0 && (value.requirements?.length ?? 0) === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle asChild>
          <h2>Subscription requirement</h2>
        </CardTitle>
        <CardDescription className="max-w-prose">
          One rule for the whole workspace. Each tournament only decides whether to enforce it,
          with the &quot;Require an active subscription&quot; toggle on its registration form.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {requirementQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : requirementQuery.isError ? (
          <p className="text-sm text-danger">
            Couldn&apos;t load the requirement. Check your connection and reload the page.
          </p>
        ) : (
          <>
            <SubscriptionRequirementEditor
              value={value}
              availableProviders={availableProviders}
              onChange={setDraft}
            />

            {clearing && (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-2.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                <p className="max-w-prose text-xs text-warning">
                  Clearing the rule stops enforcement for every tournament in this workspace,
                  including any whose &quot;Require an active subscription&quot; toggle is still
                  on — those will admit everybody without reporting a reason.
                </p>
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button
                type="button"
                onClick={() => save.mutate()}
                disabled={save.isPending || draft === null}
              >
                {save.isPending ? "Saving…" : "Save"}
              </Button>
              {draft !== null && !save.isPending && (
                <span className="text-xs text-muted-foreground">Unsaved changes</span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
