"use client";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { usePermissions } from "@/hooks/usePermissions";
import { useRealtimeCoalescedRefetch } from "@/hooks/useRealtimeCoalescedRefetch";
import { useWorkspaceStore } from "@/stores/workspace.store";

import { SubscriptionHealthDashboard } from "./_components/subscription-health";
import { SubscriptionTaskHistory } from "./_components/subscription-history";
import {
  SubscriptionPlayerDetail,
  SubscriptionPlayerSearch
} from "./_components/subscription-player";
import { SubscriptionSettingsPanel } from "./_components/subscription-settings";
import { WorkspaceSubscriptionPanel } from "./_components/subscription-workspace";

interface SelectedPlayer {
  userId: number;
  label: string;
}

type TabValue = "status" | "settings" | "providers";

const TABS: readonly TabValue[] = ["status", "settings", "providers"];

// Collapse a burst into one refetch: a sweep publishes one signal per resolve
// pass, but a manual re-check of a player registered in several workspaces still
// lands several in a row.
const REALTIME_REFRESH_DEBOUNCE_MS = 500;

export default function SubscriptionCollectionAdminPage() {
  // Mirrors /admin/rank: the collector's global config stays superuser-only, while
  // health, history and per-player inspection are gated on `subscription.read` and
  // scoped to the active workspace (see `admin.service.ts`) — which is what lets a
  // workspace owner/admin open the tab at all instead of 403ing on a global role.
  const { isSuperuser, canAccessPermission } = usePermissions();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  // The provider-config RPCs behind this tab are gated on team.read/team.update
  // (`sub_config_list` / `sub_config_upsert`), so reuse that permission rather than
  // invent a role check: whoever sees the tab can also save what is on it.
  const canConfigureWorkspace = canAccessPermission("team.update", currentWorkspaceId);
  const searchParams = useSearchParams();
  // `?tab=` exists so a deep link can land on the tab it means -- the registration form
  // builder links straight to `?tab=providers`, where the workspace rule is edited.
  // Read once, for the initial value only: after mount the toggle group owns the tab, so
  // clicking around must not be fought by a URL that no longer reflects it. Anything
  // absent or unrecognised keeps the historical default rather than 404ing a tab -- the
  // param is a convenience, not a route.
  //
  // Clamped against permission, not just membership of TABS. The link is rendered in the
  // registration form builder under a DIFFERENT permission, so a user without
  // `team.update` can follow it; without the clamp `activeTab` would sit on a tab whose
  // ToggleGroupItem is not even in the tree, leaving the group with nothing selected
  // while the status dashboard renders -- the page silently ignoring the link they just
  // followed.
  const [activeTab, setActiveTab] = useState<TabValue>(() => {
    const requested = searchParams.get("tab");
    if (!TABS.includes(requested as TabValue)) return "status";
    if (requested === "providers" && !canConfigureWorkspace) return "status";
    if (requested === "settings" && !isSuperuser) return "status";
    return requested as TabValue;
  });
  const [selected, setSelected] = useState<SelectedPlayer | null>(null);
  const openPlayer = (userId: number, label: string) => setSelected({ userId, label });

  // Every query on this page lives under the `["admin","subscriptions"]` prefix,
  // so one invalidation covers health, the check log and the per-player panel.
  // The signal is workspace-scoped, which is exactly this page's scope.
  const queryClient = useQueryClient();
  const refetchAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "subscriptions"] });
  }, [queryClient]);
  useRealtimeCoalescedRefetch(
    currentWorkspaceId != null ? `workspace:${currentWorkspaceId}:subscriptions` : null,
    {
      minDelayMs: REALTIME_REFRESH_DEBOUNCE_MS,
      onEvent: (_event, schedule) => schedule(),
      onFlush: refetchAll,
    }
  );

  const showSettingsTab = activeTab === "settings" && isSuperuser;
  const showProvidersTab = activeTab === "providers" && canConfigureWorkspace;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Subscription collection"
        description="Boosty and Twitch subscription check health, live check history and per-player inspection, scoped to the active workspace."
        actions={<SubscriptionPlayerSearch onSelect={openPlayer} />}
      />

      {(isSuperuser || canConfigureWorkspace) && (
        <ToggleGroup
          type="single"
          value={activeTab}
          onValueChange={(value) => {
            if (value) setActiveTab(value as TabValue);
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="status">Status</ToggleGroupItem>
          {isSuperuser && <ToggleGroupItem value="settings">Settings</ToggleGroupItem>}
          {canConfigureWorkspace && (
            <ToggleGroupItem value="providers">Providers</ToggleGroupItem>
          )}
        </ToggleGroup>
      )}

      {showSettingsTab ? (
        <SubscriptionSettingsPanel />
      ) : showProvidersTab ? (
        currentWorkspaceId ? (
          <WorkspaceSubscriptionPanel workspaceId={currentWorkspaceId} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Select a workspace to configure its subscription providers and requirement.
          </p>
        )
      ) : (
        <>
          <SubscriptionHealthDashboard />
          <SubscriptionTaskHistory onSelectUser={openPlayer} />

          {selected && (
            <SubscriptionPlayerDetail
              userId={selected.userId}
              label={selected.label}
              onClose={() => setSelected(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
