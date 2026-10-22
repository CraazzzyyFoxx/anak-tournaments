"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";

import { PickupGettingStarted } from "@/app/balancer/mix/PickupGettingStarted";
import { PickupLeaderboard } from "@/app/balancer/mix/PickupLeaderboard";
import { PickupLobbyCards } from "@/app/balancer/mix/PickupLobbyCards";
import { PickupLobbyPanel } from "@/app/balancer/mix/PickupLobbyPanel";
import { PickupMixHeader } from "@/app/balancer/mix/PickupMixHeader";
import { PickupMySeatPanel } from "@/app/balancer/mix/PickupMySeatPanel";
import { PickupTeamsPanel } from "@/app/balancer/mix/PickupTeamsPanel";
import { PickupVoicePanel } from "@/app/balancer/mix/PickupVoicePanel";
import { MatchHistoryList } from "@/app/balancer/mix/_components/MatchHistoryList";
import { CAPTION_CLASS, lobbyLetter } from "@/app/balancer/mix/pickup-chrome";
import {
  PICKUP_TERMINAL_STATUSES,
  buildMixOwner,
  myLobbyTeam,
  playerLabel,
  summarizeLineup,
} from "@/app/balancer/mix/pickup-lineup";
import {
  LEADERBOARD_MIN_GAMES,
  mergeMixStats,
  sinceFor,
  type StatsPeriodKey,
} from "@/app/balancer/mix/pickup-stats";
import { usePickupMix } from "@/app/balancer/mix/usePickupMix";
import { Card } from "@/components/ui/card";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthProfile } from "@/hooks/useAuthProfile";
import { useCatalogEntities } from "@/hooks/useCatalogEntities";
import { useDivisionGrid } from "@/hooks/useCurrentWorkspace";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import { useEntityWorkspace } from "@/hooks/useEntityWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import { notify } from "@/lib/notify";
import { slotCodeOrder, type RoleOntology } from "@/lib/roster/ontology";
import { cn } from "@/lib/utils";
import { customGameKeys, customGameService, type CustomGame } from "@/services/custom-game.service";
import { useAuthProfileStore } from "@/stores/auth-profile.store";
import { useWorkspaceStore } from "@/stores/workspace.store";

// Closed until the host or a row opens them: lazy chunks, not first-load JS.
const PickupAddPlayersDialog = dynamic(
  () => import("@/app/balancer/mix/PickupAddPlayersDialog").then((m) => m.PickupAddPlayersDialog),
  { ssr: false }
);
const PickupAccessDialog = dynamic(
  () => import("@/app/balancer/mix/PickupAccessDialog").then((m) => m.PickupAccessDialog),
  { ssr: false }
);
const PickupPlayerSheet = dynamic(
  () => import("@/app/balancer/mix/PickupPlayerSheet").then((m) => m.PickupPlayerSheet),
  { ssr: false }
);

/**
 * One mix, as its overview or as one lobby's room (spec §7.5) -- one screen, so the host controls and the phone layout
 * are written once.
 *
 * `roomLobby = null` is the overview at `/balancer/mix/[gameId]`: the lineup column a host curates, the header and --
 * with several lobbies -- one card per lobby carrying its next action, the players no lobby seats, the history and the
 * leaderboard. A one-lobby mix embeds its room there instead: no navigation for the common case. `roomLobby = n` is
 * the room at `/balancer/mix/[gameId]/lobby/[A-F]`: the lobby's stage, its teams and its controls, the player's own
 * panel.
 *
 * Which balance option is on screen is the lobby's own `selected_variant_index`, not page state, and the mix itself
 * carries no solver or format settings: those belong to the host's account (`components/account-settings/
 * MixBalancerSection`).
 */
export function PickupMixScreen({ roomLobby }: Readonly<{ roomLobby: number | null }>) {
  const params = useParams<{ gameId: string }>();
  const routeGameId = Number(params.gameId);
  const pickedGameId = Number.isSafeInteger(routeGameId) && routeGameId > 0 ? routeGameId : null;
  const hostWorkspaceId = useWorkspaceStore((state) => state.hostLockedWorkspaceId);
  const t = useTranslations("mixes");
  const entityQuery = useQuery({
    queryKey: customGameKeys.byId(pickedGameId ?? 0, hostWorkspaceId),
    queryFn: () => customGameService.getById(pickedGameId as number, hostWorkspaceId),
    enabled: pickedGameId != null,
  });
  if (entityQuery.isError || pickedGameId == null) {
    return (
      <PageStateCard
        state="error"
        title={t("list.errorTitle")}
        description={t("list.errorDescription")}
        actionLabel={t("retry")}
        onAction={() => void entityQuery.refetch()}
      />
    );
  }
  if (!entityQuery.data) {
    // Detail-shaped: the lineup column beside header, lobby cards and teams.
    return (
      <div role="status" className="flex flex-col gap-5 xl:flex-row xl:items-start">
        <span className="sr-only">{t("loading")}</span>
        <Skeleton aria-hidden className="h-96 w-full rounded-xl xl:w-[568px] xl:shrink-0" />
        <div aria-hidden className="mx-auto flex w-full min-w-0 max-w-[1180px] flex-1 flex-col gap-5">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-9 w-64 rounded-lg" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    );
  }
  return <PickupMixDetail key={entityQuery.data.id} initialGame={entityQuery.data} roomLobby={roomLobby} />;
}

/** The scoreboard beside a mix: this community's players in this game, with the period switch of the mix list. */
function MixLeaderboardRail({
  workspaceId,
  discipline,
  ontology,
}: Readonly<{ workspaceId: number; discipline: string; ontology: RoleOntology | null }>) {
  const [period, setPeriod] = useState<StatsPeriodKey>("all");
  // Pinned to the period: a `since` that drifted with the clock would be a new query key every render.
  const since = useMemo(() => sinceFor(period, new Date()), [period]);
  const viewerIds = useAuthProfile().user?.linkedPlayers.map((player) => player.playerId) ?? [];
  const query = useQuery({
    queryKey: customGameKeys.stats(workspaceId, since, discipline),
    queryFn: ({ signal }) => customGameService.stats(workspaceId, since, discipline, { signal }),
    staleTime: 60_000,
  });
  const rated = query.data ? mergeMixStats([{ workspaceId, stats: query.data }]) : [];
  return (
    <PickupLeaderboard
      ranked={rated.filter((player) => player.games >= LEADERBOARD_MIN_GAMES)}
      viewer={rated.find((player) => player.playerId !== null && viewerIds.includes(player.playerId)) ?? null}
      loading={query.isLoading}
      error={query.isError}
      onRetry={() => void query.refetch()}
      period={period}
      onPeriodChange={setPeriod}
      allCommunities={false}
      ontology={ontology}
      fullHref="/balancer/mix?view=rating"
    />
  );
}

function PickupMixDetail({ initialGame, roomLobby }: Readonly<{ initialGame: CustomGame; roomLobby: number | null }>) {
  const t = useTranslations("mixes.room");
  const tLobbies = useTranslations("mixes.lobbies");
  const workspaceId = initialGame.workspace_id;
  const pickedGameId = initialGame.id;
  useEntityWorkspace(workspaceId, initialGame.discipline);
  const currentUserId = useAuthProfileStore((state) => state.user?.id ?? null);
  // The board is public (`config/auth.ts`), so the seat read is the one thing here that needs a session.
  const isSignedIn = useAuthProfileStore((state) => state.status === "authenticated");
  const { canAccessPermission, isSuperuser, isWorkspaceAdmin } = usePermissions();
  const router = useRouter();
  // The mix-hosting grant: a workspace member can run a pickup game without admin rights over teams.
  const canEdit = workspaceId != null && canAccessPermission("custom_game.create", workspaceId);
  // Workspace admin, the gate for hard-deleting a mix (`_hard_delete` in balancer-service's `rpc/custom.py`).
  const isAdminHere = workspaceId != null && (isSuperuser || isWorkspaceAdmin(workspaceId));

  const [openPlayerId, setOpenPlayerId] = useState<number | null>(null);
  const [isPoolOpen, setIsPoolOpen] = useState(false);
  const [isAccessOpen, setIsAccessOpen] = useState(false);
  // Whether this viewer may write the mix, which decides the voice read below (see `canWrite`).
  const [voiceEnabled, setVoiceEnabled] = useState(false);

  const {
    selectedGameId,
    gamesQuery,
    gameQuery,
    matchesQuery,
    rotationQuery,
    mySeatQuery,
    myQueuePosition,
    setRoster,
    patchPlayer,
    applyRotationHints,
    balance,
    recordOutcome,
    startMatch,
    cancelMatch,
    setCaptain,
    undoMatch,
    setNextMap,
    setVariantIndex,
    setLobbyCount,
    closeMix,
    hardDeleteMix,
    setAuthorRanks,
    setTeamNames,
    renameMix,
    postToDiscord,
    transferHost,
    addCoHost,
    removeCoHost,
    swapSeats,
    joinMix,
    leaveMix,
    updateMySeat,
    setMyAway,
    setSelfService,
    postSignup,
    deleteDiscordPost,
    voiceOptionsQuery,
    setVoiceChannels,
    voiceMove,
    voiceReturn,
  } = usePickupMix(workspaceId, pickedGameId, {
    seatEnabled: isSignedIn,
    voiceEnabled,
    initialGame,
    // A room's rotation hints are its own lobby's; an unknown letter (-1) renders not-found below, never a read of it.
    initialLobby: Math.max(roomLobby ?? 0, 0),
  });

  const game = gameQuery.data;
  // The owner game's roles, names, tints and grid; empty until its metadata loads, never another game's vocabulary.
  const discipline = game?.discipline ?? initialGame.discipline;
  const metadataQuery = useDisciplineMetadata(workspaceId, discipline);
  const workspaceGrid = useDivisionGrid(discipline);
  const owner = useMemo(
    () => buildMixOwner(metadataQuery.data, game?.roster_shape, workspaceGrid),
    [metadataQuery.data, game?.roster_shape, workspaceGrid],
  );
  // The mix's own game's maps: the roll pool and the picker. The chosen map is the lobby's own `next_map_id`.
  const mapsQuery = useCatalogEntities(game?.discipline, "map");
  const statsQuery = useQuery({
    queryKey: customGameKeys.stats(workspaceId ?? 0, null, game?.discipline),
    queryFn: ({ signal }) => customGameService.stats(workspaceId as number, null, game?.discipline, { signal }),
    enabled: workspaceId != null && game != null,
    staleTime: 60_000,
  });
  const rows = game?.players ?? [];
  const lobbies = game?.lobbies ?? [];
  const lobbyCount = game?.lobby_count ?? initialGame.lobby_count;
  // The lobby whose teams are on screen: the room's own, or a one-lobby mix's only one. Several lobbies show cards.
  const shownLobby = roomLobby ?? (lobbyCount < 2 ? 0 : null);
  const lobby = shownLobby == null ? undefined : lobbies.find((row) => row.lobby_index === shownLobby);
  const rosterIds = rows.map((row) => row.workspace_member_id);
  // Every mix write goes through `_writable`, which 403s anyone but the host or a co-host; a superuser writes every
  // mix. A completed or cancelled mix is read-only server-side, so its controls are hidden rather than left to 409.
  const isHost = game != null && currentUserId != null && game.host_user_id === currentUserId;
  const isCoHost =
    game != null && currentUserId != null && game.co_hosts.some((coHost) => coHost.user_id === currentUserId);
  const canWrite =
    (isHost || isCoHost || isSuperuser) && game != null && !PICKUP_TERMINAL_STATUSES[game.status];
  // State reset during render: the voice read is a writer's, and that is only knowable once the mix has loaded.
  if (voiceEnabled !== canWrite) {
    setVoiceEnabled(canWrite);
  }
  // Ranks are the host's book (`author_user_id = game.host_user_id`); a closed mix's host can still correct one.
  const canEditRanks = canEdit && isHost;
  const openRow = rows.find((row) => row.workspace_member_id === openPlayerId) ?? null;
  const savingPlayerId = patchPlayer.isPending ? (patchPlayer.variables?.workspaceMemberId ?? null) : null;
  // The sheet's Save can fire both mutations at once, so its saving state watches both.
  const sheetSaving =
    openRow != null &&
    ((patchPlayer.isPending && patchPlayer.variables?.workspaceMemberId === openRow.workspace_member_id) ||
      (setAuthorRanks.isPending && setAuthorRanks.variables?.workspaceMemberId === openRow.workspace_member_id));
  const matches = matchesQuery.data ?? [];
  const mySeat = mySeatQuery.data;
  const myMemberId = mySeat?.seat?.workspace_member_id ?? null;
  // The phone view of the player's own lobby: their team, its captain and the map (spec §7.5, G1).
  const myTeam = myLobbyTeam(game, myMemberId, slotCodeOrder(owner.ontology));
  const nextMapName =
    myTeam?.nextMapId == null
      ? null
      : ((mapsQuery.data ?? []).find((map) => map.id === myTeam.nextMapId)?.name ?? null);
  const waitingCount = rows.filter(
    (row) => row.participation !== "benched" && !row.away && row.current_lobby == null,
  ).length;

  const togglePoolMember = (memberId: number) => {
    if (selectedGameId == null) return;
    setRoster.mutate(
      rosterIds.includes(memberId) ? rosterIds.filter((id) => id !== memberId) : [...rosterIds, memberId],
    );
  };

  const copyHandles = () => {
    const handles = rows
      .filter((row) => row.participation !== "benched")
      .map((row) => row.identity?.handle ?? playerLabel(row));
    if (handles.length === 0) {
      notify.error("Nobody is in the balance yet");
      return;
    }
    void navigator.clipboard
      .writeText(handles.join("\n"))
      .then(() => notify.success(`Copied ${handles.length} handles`))
      .catch(() => notify.error("Could not reach the clipboard"));
  };

  if (roomLobby != null && (roomLobby < 0 || roomLobby >= lobbyCount)) {
    return <PageStateCard state="not-found" description={t("notFound")} />;
  }

  const teamsPanel =
    shownLobby == null ? null : (
      <PickupTeamsPanel
        canWrite={canWrite}
        gamesLoading={gamesQuery.isLoading || gameQuery.isLoading}
        gamesError={gamesQuery.isError || gameQuery.isError}
        onRetryGames={() => {
          void gamesQuery.refetch();
          void gameQuery.refetch();
        }}
        game={game}
        lobby={lobby}
        lobbyIndex={shownLobby}
        owner={owner}
        gameLoading={gameQuery.isLoading}
        hasMix={selectedGameId != null}
        balancing={balance.isPending}
        activeCount={summarizeLineup(rows, owner.roles).active}
        onBalance={() => balance.mutate({ scope: "lobby", lobbyIndex: shownLobby })}
        variantIndex={lobby?.selected_variant_index ?? 0}
        onVariantIndexChange={(index) => setVariantIndex.mutate({ lobbyIndex: shownLobby, variantIndex: index })}
        startingMatch={startMatch.isPending}
        onStartMatch={() => startMatch.mutate(shownLobby)}
        cancellingMatch={cancelMatch.isPending}
        onCancelMatch={() => cancelMatch.mutate(shownLobby)}
        onMakeCaptain={(workspaceMemberId) => setCaptain.mutate({ lobbyIndex: shownLobby, workspaceMemberId })}
        recordingOutcome={recordOutcome.isPending}
        onRecordOutcome={(input) => recordOutcome.mutate(input)}
        maps={mapsQuery.data ?? []}
        matches={roomLobby == null ? matches : matches.filter((match) => match.lobby_index === roomLobby)}
        mixMatches={matches}
        undoingMatchId={undoMatch.isPending ? (undoMatch.variables ?? null) : null}
        onUndoMatch={(matchId) => undoMatch.mutate(matchId)}
        settingNextMap={setNextMap.isPending}
        onNextMapChange={(mapId) => setNextMap.mutate({ lobbyIndex: shownLobby, mapId })}
        closingMix={closeMix.isPending}
        onCloseMix={() => closeMix.mutate()}
        onRenameTeam={(teamIndex, name) => setTeamNames.mutateAsync({ teamIndex, name })}
        onSwapSeats={(idx, firstUuid, secondUuid) =>
          swapSeats.mutateAsync({ lobbyIndex: shownLobby, variantIndex: idx, firstUuid, secondUuid })
        }
        onCopyHandles={copyHandles}
        postingToDiscord={postToDiscord.isPending}
        onPostToDiscord={(idx) => postToDiscord.mutate({ lobbyIndex: shownLobby, variantIndex: idx })}
        emptyState={
          canWrite && game != null && game.matches_count === 0 ? (
            <PickupGettingStarted
              game={game}
              onOpenPool={() => setIsPoolOpen(true)}
              onPostSignup={(selfSignup) => postSignup.mutate(selfSignup)}
              posting={postSignup.isPending}
            />
          ) : undefined
        }
      />
    );

  // Only a writer picks voices or moves anyone: the endpoints 403 everyone else.
  const voicePanel =
    canWrite && game != null ? (
      <PickupVoicePanel
        game={game}
        games={gamesQuery.data ?? []}
        options={voiceOptionsQuery.data}
        optionsLoading={voiceOptionsQuery.isLoading}
        saving={setVoiceChannels.isPending}
        moving={voiceMove.isPending}
        returning={voiceReturn.isPending}
        report={voiceMove.data ?? voiceReturn.data}
        reportLobby={voiceMove.data ? voiceMove.variables : voiceReturn.variables}
        onSave={(patch) => setVoiceChannels.mutate(patch)}
        onMove={(lobbyIndex) => {
          // One report on screen at a time: the stale one is about a move that already happened.
          voiceReturn.reset();
          voiceMove.mutate(lobbyIndex);
        }}
        onReturn={(lobbyIndex) => {
          voiceMove.reset();
          voiceReturn.mutate(lobbyIndex);
        }}
      />
    ) : null;

  // Visible when the mix invites signups or this viewer is already in it; the board stays as public as it was.
  const mySeatPanel =
    mySeat != null && (mySeat.self_signup !== "closed" || mySeat.seat != null) ? (
      <PickupMySeatPanel
        state={mySeat}
        owner={owner}
        saving={joinMix.isPending || leaveMix.isPending || updateMySeat.isPending || setMyAway.isPending}
        onJoin={() => joinMix.mutate()}
        onLeave={() => leaveMix.mutate()}
        onSave={(patch) => updateMySeat.mutate(patch)}
        myTeam={myTeam}
        nextMapName={nextMapName}
        queuePosition={myQueuePosition}
        lobbies={lobbies.map((row) => ({ lobbyIndex: row.lobby_index, state: row.state ?? "idle" }))}
        onSetAway={(away) => setMyAway.mutate(away)}
      />
    ) : null;

  // The host's pool, with the rotation hints of the lobby the screen is about (the room's own, else lobby A).
  const lineupPanel = (
    <PickupLobbyPanel
      canWrite={canWrite}
      hasMix={selectedGameId != null}
      rows={rows}
      lobbyCount={lobbyCount}
      owner={owner}
      rotation={rotationQuery.data ?? []}
      savingPlayerId={savingPlayerId}
      clearing={setRoster.isPending}
      onPatchPlayer={(workspaceMemberId, patch) => patchPlayer.mutate({ workspaceMemberId, patch })}
      onClear={() => setRoster.mutate([])}
      onRemovePlayer={togglePoolMember}
      onOpenPlayer={setOpenPlayerId}
      onApplyRotationHints={() => applyRotationHints.mutate()}
      applyingHints={applyRotationHints.isPending}
    />
  );

  const dialogs = (
    <>
      {game ? (
        <PickupAddPlayersDialog
          open={isPoolOpen}
          onOpenChange={setIsPoolOpen}
          workspaceId={workspaceId}
          discipline={game.discipline}
          owner={owner}
          canEdit={canEdit}
          canEditRanks={canEditRanks}
          canWrite={canWrite}
          hostUserId={game.host_user_id ?? null}
          rows={rows}
          onTogglePlayer={togglePoolMember}
        />
      ) : null}

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
        discipline={game?.discipline ?? ""}
        owner={owner}
        lobbyCount={lobbyCount}
        mixStats={
          statsQuery.data?.members.find((member) => member.workspace_member_id === openRow?.workspace_member_id) ??
          null
        }
        canEdit={canWrite}
        saving={sheetSaving}
        onOpenChange={(open) => {
          if (!open) setOpenPlayerId(null);
        }}
        onSave={(patch, rankChange) => {
          if (!openRow) return;
          patchPlayer.mutate({ workspaceMemberId: openRow.workspace_member_id, patch });
          if (rankChange) {
            setAuthorRanks.mutate({
              workspaceMemberId: openRow.workspace_member_id,
              discipline: game!.discipline,
              ...rankChange,
            });
          }
        }}
        onRemove={() => {
          if (openRow) {
            togglePoolMember(openRow.workspace_member_id);
            setOpenPlayerId(null);
          }
        }}
      />
    </>
  );

  if (roomLobby != null) {
    // One column, the player's own panel right under the teams: the same room reads on a phone (spec §7.5).
    return (
      <>
        <div className="mx-auto flex w-full min-w-0 max-w-[1180px] flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/balancer/mix/${pickedGameId}`}
              className="inline-flex items-center gap-1 text-caption text-[color:var(--aqt-fg-muted)] hover:text-[color:var(--aqt-fg)]"
            >
              <ChevronLeft className="size-3.5" aria-hidden="true" />
              {t("overview")}
            </Link>
            <h1 className="font-display text-lg font-bold text-[color:var(--aqt-fg)]">
              {`${game?.name ?? initialGame.name} · ${tLobbies("tab", { letter: lobbyLetter(roomLobby) })}`}
            </h1>
            <span className={cn(CAPTION_CLASS, "ml-auto")}>{t("waitingCount", { count: waitingCount })}</span>
          </div>
          {teamsPanel}
          {mySeatPanel}
          {/* The host's controls inline: the pool with this lobby's rotation hints, and the voices. */}
          {canWrite ? lineupPanel : null}
          {voicePanel}
        </div>
        {dialogs}
      </>
    );
  }

  return (
    <>
      <div className="flex flex-1 flex-col gap-5">
        {/* Fixed-width lineup, fluid matchup: the lineup stops improving past ~570px, the matchup absorbs the rest
            up to its own cap. */}
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
          <div className="xl:w-[568px] xl:shrink-0">{lineupPanel}</div>

          <div className="mx-auto flex w-full min-w-0 max-w-[1180px] flex-1 flex-col gap-5">
            <PickupMixHeader
              canWrite={canWrite}
              game={game}
              gameLoading={gameQuery.isLoading}
              onOpenPool={() => setIsPoolOpen(true)}
              showsRoles={owner.showsRoles}
              onOpenAccess={() => setIsAccessOpen(true)}
              canDelete={isAdminHere}
              deleting={hardDeleteMix.isPending}
              onDeleteMix={() => hardDeleteMix.mutate(undefined, { onSuccess: () => router.push("/balancer/mix") })}
              onRename={(name) => renameMix.mutateAsync(name)}
              onSetSelfService={(patch) => setSelfService.mutate(patch)}
              savingSelfService={setSelfService.isPending}
              onPostSignup={(selfSignup) => postSignup.mutate(selfSignup)}
              postingSignup={postSignup.isPending}
              onDeleteDiscordPost={(postId) => deleteDiscordPost.mutate(postId)}
              deletingDiscordPost={deleteDiscordPost.isPending}
              settingLobbyCount={setLobbyCount.isPending}
              onLobbyCountChange={(count) => setLobbyCount.mutate(count)}
            />
            {shownLobby != null ? (
              teamsPanel
            ) : game != null ? (
              <>
                <PickupLobbyCards
                  game={game}
                  rows={rows}
                  owner={owner}
                  canWrite={canWrite}
                  balancingLobby={
                    balance.isPending && balance.variables?.scope === "lobby" ? balance.variables.lobbyIndex : null
                  }
                  startingLobby={startMatch.isPending ? (startMatch.variables ?? null) : null}
                  recordingLobby={recordOutcome.isPending ? (recordOutcome.variables?.lobbyIndex ?? null) : null}
                  shufflingAll={balance.isPending && balance.variables?.scope === "all"}
                  onBalance={(lobbyIndex) => balance.mutate({ scope: "lobby", lobbyIndex })}
                  onStartMatch={(lobbyIndex) => startMatch.mutate(lobbyIndex)}
                  onRecordOutcome={(input) => recordOutcome.mutate(input)}
                  onShuffleAll={() => balance.mutate({ scope: "all" })}
                />
                {matches.length > 0 ? (
                  <Card variant="flat" className="px-4 py-3">
                    <MatchHistoryList
                      matches={matches}
                      lobbyCount={lobbyCount}
                      canWrite={canWrite}
                      undoingMatchId={undoMatch.isPending ? (undoMatch.variables ?? null) : null}
                      onUndoMatch={(matchId) => undoMatch.mutate(matchId)}
                    />
                  </Card>
                ) : null}
              </>
            ) : null}
            {voicePanel}
            {mySeatPanel}
            {game != null ? (
              <MixLeaderboardRail workspaceId={workspaceId} discipline={game.discipline} ontology={owner.ontology} />
            ) : null}
          </div>
        </div>
      </div>
      {dialogs}
    </>
  );
}
