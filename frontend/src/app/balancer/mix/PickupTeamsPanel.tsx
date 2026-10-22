"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import {
  ChevronLeft,
  ChevronRight,
  Archive,
  ClipboardCopy,
  Copy,
  Send,
  CircleX,
  Shuffle
} from "lucide-react";

import { CAPTION_CLASS } from "@/app/balancer/mix/pickup-chrome";
import { PickupResultControls } from "@/app/balancer/mix/PickupResultControls";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNodeCapture } from "@/hooks/useNodeCapture";
import { cn } from "@/lib/utils";
import type { CustomGame, CustomGameLobby, CustomGameMatch } from "@/services/custom-game.service";
import type { CatalogEntityRead } from "@/types/catalog.types";
import { Spinner } from "@/components/ui/spinner";

import { MixBanBoard } from "./_components/MixBanBoard";
import { MatchHistoryList } from "./_components/MatchHistoryList";
import { NextMapStrip } from "./_components/NextMapStrip";
import { RoomStepper } from "./_components/RoomStepper";
import { StartMatchButton } from "./_components/StartMatchButton";
import { VariantView } from "./_components/VariantView";
import { slotCodeOrder } from "@/lib/roster/ontology";
import {
  parseVariants,
  teamNamesByIndex,
  type MixOwner,
  type PickupRecordOutcomeInput
} from "./pickup-lineup";

/** The demoted share/close tools: quiet glyphs that only light up on hover. */
const TOOL_ICON_CLASS = "size-9 text-[color:var(--aqt-fg-muted)] hover:text-[color:var(--aqt-fg)]";

type PickupTeamsPanelProps = {
  canWrite: boolean;
  gamesLoading: boolean;
  gamesError: boolean;
  onRetryGames: () => void;
  game: CustomGame | undefined;
  /** The one lobby this panel is showing. `undefined` before the mix loads. */
  lobby: CustomGameLobby | undefined;
  /** Its index, which is also the offset of its team names (`lobbyIndex * 2 + team`). */
  lobbyIndex: number;
  /** The mix owner's game: seat names and glyphs, the full-lobby size and the grid the seats' ranks are on. */
  owner: MixOwner;
  gameLoading: boolean;
  hasMix: boolean;
  balancing: boolean;
  activeCount: number;
  /** Re-runs the solver for THIS lobby. The confirm for an unrecorded lineup is this panel's. */
  onBalance: () => void;
  /**
   * Which of the solver's options is on screen — the lobby's own
   * `selected_variant_index`, so the host's pager moves every viewer with it.
   * Viewers get no pager at all: the matchup is read out to a lobby, and a
   * player quietly paging their own copy is looking at teams nobody is playing.
   */
  variantIndex: number;
  onVariantIndexChange: (index: number) => void;
  recordingOutcome: boolean;
  onRecordOutcome: (input: PickupRecordOutcomeInput) => void;
  startingMatch: boolean;
  /**
   * Opens the lobby's match on the lineup on screen (the voices follow server-side); `flipOpener` swaps who bans
   * first.
   */
  onStartMatch: (flipOpener: boolean) => void;
  /** The ban room is done: the lobby is re-read, and reads Live. */
  onBansComplete: () => void;
  cancellingMatch: boolean;
  /** Throws the live match away; nothing is recorded. */
  onCancelMatch: () => void;
  /** Omitted -- no "Make captain" on a seat. */
  onMakeCaptain?: (workspaceMemberId: number) => void;
  /** The history this panel lists, newest first: the room's own lobby, or every lobby on a one-lobby overview. */
  matches: CustomGameMatch[];
  /** Every match this mix has played, every lobby: the map roll skips their maps, whichever lobby played them. */
  mixMatches: CustomGameMatch[];
  /** The match whose undo is in flight, so only that row spins. */
  undoingMatchId?: number | null;
  /** Omitted -- the history renders read-only, matching a page that offers no undo. */
  onUndoMatch?: (matchId: number) => void;
  /** The mix game's map catalogue, each map with its mode as `parent` -- the roll pool and the manual picker. */
  maps: CatalogEntityRead[];
  settingNextMap: boolean;
  /** Rolled or hand-picked; `null` clears. Persisted per lobby server-side. */
  onNextMapChange: (mapId: number | null) => void;
  closingMix: boolean;
  onCloseMix: () => void;
  /** Takes the GLOBAL team index (`lobbyIndex * 2 + team`). Omitted -- team headers render read-only. */
  onRenameTeam?: (teamIndex: number, name: string) => void | Promise<unknown>;
  /** Omitted -- seats render without drag handles, matching a `canWrite=false` viewer. */
  onSwapSeats?: (
    variantIndex: number,
    firstUuid: string,
    secondUuid: string
  ) => void | Promise<unknown>;
  onCopyHandles: () => void;
  postingToDiscord?: boolean;
  /** Omitted -- no Post to Discord button, matching a page that offers no post. */
  onPostToDiscord?: (variantIndex: number) => void;
  /** Replaces the "No teams yet" card while this lobby has no balance. */
  emptyState?: ReactNode;
};

/**
 * The lobby's room (spec §7.5): its stage, the teams it is showing, and the
 * writes that act on them -- re-balance and Start match while Ready, the hero
 * bans in Pre-game, the result or Cancel match while Live (the lineup is frozen
 * from Start to the result), and close the mix.
 *
 * One lobby at a time: the page hands down which one, and every write this
 * panel makes addresses it. Teams are read from that lobby's stored
 * `balance_result` document, because only it knows which *seat* each player got
 * and at what rating — the difference between "these five are together" and a
 * lineup a host can actually call out. The solver returns many equally-scored
 * options, so the variant pager walks them without re-running the balance.
 */
export function PickupTeamsPanel({
  canWrite,
  gamesLoading,
  gamesError,
  onRetryGames,
  game,
  lobby,
  lobbyIndex,
  owner,
  gameLoading,
  hasMix,
  balancing,
  activeCount,
  onBalance,
  variantIndex,
  onVariantIndexChange,
  recordingOutcome,
  onRecordOutcome,
  startingMatch,
  onStartMatch,
  onBansComplete,
  cancellingMatch,
  onCancelMatch,
  onMakeCaptain,
  matches,
  mixMatches,
  undoingMatchId = null,
  onUndoMatch,
  maps,
  settingNextMap,
  onNextMapChange,
  closingMix,
  onCloseMix,
  onRenameTeam,
  onSwapSeats,
  onCopyHandles,
  postingToDiscord = false,
  onPostToDiscord,
  emptyState
}: Readonly<PickupTeamsPanelProps>) {
  const t = useTranslations("mixes.lobbies");
  const teamNames = teamNamesByIndex(game?.settings, lobbyIndex);
  const variants = parseVariants(lobby?.balance_result, teamNames, slotCodeOrder(owner.ontology));
  // Clamped rather than reset in an effect: a shorter result must not leave the
  // pager pointing past the end.
  const index = Math.min(variantIndex, Math.max(0, variants.length - 1));
  const variant = variants[index];
  const pointsPerWin = game?.settings.points_per_win ?? null;
  const lobbyCount = game?.lobby_count ?? 1;
  // The matchup card is a self-contained graphic, so "share the teams" here needs
  // no detour through the fullscreen board.
  const { ref: captureRef, capturing, capture } = useNodeCapture();
  const [closeOpen, setCloseOpen] = useState(false);
  // A balance replaces this lobby's lineup. If the lineup on screen was never
  // played into the log, that is a result about to be lost, so it is the one
  // case the button asks first.
  const [balanceOpen, setBalanceOpen] = useState(false);
  const lineupAtRisk = lobby?.lineup_recorded === false;
  const tRoom = useTranslations("mixes.room");
  const state = lobby?.state ?? "idle";
  const live = state === "live";
  const pregame = state === "pregame";
  // The lineup is frozen from Start to the result, bans included (spec §5.1).
  const onFloor = live || pregame;
  // Every write that re-forms, re-seats or re-maps the lineup waits for the match (409 `match_live`).
  const reshape = canWrite && !onFloor;
  const [cancelOpen, setCancelOpen] = useState(false);
  const awayUuids = new Set(
    (game?.players ?? []).filter((row) => row.away).map((row) => String(row.workspace_member_id)),
  );
  const awayNames = (variant?.teams ?? [])
    .flatMap((team) => team.seats)
    .filter((seat) => awayUuids.has(seat.uuid))
    .map((seat) => seat.name);

  return (
    // Width-capped by the caller now, alongside the mix header that sits
    // above this block: the matchup stops gaining anything past ~1180px -- a
    // seat row is a glyph, a crest, a name and a number -- and on a
    // 1440p-and-wider screen an uncapped column stretched two five-man
    // rosters across an arm's length of desk, so reading "who is on my team"
    // became a head turn.
    <div className="flex w-full min-w-0 flex-col gap-3.5">
      {game && lobby ? (
        <RoomStepper
          state={state}
          startedAt={lobby.live_started_at ?? null}
          bans={game.hero_ban_preset != null || pregame}
        />
      ) : null}
      <div className="flex flex-col gap-3.5">
        {gamesError ? (
          <Card variant="flat" asChild>
            <PageStateCard
              state="error"
              title="Unable to load mixes"
              description="Check your connection and try again."
              actionLabel="Retry"
              onAction={onRetryGames}
              className="px-4 py-16"
            />
          </Card>
        ) : gamesLoading || gameLoading ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : !hasMix ? (
          <Card variant="flat" asChild>
            <PageStateCard
              state="empty"
              title="No mixes yet"
              description={
                canWrite
                  ? "Create a mix from the mixes list, then add players from the workspace pool."
                  : "A host has not created a mix in this workspace yet."
              }
              className="px-4 py-16"
            />
          </Card>
        ) : (
          // The next map sits inside the captured block on purpose: the shared
          // screenshot answers "who is on my team" and "what are we playing"
          // together, which is exactly what a lobby asks in one breath.
          <div ref={captureRef} data-testid="teams-capture" className="flex flex-col gap-3.5">
            {game ? (
              <NextMapStrip
                nextMapId={lobby?.next_map_id ?? null}
                maps={maps}
                matches={mixMatches}
                canWrite={reshape}
                saving={settingNextMap}
                capturing={capturing}
                onNextMapChange={onNextMapChange}
              />
            ) : null}
            {variant == null ? (
              (emptyState ?? (
                <Card variant="flat" asChild>
                  <PageStateCard
                    state="empty"
                    title="No teams yet"
                    description={
                      canWrite
                        ? "Fill the lineup, then press Balance teams to see the matchup."
                        : "This mix has not been balanced yet."
                    }
                    className="px-4 py-16"
                  />
                </Card>
              ))
            ) : (
              <VariantView
                variant={variant}
                owner={owner}
                canWrite={canWrite}
                capturing={capturing}
                onRenameTeam={
                  onRenameTeam &&
                  ((teamIndex, name) => onRenameTeam(lobbyIndex * 2 + teamIndex, name))
                }
                onSwapSeats={
                  reshape && onSwapSeats
                    ? (firstUuid, secondUuid) => onSwapSeats(index, firstUuid, secondUuid)
                    : undefined
                }
                onMakeCaptain={
                  reshape && onMakeCaptain ? (uuid) => onMakeCaptain(Number(uuid)) : undefined
                }
                awayUuids={awayUuids}
              />
            )}
          </div>
        )}
      </div>
      {pregame && game && lobby?.live_encounter_id != null ? (
        <MixBanBoard
          encounterId={lobby.live_encounter_id}
          workspaceId={game.workspace_id}
          discipline={game.discipline}
          seats={lobby.live_seats ?? []}
          canHost={canWrite}
          onComplete={onBansComplete}
        />
      ) : null}

      {/* One card under the matchup, in the order a host uses it: the result
          row first, aligned under the two team columns like their footer (it
          cannot live inside the captured card without leaving a hole in the
          screenshot), then the tools -- balance and paging on the left, the
          rare share/close actions demoted to icons on the right -- and the
          history the results write into. */}
      <Card variant="flat" className="flex flex-col gap-3 px-4 py-3">
        {onFloor ? (
          <>
            {live && variant && canWrite ? (
              <PickupResultControls
                teamCount={variant.teams.length}
                teamNames={variant.teams.map((team) => team.name)}
                saving={recordingOutcome}
                pointsPerWin={pointsPerWin}
                onRecord={(recordedOutcome) => onRecordOutcome({ outcome: recordedOutcome, lobbyIndex })}
              />
            ) : null}
            {/* Every viewer hears why the teams stopped moving; only a host can end the match. */}
            <div className="flex flex-wrap items-center gap-2">
              <p className={CAPTION_CLASS}>{tRoom("frozen")}</p>
              {canWrite ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    disabled={cancellingMatch}
                    onClick={() => setCancelOpen(true)}
                  >
                    {cancellingMatch ? (
                      <Spinner className="mr-1.5 size-3.5" />
                    ) : (
                      <CircleX className="mr-1.5 size-3.5" aria-hidden="true" />
                    )}
                    {tRoom("cancelMatch")}
                  </Button>
                  <ConfirmDialog
                    open={cancelOpen}
                    onOpenChange={setCancelOpen}
                    intent={{
                      title: tRoom("cancelTitle"),
                      description: tRoom("cancelDescription"),
                      confirmLabel: tRoom("cancelConfirm"),
                      tone: "danger"
                    }}
                    pending={cancellingMatch}
                    onConfirm={() => {
                      setCancelOpen(false);
                      onCancelMatch();
                    }}
                  />
                </>
              ) : null}
            </div>
          </>
        ) : variant && canWrite && state === "ready" ? (
          <StartMatchButton
            awayNames={awayNames}
            opener={
              lobby?.opener_index != null
                ? {
                    names: [variant.teams[0]?.name ?? "Team 1", variant.teams[1]?.name ?? "Team 2"],
                    index: lobby.opener_index
                  }
                : null
            }
            starting={startingMatch}
            onStart={onStartMatch}
          />
        ) : null}

        <div
          className={cn(
            "flex flex-wrap items-center gap-2",
            ((variant && canWrite) || onFloor) && "border-t border-[color:var(--aqt-border)] pt-3"
          )}
        >
          {reshape ? (
            <>
              <Button
                type="button"
                disabled={balancing || activeCount === 0}
                onClick={() => (lineupAtRisk ? setBalanceOpen(true) : onBalance())}
                title={
                  owner.lobbySize != null && activeCount > owner.lobbySize
                    ? `${activeCount - owner.lobbySize} extra player${activeCount - owner.lobbySize === 1 ? "" : "s"} will be benched automatically -- rotation fairness picks who`
                    : undefined
                }
              >
                {balancing ? (
                  <Spinner className="mr-1.5 size-3.5" />
                ) : (
                  <Shuffle className="mr-1.5 size-3.5" aria-hidden="true" />
                )}
                Balance teams
              </Button>
              <ConfirmDialog
                open={balanceOpen}
                onOpenChange={setBalanceOpen}
                intent={{
                  title: t("rebalanceTitle"),
                  description: t("rebalanceDescription"),
                  confirmLabel: t("rebalanceConfirm"),
                  tone: "danger"
                }}
                pending={balancing}
                onConfirm={() => {
                  setBalanceOpen(false);
                  onBalance();
                }}
              />
            </>
          ) : null}

          {reshape && variants.length > 1 ? (
            <div className="flex h-9 items-center gap-0.5 rounded-lg border border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-1)] px-1">
              <IconTooltip control label="Previous balance option">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={index === 0}
                  onClick={() => onVariantIndexChange(index - 1)}
                >
                  <ChevronLeft className="size-4" aria-hidden="true" />
                  <span className="sr-only">Previous balance option</span>
                </Button>
              </IconTooltip>
              <span
                role="status"
                aria-live="polite"
                className="min-w-14 px-1 text-center text-caption font-semibold tabular-nums text-[color:var(--aqt-fg-muted)]"
              >
                {`${index + 1} / ${variants.length}`}
              </span>
              <IconTooltip control label="Next balance option">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={index >= variants.length - 1}
                  onClick={() => onVariantIndexChange(index + 1)}
                >
                  <ChevronRight className="size-4" aria-hidden="true" />
                  <span className="sr-only">Next balance option</span>
                </Button>
              </IconTooltip>
            </div>
          ) : null}

          {activeCount === 0 && canWrite ? (
            <p className="text-xs text-[color:var(--aqt-fg-dim)]">
              Check at least one player in the lobby.
            </p>
          ) : null}

          {variant ? (
            // Icon-only: these are recognisable glyphs and each is used once a
            // night at most, so their labels were spending a third of the row
            // on words nobody reads twice. The name lives in `aria-label` and
            // the tooltip.
            <div className="ml-auto flex items-center gap-1">
              <IconTooltip
                control
                label="Copy image"
                hint="The matchup card as a picture, ready to paste"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={TOOL_ICON_CLASS}
                  disabled={capturing}
                  aria-label="Copy image"
                  onClick={() => void capture()}
                >
                  {capturing ? (
                    <Spinner />
                  ) : (
                    <Copy className="size-4" aria-hidden="true" />
                  )}
                </Button>
              </IconTooltip>
              <IconTooltip
                control
                label="Copy handles"
                hint="Everyone in the balance, one per line"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={TOOL_ICON_CLASS}
                  aria-label="Copy handles"
                  onClick={onCopyHandles}
                >
                  <ClipboardCopy className="size-4" aria-hidden="true" />
                </Button>
              </IconTooltip>
              {/* The workspace's channel is the only target a mix has; without
                  one there is nowhere to post, so the button stays off. */}
              {canWrite && onPostToDiscord && game?.settings.workspace_discord_channel_id ? (
                <IconTooltip
                  control
                  label="Post to Discord"
                  hint="Sends this matchup card to the mix channel"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={TOOL_ICON_CLASS}
                    disabled={postingToDiscord}
                    aria-label="Post to Discord"
                    onClick={() => onPostToDiscord(index)}
                  >
                    {postingToDiscord ? (
                      <Spinner />
                    ) : (
                      <Send className="size-4" aria-hidden="true" />
                    )}
                  </Button>
                </IconTooltip>
              ) : null}
              {canWrite ? (
                <>
                  <span aria-hidden="true" className="mx-1 h-5 w-px bg-[color:var(--aqt-border)]" />
                  {/* Once a night, irreversible from here: an icon that only
                      turns red on hover, behind the same confirm as before,
                      instead of the loudest pill in the row. */}
                  <IconTooltip
                    control
                    label="Close mix"
                    hint="Stops balancing and results; recorded matches stay"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={cn(TOOL_ICON_CLASS, "hover:text-[color:var(--aqt-rose)]")}
                      disabled={closingMix}
                      aria-label="Close mix"
                      onClick={() => setCloseOpen(true)}
                    >
                      {closingMix ? (
                        <Spinner />
                      ) : (
                        <Archive className="size-4" aria-hidden="true" />
                      )}
                    </Button>
                  </IconTooltip>
                  <ConfirmDialog
                    open={closeOpen}
                    onOpenChange={setCloseOpen}
                    intent={{
                      title: "Close this mix?",
                      description:
                        "Stops further balancing, roster edits, and outcome recording. Matches already recorded stay recorded -- this cannot be undone from here.",
                      confirmLabel: "Yes, close mix",
                      tone: "danger"
                    }}
                    pending={closingMix}
                    onConfirm={() => {
                      setCloseOpen(false);
                      onCloseMix();
                    }}
                  />
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        {matches.length > 0 ? (
          <MatchHistoryList
            matches={matches}
            lobbyCount={lobbyCount}
            canWrite={canWrite}
            undoingMatchId={undoingMatchId}
            onUndoMatch={onUndoMatch}
            discipline={game?.discipline ?? null}
          />
        ) : null}
      </Card>
    </div>
  );
}
