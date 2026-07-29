"use client";

import { useState } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Rank Collection</h1>
          <p className="mt-2 text-muted-foreground">
            OverFast collection health, live worker task history and per-player inspection.
          </p>
        </div>
        <div className="sm:pt-1">
          <RankPlayerSearch onSelect={openPlayer} />
        </div>
      </div>

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
