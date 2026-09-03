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
} from "@/components/admin/people/PersonSubscriptionPanel";
import { SubscriptionSettingsPanel } from "./_components/subscription-settings";

interface SelectedPlayer {
  userId: number;
  label: string;
}

type TabValue = "status" | "settings";

const TABS: readonly TabValue[] = ["status", "settings"];

// Collapse a burst into one refetch: a sweep publishes one signal per resolve
// pass, but a manual re-check of a player registered in several workspaces still
// lands several in a row.
const REALTIME_REFRESH_DEBOUNCE_MS = 500;

export default function SubscriptionCollectionAdminPage() {
  // Mirrors /admin/rank: the collector's global config stays superuser-only, while
  // health, history and per-player inspection are gated on `subscription.read` and
  // scoped to the active workspace (see `admin.service.ts`) — which is what lets a
  // workspace owner/admin open the tab at all instead of 403ing on a global role.
  //
  // Provider configuration and the workspace admission rule are NOT here: they are
  // workspace settings, and live at /admin/settings/subscriptions.
  const { isSuperuser } = usePermissions();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const searchParams = useSearchParams();
  // `?tab=` exists so a deep link can land on the tab it means. Read once, for the
  // initial value only: after mount the toggle group owns the tab, so clicking around
  // must not be fought by a URL that no longer reflects it. Anything absent or
  // unrecognised keeps the historical default rather than 404ing a tab -- the param is
  // a convenience, not a route.
  //
  // Clamped against permission, not just membership of TABS: without the clamp
  // `activeTab` would sit on a tab whose ToggleGroupItem is not even in the tree,
  // leaving the group with nothing selected while the status dashboard renders.
  const [activeTab, setActiveTab] = useState<TabValue>(() => {
    const requested = searchParams.get("tab");
    if (!TABS.includes(requested as TabValue)) return "status";
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

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Subscription collection"
        description="Boosty and Twitch subscription check health, live check history and per-player inspection, scoped to the active workspace."
        actions={<SubscriptionPlayerSearch onSelect={openPlayer} />}
      />

      {isSuperuser && (
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
          <ToggleGroupItem value="settings">Settings</ToggleGroupItem>
        </ToggleGroup>
      )}

      {activeTab === "settings" && isSuperuser ? (
        <SubscriptionSettingsPanel />
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
