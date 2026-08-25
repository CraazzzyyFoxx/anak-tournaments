"use client";

import { useState } from "react";

import { PickupAddPlayersDialog } from "@/app/balancer/pickup/PickupAddPlayersDialog";
import { PickupLobbyBoard } from "@/app/balancer/pickup/PickupLobbyBoard";
import { PickupLobbyPanel } from "@/app/balancer/pickup/PickupLobbyPanel";
import { PickupMixHeader } from "@/app/balancer/pickup/PickupMixHeader";
import { PickupPlayerSheet } from "@/app/balancer/pickup/PickupPlayerSheet";
import { PickupTeamsPanel } from "@/app/balancer/pickup/PickupTeamsPanel";
import {
  PICKUP_TERMINAL_STATUSES,
  parseOutcome,
  parseVariants,
  playerLabel,
  summarizeLineup,
} from "@/app/balancer/pickup/pickup-lineup";
import { usePickupMix } from "@/app/balancer/pickup/usePickupMix";
import { usePermissions } from "@/hooks/usePermissions";
import { notify } from "@/lib/notify";
import { useWorkspaceStore } from "@/stores/workspace.store";

/**
 * A mix in two columns: the **lineup** a host curates, and the **matchup** the
 * solver produced from it.
 *
 * Those are the only two things on screen at once because they are the only two
 * a host reads together — "is this pool balanceable" and "is this balance fair".
 * The workspace roster is a third question asked twice a night, so it lives in
 * an overlay (`PickupAddPlayersDialog`) instead of a permanent column, and
 * detail lives in a sheet.
 *
 * The open balance option is page state, not panel state: the fullscreen board
 * and the inline matchup must never disagree about which option is being read
 * out to a lobby.
 */
export default function BalancerPickupPage() {
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const { canAccessPermission } = usePermissions();
  // The mix-hosting grant, not a tournament permission: a workspace member can
  // run a pickup game without holding admin rights over teams.
  const canEdit = workspaceId != null && canAccessPermission("custom_game.create", workspaceId);

  const [pickedGameId, setPickedGameId] = useState<number | null>(null);
  const [openPlayerId, setOpenPlayerId] = useState<number | null>(null);
  const [isPoolOpen, setIsPoolOpen] = useState(false);
  const [isBoardOpen, setIsBoardOpen] = useState(false);
  const [variantIndex, setVariantIndex] = useState(0);

  const {
    selectedGameId,
    gamesQuery,
    gameQuery,
    createGame,
    setRoster,
    patchPlayer,
    balance,
    recordOutcome,
    setAuthorRanks,
  } = usePickupMix(workspaceId ?? 0, pickedGameId);

  const games = gamesQuery.data ?? [];
  const game = gameQuery.data;
  const rows = game?.players ?? [];
  const rosterIds = rows.map((row) => row.workspace_member_id);
  // A completed or cancelled mix is read-only server-side; hide its controls
  // rather than let a click 409.
  const canWrite = canEdit && game != null && !PICKUP_TERMINAL_STATUSES[game.status];
  const openRow = rows.find((row) => row.workspace_member_id === openPlayerId) ?? null;
  const savingPlayerId = patchPlayer.isPending
    ? (patchPlayer.variables?.workspaceMemberId ?? null)
    : null;

  const variants = parseVariants(game?.result_json);
  const boardIndex = Math.min(variantIndex, Math.max(0, variants.length - 1));
  const boardVariant = variants[boardIndex];

  if (workspaceId == null) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Pick a workspace in the top bar to open mixes.
      </div>
    );
  }

  const togglePoolMember = (memberId: number) => {
    if (selectedGameId == null) return;
    setRoster.mutate(
      rosterIds.includes(memberId)
        ? rosterIds.filter((id) => id !== memberId)
        : [...rosterIds, memberId],
    );
  };

  const copyBattleTags = () => {
    const tags = rows
      .filter((row) => row.is_active)
      .map((row) => row.battle_tag ?? playerLabel(row));
    if (tags.length === 0) {
      notify.error("Nobody is in the balance yet");
      return;
    }
    void navigator.clipboard
      .writeText(tags.join("\n"))
      .then(() => notify.success(`Copied ${tags.length} battletags`))
      .catch(() => notify.error("Could not reach the clipboard"));
  };

  return (
    <>
      {/* At `xl` the tool is a fixed viewport shell, so this column owns the
          height and each panel scrolls inside it. Below that the page stacks and
          scrolls as one document. */}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto xl:overflow-hidden">
        <PickupMixHeader
          canEdit={canEdit}
          games={games}
          gamesLoading={gamesQuery.isLoading}
          game={game}
          selectedGameId={selectedGameId}
          onSelectGame={setPickedGameId}
          creating={createGame.isPending}
          onCreateGame={(name) =>
            createGame.mutate(name, { onSuccess: (created) => setPickedGameId(created.id) })
          }
          onOpenPool={() => setIsPoolOpen(true)}
        />

        {/* Fixed-width lineup, fluid matchup: the lineup's content is a known
            set of columns (switch, name, three role glyphs, rank) that stops
            improving past ~570px, while the matchup absorbs the width it is
            given up to its own cap. Both columns run the full height so the
            lineup no longer ends in dead space halfway down a 1440p screen. */}
        <div className="flex min-h-0 flex-col gap-5 xl:min-h-0 xl:flex-1 xl:flex-row">
          <div className="min-h-0 xl:h-full xl:w-[568px] xl:shrink-0">
            <PickupLobbyPanel
              canWrite={canWrite}
              hasMix={selectedGameId != null}
              rows={rows}
              savingPlayerId={savingPlayerId}
              clearing={setRoster.isPending}
              onPatchPlayer={(workspaceMemberId, patch) =>
                patchPlayer.mutate({ workspaceMemberId, patch })
              }
              onClear={() => setRoster.mutate([])}
              onRemovePlayer={togglePoolMember}
              onOpenPlayer={setOpenPlayerId}
              onOpenPool={() => setIsPoolOpen(true)}
            />
          </div>

          <div className="min-w-0 flex-1 xl:h-full xl:min-h-0">
            <PickupTeamsPanel
              canWrite={canWrite}
              gamesLoading={gamesQuery.isLoading}
              gamesError={gamesQuery.isError}
              onRetryGames={() => void gamesQuery.refetch()}
              game={game}
              gameLoading={gameQuery.isLoading}
              hasMix={selectedGameId != null}
              balancing={balance.isPending}
              activeCount={summarizeLineup(rows).active}
              onBalance={() => balance.mutate()}
              variantIndex={variantIndex}
              onVariantIndexChange={setVariantIndex}
              recordingOutcome={recordOutcome.isPending}
              onRecordOutcome={(outcome) => recordOutcome.mutate(outcome)}
              onShowBoard={() => setIsBoardOpen(true)}
              onCopyBattleTags={copyBattleTags}
            />
          </div>
        </div>
      </div>

      <PickupAddPlayersDialog
        open={isPoolOpen}
        onOpenChange={setIsPoolOpen}
        workspaceId={workspaceId}
        canEdit={canEdit}
        canWrite={canWrite}
        rows={rows}
        games={games}
        currentGameId={selectedGameId}
        onTogglePlayer={togglePoolMember}
      />

      <PickupPlayerSheet
        row={openRow}
        canEdit={canWrite}
        saving={openRow != null && savingPlayerId === openRow.workspace_member_id}
        onOpenChange={(open) => {
          if (!open) setOpenPlayerId(null);
        }}
        onPatch={(patch) => {
          if (openRow)
            patchPlayer.mutate({ workspaceMemberId: openRow.workspace_member_id, patch });
        }}
        onSetAuthorRank={(role, rank) => {
          if (!openRow) return;
          setAuthorRanks.mutate(
            rank == null
              ? { workspaceMemberId: openRow.workspace_member_id, ranks: {}, clear: [role] }
              : { workspaceMemberId: openRow.workspace_member_id, ranks: { [role]: rank } },
          );
        }}
        onRemove={() => {
          if (openRow) {
            togglePoolMember(openRow.workspace_member_id);
            setOpenPlayerId(null);
          }
        }}
      />

      {isBoardOpen && boardVariant != null ? (
        <PickupLobbyBoard
          mixName={game?.name ?? "Mix"}
          variant={boardVariant}
          variantIndex={boardIndex}
          variantCount={variants.length}
          onVariantIndexChange={setVariantIndex}
          outcome={parseOutcome(game?.outcome_json)}
          canWrite={canWrite}
          recordingOutcome={recordOutcome.isPending}
          onRecordOutcome={(outcome) => recordOutcome.mutate(outcome)}
          onClose={() => setIsBoardOpen(false)}
        />
      ) : null}
    </>
  );
}
