"use client";

import { useState } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { usePermissions } from "@/hooks/usePermissions";

import { RankHealthDashboard } from "./_components/rank-health";
import { RankPlayerDetail, RankPlayerSearch } from "./_components/rank-player";
import { RankSettingsPanel } from "./_components/rank-settings";
import { RankTaskHistory } from "./_components/rank-task-history";

interface SelectedPlayer {
  userId: number;
  label: string;
}

type TabValue = "status" | "settings";

export default function RankCollectionAdminPage() {
  // D10: the former /admin/settings content (global rank config) lives in the
  // Settings tab and stays superuser-only, matching the old page's gate.
  const { isSuperuser } = usePermissions();
  const [activeTab, setActiveTab] = useState<TabValue>("status");
  const [selected, setSelected] = useState<SelectedPlayer | null>(null);
  const openPlayer = (userId: number, label: string) => setSelected({ userId, label });

  const showSettingsTab = activeTab === "settings" && isSuperuser;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Rank collection"
        description="OverFast collection health, live worker task history and per-player inspection."
        actions={<RankPlayerSearch onSelect={openPlayer} />}
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
        <RankSettingsPanel />
      ) : (
        <>
          <RankHealthDashboard />
          <RankTaskHistory onSelectUser={openPlayer} />

          {selected && (
            <RankPlayerDetail
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
