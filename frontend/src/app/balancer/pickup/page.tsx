"use client";

import { useState } from "react";

import { PickupLineupPanel } from "@/app/balancer/pickup/PickupLineupPanel";
import { usePickupMix } from "@/app/balancer/pickup/usePickupMix";
import { WorkspacePlayersSidebar } from "@/app/balancer/components/WorkspacePlayersSidebar";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspaceStore } from "@/stores/workspace.store";

/**
 * Pickup mixes: the workspace player pool on the left, one mix's lineup on the
 * right. The mix detail query owns the lineup, so clicking a player in the pool
 * writes membership straight through instead of accumulating a local draft the
 * host has to remember to save.
 */
export default function BalancerPickupPage() {
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const { canAccessPermission } = usePermissions();
  const canEdit = workspaceId != null && canAccessPermission("team.update", workspaceId);

  const [collapsed, setCollapsed] = useState(false);
  const [pickedGameId, setPickedGameId] = useState<number | null>(null);

  const { selectedGameId, gamesQuery, gameQuery, createGame, setRoster, patchPlayer, balance } =
    usePickupMix(workspaceId ?? 0, pickedGameId);

  const games = gamesQuery.data ?? [];
  const game = gameQuery.data;
  const rosterIds = (game?.players ?? []).map((row) => row.workspace_player_id);

  if (workspaceId == null) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Pick a workspace in the top bar to open mixes.
      </div>
    );
  }

  const togglePoolPlayer = (playerId: number) => {
    if (selectedGameId == null) return;
    setRoster.mutate(
      rosterIds.includes(playerId) ? rosterIds.filter((id) => id !== playerId) : [...rosterIds, playerId],
    );
  };

  return (
    <ResizablePanelGroup
      direction="horizontal"
      autoSaveId="balancer-mix-panel-layout"
      className="min-h-0 flex-1"
    >
      <ResizablePanel
        id="balancer-mix-players"
        defaultSize={32}
        minSize={22}
        maxSize={46}
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
          onTogglePlayer={(player) => togglePoolPlayer(player.id)}
        />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel id="balancer-mix-games" minSize={40} className="grid min-h-0 pl-3">
        <PickupLineupPanel
          canEdit={canEdit}
          games={games}
          gamesLoading={gamesQuery.isLoading}
          gamesError={gamesQuery.isError}
          onRetryGames={() => void gamesQuery.refetch()}
          game={game}
          gameLoading={gameQuery.isLoading}
          selectedGameId={selectedGameId}
          onSelectGame={setPickedGameId}
          creating={createGame.isPending}
          onCreateGame={(name) =>
            createGame.mutate(name, { onSuccess: (created) => setPickedGameId(created.id) })
          }
          balancing={balance.isPending}
          onBalance={() => balance.mutate()}
          savingPlayerId={patchPlayer.isPending ? (patchPlayer.variables?.workspacePlayerId ?? null) : null}
          onPatchPlayer={(workspacePlayerId, patch) => patchPlayer.mutate({ workspacePlayerId, patch })}
          onRemovePlayer={togglePoolPlayer}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
