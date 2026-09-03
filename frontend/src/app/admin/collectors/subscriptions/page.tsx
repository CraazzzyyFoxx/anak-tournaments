"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { SubscriptionHealthDashboard } from "@/components/admin/collectors/subscription-health";
import { SubscriptionTaskHistory } from "@/components/admin/collectors/subscription-history";
import { SubscriptionSettingsPanel } from "@/components/admin/collectors/subscription-settings";
import { useCollectorTab } from "@/components/admin/collectors/useCollectorTab";
import { AdminTabs } from "@/components/admin/kit/AdminTabs";
import { PageStateCard } from "@/components/ui/page-state-card";
import { usePermissions } from "@/hooks/usePermissions";
import { useRealtimeCoalescedRefetch } from "@/hooks/useRealtimeCoalescedRefetch";
import { useWorkspaceStore } from "@/stores/workspace.store";

// Collapse a burst into one refetch: a sweep publishes one signal per resolve
// pass, but a manual re-check of a player registered in several workspaces still
// lands several in a row.
const REALTIME_REFRESH_DEBOUNCE_MS = 500;

/**
 * The Boosty/Twitch subscription collector: health, check history and config.
 *
 * Same two gates as the rank collector — `subscription.read` scoped to the
 * active workspace for health and history, superuser for the config that
 * `PUT /api/v1/admin/settings/{key}` will only accept from one.
 *
 * Provider configuration and the workspace admission rule are NOT here: they
 * are workspace settings, and live at /admin/settings/subscriptions.
 */
export default function SubscriptionCollectorPage() {
  const { canAccessPermission, isSuperuser } = usePermissions();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const canRead = canAccessPermission("subscription.read");

  const { activeKey, items } = useCollectorTab("subscriptions", [
    { key: "status", label: "Status" },
    { key: "history", label: "History" },
    { key: "settings", label: "Settings", hidden: !isSuperuser }
  ]);

  // Every query on this page lives under the `["admin","subscriptions"]` prefix,
  // so one invalidation covers health and the check log. The signal is
  // workspace-scoped, which is exactly this page's scope.
  const queryClient = useQueryClient();
  const refetchAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "subscriptions"] });
  }, [queryClient]);
  useRealtimeCoalescedRefetch(
    currentWorkspaceId != null && canRead ? `workspace:${currentWorkspaceId}:subscriptions` : null,
    {
      minDelayMs: REALTIME_REFRESH_DEBOUNCE_MS,
      onEvent: (_event, schedule) => schedule(),
      onFlush: refetchAll
    }
  );

  if (!canRead) {
    return (
      <PageStateCard
        state="not-found"
        title="Not available"
        description="Reading subscription collection health needs the subscription.read permission in this workspace."
      />
    );
  }

  return (
    <div className="space-y-4">
      <AdminTabs
        items={items}
        activeKey={activeKey}
        level={2}
        ariaLabel="Subscription collector views"
      />
      {activeKey === "settings" ? (
        <SubscriptionSettingsPanel />
      ) : activeKey === "history" ? (
        <SubscriptionTaskHistory />
      ) : (
        <SubscriptionHealthDashboard />
      )}
    </div>
  );
}
