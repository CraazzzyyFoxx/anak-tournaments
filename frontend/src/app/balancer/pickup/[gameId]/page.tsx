"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";

import { PickupAddPlayersDialog } from "@/app/balancer/pickup/PickupAddPlayersDialog";
import { PickupLobbyBoard } from "@/app/balancer/pickup/PickupLobbyBoard";
import { PickupLobbyPanel } from "@/app/balancer/pickup/PickupLobbyPanel";
import { PickupMixHeader } from "@/app/balancer/pickup/PickupMixHeader";
import { PickupPlayerSheet } from "@/app/balancer/pickup/PickupPlayerSheet";
import { PickupTeamsPanel } from "@/app/balancer/pickup/PickupTeamsPanel";
import {
  PICKUP_TERMINAL_STATUSES,
  parseOutcome,
  parseTeamNames,
  parseVariants,
  playerLabel,
  summarizeLineup,
} from "@/app/balancer/pickup/pickup-lineup";
import { usePickupMix } from "@/app/balancer/pickup/usePickupMix";
import { usePermissions } from "@/hooks/usePermissions";
import { notify } from "@/lib/notify";
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
  const [isBoardOpen, setIsBoardOpen] = useState(false);
  const [variantIndex, setVariantIndex] = useState(0);

  const {
    selectedGameId,
    gamesQuery,
    gameQuery,
    setRoster,
    patchPlayer,
    balance,
    recordOutcome,
    setAuthorRanks,
    setTeamNames,
  } = usePickupMix(workspaceId ?? 0, pickedGameId);

  const game = gameQuery.data;
  const rows = game?.players ?? [];
  const rosterIds = rows.map((row) => row.workspace_member_id);
  // Everything that writes a mix -- roster, player patch, balance, outcome --
  // goes through `_writable`, which 403s anyone but the host. A member who only
  // holds `custom_game.create` used to see every control live and collect a 403
  // per click, so hosting is part of the gate rather than a surprise at the end
  // of one.
  const isHost = game != null && currentUserId != null && game.host_user_id === currentUserId;
  // A completed or cancelled mix is read-only server-side; hide its controls
  // rather than let a click 409.
  const canWrite = canEdit && isHost && game != null && !PICKUP_TERMINAL_STATUSES[game.status];
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
        <Link
          href="/balancer/pickup"
          className="flex w-fit items-center gap-1.5 text-[13px] text-[color:var(--aqt-fg-dim)] transition-colors hover:text-[color:var(--aqt-fg-muted)]"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Mixes
        </Link>

        <PickupMixHeader
          canEdit={canEdit}
          game={game}
          gameLoading={gameQuery.isLoading}
          onOpenPool={() => setIsPoolOpen(true)}
        />

        {/* Fixed-width lineup, fluid matchup: the lineup's content is a known
            set of columns (switch, name, three role glyphs, rank) that stops
            improving past ~570px, while the matchup absorbs the width it is
            given up to its own cap. */}
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

          <div className="min-w-0 flex-1">
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
              onRenameTeam={(teamIndex, name) => setTeamNames.mutateAsync({ teamIndex, name })}
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
