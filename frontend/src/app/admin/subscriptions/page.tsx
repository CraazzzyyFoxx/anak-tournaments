"use client";

import { useState } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { usePermissions } from "@/hooks/usePermissions";

import { SubscriptionHealthDashboard } from "./_components/subscription-health";
import { SubscriptionTaskHistory } from "./_components/subscription-history";
import {
  SubscriptionPlayerDetail,
  SubscriptionPlayerSearch
} from "./_components/subscription-player";
import { SubscriptionSettingsPanel } from "./_components/subscription-settings";

interface SelectedPlayer {
  userId: number;
  label: string;
}

type TabValue = "status" | "settings";

export default function SubscriptionCollectionAdminPage() {
  // Mirrors /admin/rank: the collector's global config stays superuser-only, while
  // health, history and per-player inspection are open to admins.
  const { isSuperuser } = usePermissions();
  const [activeTab, setActiveTab] = useState<TabValue>("status");
  const [selected, setSelected] = useState<SelectedPlayer | null>(null);
  const openPlayer = (userId: number, label: string) => setSelected({ userId, label });

  const showSettingsTab = activeTab === "settings" && isSuperuser;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Subscription collection"
        description="Boosty and Twitch subscription check health, live check history and per-player inspection."
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

      {showSettingsTab ? (
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
