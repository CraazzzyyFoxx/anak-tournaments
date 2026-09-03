"use client";

import SubscriptionProvidersCard from "@/components/admin/subscriptions/SubscriptionProviderCard";
import { PageStateCard } from "@/components/ui/page-state-card";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspaceStore } from "@/stores/workspace.store";

import { WorkspaceRequirementCard } from "./_components/workspace-requirement";

/**
 * Subscription entitlements: which providers this workspace checks against, and
 * the single admission rule every one of its tournaments enforces.
 *
 * This is workspace configuration, which is why it sits in settings rather than
 * on the collector dashboard it used to share a tab strip with — the dashboard
 * answers "are the checks running", this answers "what are they checking".
 */
export default function WorkspaceSubscriptionsSettingsPage() {
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const { canAccessPermission } = usePermissions();
  // The provider-config RPCs behind this section are gated on team.read/team.update
  // (`sub_config_list` / `sub_config_upsert`), so reuse that permission rather than
  // invent a role check: whoever can open this can also save what is on it.
  const canConfigureWorkspace = canAccessPermission("team.update", workspaceId);

  if (workspaceId === null) {
    return (
      <PageStateCard
        state="empty"
        title="No workspace selected"
        description="Pick a workspace in the sidebar to configure its subscription providers and admission rule."
      />
    );
  }

  if (!canConfigureWorkspace) {
    return (
      <PageStateCard
        state="not-found"
        title="Not available"
        description="Configuring subscription providers needs the team.update permission in this workspace."
      />
    );
  }

  return (
    <div className="space-y-6">
      <SubscriptionProvidersCard workspaceId={workspaceId} />
      <WorkspaceRequirementCard workspaceId={workspaceId} />
    </div>
  );
}
