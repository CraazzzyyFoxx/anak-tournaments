"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { PickupAddPlayersDialog } from "@/app/balancer/pickup/PickupAddPlayersDialog";
import { PickupLobbyBoard } from "@/app/balancer/pickup/PickupLobbyBoard";
import { PickupLobbyPanel } from "@/app/balancer/pickup/PickupLobbyPanel";
import { PickupMixConfigDialog } from "@/app/balancer/pickup/PickupMixConfigDialog";
import { PickupAccessDialog } from "@/app/balancer/pickup/PickupAccessDialog";
import { PickupMixHeader } from "@/app/balancer/pickup/PickupMixHeader";
import { PickupPlayerSheet } from "@/app/balancer/pickup/PickupPlayerSheet";
import { PickupTeamsPanel } from "@/app/balancer/pickup/PickupTeamsPanel";
import {
  PICKUP_TERMINAL_STATUSES,
  parsePointsPerWin,
  parseTeamNames,
  parseVariants,
  playerLabel,
  summarizeLineup,
} from "@/app/balancer/pickup/pickup-lineup";
import { usePickupMix } from "@/app/balancer/pickup/usePickupMix";
import balancerService from "@/services/balancer.service";
import { usePermissions } from "@/hooks/usePermissions";
import { notify } from "@/lib/notify";
import mapService from "@/services/map.service";
import { useAuthProfileStore } from "@/stores/auth-profile.store";
import { useWorkspaceStore } from "@/stores/workspace.store";

/**
 * One mix in two columns: the **lineup** a host curates, and the **matchup** the
 * solver produced from it.
 *
 * Those are the only two things on screen at once because they are the only two
 * a host reads together — "is this pool balanceable" and "is this balance fair".
 * The workspace roster is a third question asked twice a night, so it lives in
 * an overlay (`PickupAddPlayersDialog`) instead of a permanent column, and
 * detail lives in a sheet.
 *
 * Which mix this is comes from the route, not from state this screen owns —
 * switching to another one, or starting a new one, happens on the list at
 * `/balancer/pickup`. This screen only ever reads and edits the one the host
 * already picked.
 *
 * The open balance option is page state, not panel state: the fullscreen board
 * and the inline matchup must never disagree about which option is being read
 * out to a lobby.
 */
export default function BalancerPickupMixPage() {
  const params = useParams<{ gameId: string }>();
  const routeGameId = Number(params.gameId);
  const pickedGameId = Number.isFinite(routeGameId) ? routeGameId : null;

  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const currentUserId = useAuthProfileStore((state) => state.user?.id ?? null);
  const { canAccessPermission } = usePermissions();
  // The mix-hosting grant, not a tournament permission: a workspace member can
  // run a pickup game without holding admin rights over teams.
  const canEdit = workspaceId != null && canAccessPermission("custom_game.create", workspaceId);

  const [openPlayerId, setOpenPlayerId] = useState<number | null>(null);
  const [isPoolOpen, setIsPoolOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAccessOpen, setIsAccessOpen] = useState(false);
  const [isBoardOpen, setIsBoardOpen] = useState(false);
  const [variantIndex, setVariantIndex] = useState(0);
  // Which map a host is about to name a recorded match for -- the mix flow
  // has no veto, so this is a plain, optional picker beside the win buttons.
  const [mapId, setMapId] = useState<number | null>(null);
  const mapsQuery = useQuery({
    queryKey: ["maps-lookup"],
    queryFn: () => mapService.lookup(),
    staleTime: 5 * 60 * 1000,
  });
  // Field metadata + presets for the mix's "Balancer algorithm" section --
  // the same public config the tournament balancer page reads.
  const balancerConfigQuery = useQuery({
    queryKey: ["balancer-public", "config"],
    queryFn: () => balancerService.getConfig(),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const {
    selectedGameId,
    gamesQuery,
    gameQuery,
    matchesQuery,
    setRoster,
    patchPlayer,
    balance,
    recordOutcome,
    closeMix,
    setAuthorRanks,
    setTeamNames,
    setRoleMask,
    setPointsPerWin,
    setBalancerConfig,
    transferHost,
    addCoHost,
    removeCoHost,
    swapSeats,
  } = usePickupMix(workspaceId ?? 0, pickedGameId);

  const game = gameQuery.data;
  const rows = game?.players ?? [];
  const rosterIds = rows.map((row) => row.workspace_member_id);
  // Everything that writes a mix -- roster, player patch, balance, outcome --
  // goes through `_writable`, which 403s anyone but the host or a co-host.
  // That per-game grant is the actual write gate: `custom_game.create` only
  // decides who may start a *new* mix (see `canEdit` above), so a co-host
  // added to somebody else's mix writes it regardless of their own role.
  const isHost = game != null && currentUserId != null && game.host_user_id === currentUserId;
  const isCoHost =
    game != null && currentUserId != null && game.co_hosts.some((coHost) => coHost.user_id === currentUserId);
  // A completed or cancelled mix is read-only server-side; hide its controls
  // rather than let a click 409.
  const canWrite = (isHost || isCoHost) && game != null && !PICKUP_TERMINAL_STATUSES[game.status];
  // Ranks are the host's book -- `author_user_id = game.host_user_id` is the
  // layer this mix resolves against. Anyone else who typed here wrote their own
  // book, got a 200, and watched the number stay put. Not gated on `canWrite`:
  // a rank outlives the game it was typed in, so a closed mix can still be
  // corrected by its host.
  const canEditRanks = canEdit && isHost;
  const openRow = rows.find((row) => row.workspace_member_id === openPlayerId) ?? null;
  const savingPlayerId = patchPlayer.isPending
    ? (patchPlayer.variables?.workspaceMemberId ?? null)
    : null;
  // The sheet's Save can fire both mutations at once, so its own saving state
  // watches both rather than reusing the lobby row's patch-only indicator.
  const sheetSaving =
    openRow != null &&
    ((patchPlayer.isPending && patchPlayer.variables?.workspaceMemberId === openRow.workspace_member_id) ||
      (setAuthorRanks.isPending &&
        setAuthorRanks.variables?.workspaceMemberId === openRow.workspace_member_id));

  const variants = parseVariants(game?.result_json, parseTeamNames(game?.config_json));
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
      <div className="flex flex-1 flex-col gap-5">
        {/* Fixed-width lineup, fluid matchup: the lineup's content is a known
            set of columns (switch, name, three role glyphs, rank) that stops
            improving past ~570px, while the matchup absorbs the width it is
            given up to its own cap. The mix header sits only above the teams
            block now, not over the whole space -- the lineup needs no
            identity row of its own, it already lives under it (Pregame
            Room's pick-ban grid takes the same header, merged above the grid
            it belongs to rather than spanning the timeline beside it too). */}
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
          <div className="xl:w-[568px] xl:shrink-0">
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

          <div className="mx-auto flex w-full min-w-0 max-w-[1180px] flex-1 flex-col gap-5">
            <PickupMixHeader
              canWrite={canWrite}
              game={game}
              gameLoading={gameQuery.isLoading}
              onOpenPool={() => setIsPoolOpen(true)}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onOpenAccess={() => setIsAccessOpen(true)}
            />
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
              onRecordOutcome={(input) =>
                recordOutcome.mutate(input, { onSuccess: () => setMapId(null) })
              }
              maps={mapsQuery.data ?? []}
              matches={matchesQuery.data ?? []}
              mapId={mapId}
              onMapIdChange={setMapId}
              closingMix={closeMix.isPending}
              onCloseMix={() => closeMix.mutate()}
              onRenameTeam={(teamIndex, name) => setTeamNames.mutateAsync({ teamIndex, name })}
              onSwapSeats={(idx, firstUuid, secondUuid) =>
                swapSeats.mutateAsync({ variantIndex: idx, firstUuid, secondUuid })
              }
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
        canEditRanks={canEditRanks}
        canWrite={canWrite}
        hostUserId={game?.host_user_id ?? null}
        rows={rows}
        onTogglePlayer={togglePoolMember}
      />

      <PickupMixConfigDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        game={game}
        canWrite={canWrite}
        saving={setRoleMask.isPending || setPointsPerWin.isPending}
        onSave={(input) => {
          setRoleMask.mutate(input.roleMask, { onSuccess: () => setIsSettingsOpen(false) });
          if (input.pointsPerWin !== parsePointsPerWin(game?.config_json)) {
            setPointsPerWin.mutate(input.pointsPerWin);
          }
        }}
        balancerConfigData={balancerConfigQuery.data}
        balancerConfigSaving={setBalancerConfig.isPending}
        onSaveBalancerConfig={(balancerConfig) => setBalancerConfig.mutate(balancerConfig)}
      />

      <PickupAccessDialog
        open={isAccessOpen}
        onOpenChange={setIsAccessOpen}
        workspaceId={workspaceId}
        game={game}
        addingCoHost={addCoHost.isPending}
        removingCoHostId={removeCoHost.isPending ? (removeCoHost.variables ?? null) : null}
        transferring={transferHost.isPending}
        onAddCoHost={(userId) => addCoHost.mutate(userId)}
        onRemoveCoHost={(userId) => removeCoHost.mutate(userId)}
        onTransfer={(newHostUserId) => transferHost.mutate(newHostUserId)}
      />

      <PickupPlayerSheet
        row={openRow}
        canEdit={canWrite}
        saving={sheetSaving}
        onOpenChange={(open) => {
          if (!open) setOpenPlayerId(null);
        }}
        onSave={(patch, rankChange) => {
          if (!openRow) return;
          patchPlayer.mutate({ workspaceMemberId: openRow.workspace_member_id, patch });
          if (rankChange) {
            setAuthorRanks.mutate({ workspaceMemberId: openRow.workspace_member_id, ...rankChange });
          }
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
          pointsPerWin={parsePointsPerWin(game?.config_json)}
          canWrite={canWrite}
          recordingOutcome={recordOutcome.isPending}
          onRecordOutcome={(input) =>
            recordOutcome.mutate(input, { onSuccess: () => setMapId(null) })
          }
          maps={mapsQuery.data ?? []}
          mapId={mapId}
          onMapIdChange={setMapId}
          onClose={() => setIsBoardOpen(false)}
        />
      ) : null}
    </>
  );
}
