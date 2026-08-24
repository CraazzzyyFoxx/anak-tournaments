"use client";

import { useState } from "react";

import { WorkspacePlayersSidebar } from "@/app/balancer/components/WorkspacePlayersSidebar";
import { PickupLobbyPanel } from "@/app/balancer/pickup/PickupLobbyPanel";
import { PickupPlayerSheet } from "@/app/balancer/pickup/PickupPlayerSheet";
import { PickupTeamsPanel } from "@/app/balancer/pickup/PickupTeamsPanel";
import { PICKUP_TERMINAL_STATUSES, summarizeLineup } from "@/app/balancer/pickup/pickup-lineup";
import { usePickupMix } from "@/app/balancer/pickup/usePickupMix";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspaceStore } from "@/stores/workspace.store";

/**
 * Pickup mixes in three columns: the workspace player **pool**, this mix's
 * **lobby**, and the **teams** the solver produced.
 *
 * The split mirrors the three decisions a host makes in order — who exists, who
 * is playing tonight, and who is on which team — so each column owns exactly one
 * of them. Membership is written straight through on a pool click instead of
 * accumulating a local draft the host has to remember to save.
 */
export default function BalancerPickupPage() {
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const { canAccessPermission } = usePermissions();
  const canEdit = workspaceId != null && canAccessPermission("team.update", workspaceId);

  const [collapsed, setCollapsed] = useState(false);
  const [pickedGameId, setPickedGameId] = useState<number | null>(null);
  const [openPlayerId, setOpenPlayerId] = useState<number | null>(null);

  const { selectedGameId, gamesQuery, gameQuery, createGame, setRoster, patchPlayer, balance } =
    usePickupMix(workspaceId ?? 0, pickedGameId);

  const games = gamesQuery.data ?? [];
  const game = gameQuery.data;
  const rows = game?.players ?? [];
  const rosterIds = rows.map((row) => row.workspace_player_id);
  // A completed or cancelled mix is read-only server-side; hide its controls
  // rather than let a click 409.
  const canWrite = canEdit && game != null && !PICKUP_TERMINAL_STATUSES[game.status];
  const openRow = rows.find((row) => row.workspace_player_id === openPlayerId) ?? null;
  const savingPlayerId = patchPlayer.isPending ? (patchPlayer.variables?.workspacePlayerId ?? null) : null;

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
    <>
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="balancer-pickup-layout"
        className="min-h-0 flex-1"
      >
        <ResizablePanel
          id="pickup-pool"
          order={1}
          defaultSize={22}
          minSize={16}
          maxSize={34}
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
        <ResizablePanel id="pickup-lobby" order={2} defaultSize={22} minSize={16} maxSize={34} className="grid min-h-0 px-3">
          <PickupLobbyPanel
            canWrite={canWrite}
            hasMix={selectedGameId != null}
            rows={rows}
            savingPlayerId={savingPlayerId}
            clearing={setRoster.isPending}
            onPatchPlayer={(workspacePlayerId, patch) => patchPlayer.mutate({ workspacePlayerId, patch })}
            onClear={() => setRoster.mutate([])}
            onOpenPlayer={setOpenPlayerId}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="pickup-teams" order={3} minSize={34} className="grid min-h-0 pl-3">
          <PickupTeamsPanel
            canEdit={canEdit}
            canWrite={canWrite}
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
            activeCount={summarizeLineup(rows).active}
            onBalance={() => balance.mutate()}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      <PickupPlayerSheet
        row={openRow}
        canEdit={canWrite}
        saving={openRow != null && savingPlayerId === openRow.workspace_player_id}
        onOpenChange={(open) => {
          if (!open) setOpenPlayerId(null);
        }}
        onPatch={(patch) => {
          if (openRow) patchPlayer.mutate({ workspacePlayerId: openRow.workspace_player_id, patch });
        }}
        onRemove={() => {
          if (openRow) {
            togglePoolPlayer(openRow.workspace_player_id);
            setOpenPlayerId(null);
          }
        }}
      />
    </>
  );
}
