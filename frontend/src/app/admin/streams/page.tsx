"use client";

import { useState } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { usePermissions } from "@/hooks/usePermissions";

import { StreamHealthDashboard } from "./_components/stream-health";
import { StreamSettingsPanel } from "./_components/stream-settings";

type TabValue = "status" | "settings";

export default function StreamCollectionAdminPage() {
  // Two different gates, mirroring /admin/rank and /admin/subscriptions:
  //
  // Status is gated on `stream.read` — and on the GLOBAL grant, not a
  // workspace-scoped one, because there is one poller and one Redis key behind
  // `GET /api/streams/health`; `canAccessPermission(..., null)` is what asks for
  // the global form. That is also why this page has no workspace switcher
  // dimension: the numbers carry none.
  //
  // Settings writes `stream.collection` through `PUT /api/v1/admin/settings/{key}`,
  // which is superuser-only, so the tab is offered only to a superuser rather
  // than letting a `stream.read` holder open a form that 403s on save.
  const { isSuperuser, canAccessPermission } = usePermissions();
  const canReadHealth = canAccessPermission("stream.read", null);
  const [activeTab, setActiveTab] = useState<TabValue>("status");

  const showSettingsTab = activeTab === "settings" && isSuperuser;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Stream collection"
        description="Twitch live-status poller health and its runtime configuration. Platform-wide — one poller serves every workspace."
      />

      {isSuperuser && (
        <ToggleGroup
          type="single"
          value={activeTab}
          onValueChange={(value) => { if (value) setActiveTab(value as TabValue); }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="status">Status</ToggleGroupItem>
          <ToggleGroupItem value="settings">Settings</ToggleGroupItem>
        </ToggleGroup>
      )}

      {showSettingsTab ? (
        <StreamSettingsPanel />
      ) : canReadHealth ? (
        <StreamHealthDashboard />
      ) : (
        // Reachable: the nav gate and this one agree, but a superuser without a
        // global `stream.read` grant lands here from the Settings tab. Saying so
        // beats an empty page or a bare 403 toast.
        <p className="text-sm text-muted-foreground">
          You need the global <code>stream.read</code> permission to see poller health.
        </p>
      )}
    </div>
  );
}
