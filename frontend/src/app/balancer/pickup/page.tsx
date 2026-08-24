"use client";

import { useEffect, useState } from "react";

import { MixGamesPanel } from "@/app/balancer/pickup/MixGamesPanel";
import { WorkspacePlayersSidebar } from "@/app/balancer/components/WorkspacePlayersSidebar";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { usePermissions } from "@/hooks/usePermissions";
import { customGameService } from "@/services/custom-game.service";
import type { WorkspacePlayer } from "@/services/workspace-player.service";
import { useWorkspaceStore } from "@/stores/workspace.store";

export default function BalancerPickupPage() {
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const { canAccessPermission } = usePermissions();
  const canEdit = workspaceId != null && canAccessPermission("team.update", workspaceId);

  const [collapsed, setCollapsed] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
  const [rosterIds, setRosterIds] = useState<number[]>([]);
  const [knownPlayers, setKnownPlayers] = useState<Map<number, WorkspacePlayer>>(new Map());

  useEffect(() => {
    if (workspaceId == null || selectedGameId == null) return;
    let cancelled = false;
    customGameService.get(workspaceId, selectedGameId).then((game) => {
      if (!cancelled) setRosterIds(game.players?.map((row) => row.workspace_player_id) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, selectedGameId]);

  if (workspaceId == null) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Pick a workspace in the top bar to open mixes.
      </div>
    );
  }

  const remember = (player: WorkspacePlayer) => {
    setKnownPlayers((current) => {
      const next = new Map(current);
      next.set(player.id, player);
      return next;
    });
  };

  return (
    <ResizablePanelGroup direction="horizontal" autoSaveId="balancer-mix-panel-layout" className="min-h-0 flex-1">
      <ResizablePanel
        id="balancer-mix-players"
        defaultSize={28}
        minSize={18}
        maxSize={42}
        collapsible
        collapsedSize={5}
        onCollapse={() => setCollapsed(true)}
        onExpand={() => setCollapsed(false)}
        className="grid min-h-0"
      >
        <WorkspacePlayersSidebar
          workspaceId={workspaceId}
          canEdit={canEdit}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((value) => !value)}
          selectedIds={rosterIds}
          onTogglePlayer={(player) => {
            remember(player);
            setRosterIds((current) =>
              current.includes(player.id) ? current.filter((id) => id !== player.id) : [...current, player.id],
            );
          }}
        />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel id="balancer-mix-games" minSize={40} className="grid min-h-0 pl-3">
        <MixGamesPanel
          workspaceId={workspaceId}
          canEdit={canEdit}
          selectedGameId={selectedGameId}
          onSelectGame={setSelectedGameId}
          rosterIds={rosterIds}
          knownPlayers={knownPlayers}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
