"use client";

import {
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Copy,
  Loader2,
  Maximize2,
  Shuffle,
} from "lucide-react";

import { PANEL_CLASS } from "@/app/balancer/components/balancer-page-helpers";
import { PickupResultControls } from "@/app/balancer/pickup/PickupResultControls";
import {
  CAPTION_CLASS,
  EYEBROW_CLASS,
  METRIC_NEUTRAL_CLASS,
  METRIC_PILL_CLASS,
  teamAccent,
} from "@/app/balancer/pickup/pickup-chrome";
import DivisionIcon from "@/components/DivisionIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { Button } from "@/components/ui/button";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNodeCapture } from "@/hooks/useNodeCapture";
import { OW_REFERENCE_GRID, resolveDivisionFromRank } from "@/lib/division-grid";
import { ROLES, ROLE_LABELS } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type { CustomGame, CustomGameOutcome } from "@/services/custom-game.service";

import { parseOutcome, parseVariants, type PickupTeam, type PickupVariant } from "./pickup-lineup";

type PickupTeamsPanelProps = {
  canWrite: boolean;
  gamesLoading: boolean;
  gamesError: boolean;
  onRetryGames: () => void;
  game: CustomGame | undefined;
  gameLoading: boolean;
  hasMix: boolean;
  balancing: boolean;
  activeCount: number;
  onBalance: () => void;
  /** Which of the solver's options is on screen — owned by the page so the board agrees. */
  variantIndex: number;
  onVariantIndexChange: (index: number) => void;
  recordingOutcome: boolean;
  onRecordOutcome: (outcome: CustomGameOutcome) => void;
  onShowBoard: () => void;
  onCopyBattleTags: () => void;
};

/**
 * The result side: the teams the solver produced, and the two writes that act on
 * them — re-balance, and record who won.
 *
 * Teams are read from the stored `result_json` rather than the roster's
 * `team_index`, because only the payload knows which *seat* each player got and
 * at what rating — the difference between "these five are together" and a
 * lineup a host can actually call out. The solver returns many equally-scored
 * options, so the variant pager walks them without re-running the balance.
 */
export function PickupTeamsPanel({
  canWrite,
  gamesLoading,
  gamesError,
  onRetryGames,
  game,
  gameLoading,
  hasMix,
  balancing,
  activeCount,
  onBalance,
  variantIndex,
  onVariantIndexChange,
  recordingOutcome,
  onRecordOutcome,
  onShowBoard,
  onCopyBattleTags,
}: Readonly<PickupTeamsPanelProps>) {
  const variants = parseVariants(game?.result_json);
  // Clamped rather than reset in an effect: a shorter result must not leave the
  // pager pointing past the end.
  const index = Math.min(variantIndex, Math.max(0, variants.length - 1));
  const variant = variants[index];
  const outcome = parseOutcome(game?.outcome_json);
  // The matchup card is a self-contained graphic, so "share the teams" here needs
  // no detour through the fullscreen board.
  const { ref: captureRef, capturing, capture } = useNodeCapture();

  return (
    // Capped and centred rather than fluid. The matchup stops gaining anything
    // past ~1180px — a seat row is a glyph, a crest, a name and a number — and on
    // a 1440p-and-wider screen the uncapped column stretched two five-man rosters
    // across an arm's length of desk, so reading "who is on my team" became a
    // head turn. The lineup beside it keeps its fixed track; this side gives the
    // leftover width back as margin.
    <div className="mx-auto flex min-h-0 w-full min-w-0 max-w-[1180px] flex-col gap-3.5 xl:h-full">
      <div className="flex flex-wrap items-center gap-2.5">
        {canWrite ? (
          <Button
            type="button"
            className="h-[38px]"
            disabled={balancing || activeCount === 0}
            onClick={onBalance}
          >
            {balancing ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Shuffle className="mr-1.5 size-3.5" aria-hidden="true" />
            )}
            Balance teams
          </Button>
        ) : null}

        {variants.length > 1 ? (
          <div className="flex h-[38px] items-center gap-0.5 rounded-lg border border-[color:var(--aqt-border)] bg-white/[0.015] px-1">
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
            <span
              role="status"
              aria-live="polite"
              className="min-w-14 px-1 text-center font-mono text-[12.5px] font-semibold tabular-nums text-[color:var(--aqt-fg-muted)]"
            >
              {`${index + 1} / ${variants.length}`}
            </span>
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
          </div>
        ) : null}

        {variant ? <VariantMetrics variant={variant} /> : null}

        {activeCount === 0 && canWrite ? (
          <p className="text-xs text-[color:var(--aqt-fg-dim)]">
            Check at least one player in the lobby.
          </p>
        ) : null}

        {variant ? (
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="outline" className="h-9" onClick={onShowBoard}>
              <Maximize2 className="mr-1.5 size-3.5" aria-hidden="true" />
              Show lobby
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-9"
              disabled={capturing}
              onClick={() => void capture()}
            >
              {capturing ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Copy className="mr-1.5 size-3.5" aria-hidden="true" />
              )}
              Copy image
            </Button>
            <Button type="button" variant="ghost" className="h-9" onClick={onCopyBattleTags}>
              <ClipboardCopy className="mr-1.5 size-3.5" aria-hidden="true" />
              Copy battletags
            </Button>
          </div>
        ) : null}
      </div>

      {/* The toolbar above stays put and the result scrolls under it, so a long
          matchup never pushes Balance teams off the top of a full-height column. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 xl:overflow-y-auto xl:pr-1">
        {gamesError ? (
          <PageStateCard
            state="error"
            title="Unable to load mixes"
            description="Check your connection and try again."
            actionLabel="Retry"
            onAction={onRetryGames}
            className={cn(PANEL_CLASS, "px-4 py-16")}
          />
        ) : gamesLoading || gameLoading ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : !hasMix ? (
          <PageStateCard
            state="empty"
            title="No mixes yet"
            description={
              canWrite
                ? "Create a mix above, then add players from the workspace pool."
                : "A host has not created a mix in this workspace yet."
            }
            className={cn(PANEL_CLASS, "px-4 py-16")}
          />
        ) : variant == null ? (
          <PageStateCard
            state="empty"
            title="No teams yet"
            description={
              canWrite
                ? "Fill the lineup, then press Balance teams to see the matchup."
                : "This mix has not been balanced yet."
            }
            className={cn(PANEL_CLASS, "px-4 py-16")}
          />
        ) : (
          <>
            <div ref={captureRef}>
              <VariantView variant={variant} />
            </div>

            <div
              className={cn(PANEL_CLASS, "flex flex-wrap items-center gap-x-3.5 gap-y-2 px-4 py-3")}
            >
              <span className={cn(EYEBROW_CLASS, "tracking-[0.14em]")}>Record result</span>
              <PickupResultControls
                teamCount={variant.teams.length}
                outcome={outcome}
                canRecord={canWrite}
                saving={recordingOutcome}
                onRecord={onRecordOutcome}
              />
              <span className="text-[12.5px] text-[color:var(--aqt-fg-faint)]">
                {outcome == null
                  ? "Recording a result closes the mix \u2014 nothing is written until you do."
                  : "Recorded. This mix is closed."}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The solver's own verdict on this option, as four read-only pills.
 *
 * Off-role is the one that changes colour, because it is the only number a host
 * can act on: it names players who will be unhappy, where quality and spread
 * only rank the option against its siblings.
 */
function VariantMetrics({ variant }: Readonly<{ variant: PickupVariant }>) {
  const { stats } = variant;
  const offRole = stats.offRoleCount ?? 0;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {stats.compositeScore == null ? null : (
        <span
          title="Composite solver score across balance and role comfort \u2014 lower is better."
          className={cn(
            METRIC_PILL_CLASS,
            "border-[color:color-mix(in_srgb,var(--aqt-emerald)_25%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-emerald)_10%,transparent)] text-[color:var(--aqt-emerald)]",
          )}
        >
          {`QUALITY ${stats.compositeScore.toFixed(2)}`}
        </span>
      )}
      {stats.mmrStdDev == null ? null : (
        <span
          title="Standard deviation of team rank \u2014 lower means the teams are closer together."
          className={cn(
            METRIC_PILL_CLASS,
            "border-[color:color-mix(in_srgb,var(--aqt-blue)_22%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-blue)_10%,transparent)] text-[color:var(--aqt-blue)]",
          )}
        >
          {`STDDEV ${stats.mmrStdDev.toFixed(1)}`}
        </span>
      )}
      {stats.ratingGap == null ? null : (
        <span
          title="Rank gap between the strongest and weakest team."
          className={cn(METRIC_PILL_CLASS, METRIC_NEUTRAL_CLASS)}
        >
          {`SPREAD ${Math.round(stats.ratingGap)}`}
        </span>
      )}
      <span
        title="Players the solver had to seat outside their first-choice role."
        className={cn(
          METRIC_PILL_CLASS,
          offRole > 0
            ? "border-[color:color-mix(in_srgb,var(--aqt-amber)_28%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-amber)_10%,transparent)] text-[color:var(--aqt-amber)]"
            : METRIC_NEUTRAL_CLASS,
        )}
      >
        {`OFF-ROLE ${offRole}`}
      </span>
    </div>
  );
}

function VariantView({ variant }: Readonly<{ variant: PickupVariant }>) {
  const twoTeams = variant.teams.length === 2;

  return (
    <div className="space-y-3">
      {/* One card with a divider column, not two cards: the matchup is a single
          object, and a gap between two boxes read as two unrelated rosters. */}
      <div
        className={cn(
          PANEL_CLASS,
          "flex items-stretch overflow-hidden rounded-2xl",
          twoTeams ? "flex-col lg:flex-row" : "flex-col",
        )}
      >
        {variant.teams.map((team, teamIndex) => (
          <TeamColumnAndDivider
            key={team.id}
            team={team}
            teamIndex={teamIndex}
            showDivider={twoTeams && teamIndex === 0}
          />
        ))}
      </div>

      {variant.benched.length === 0 ? null : (
        <p className={cn(CAPTION_CLASS, "px-1")}>
          {`Left out of this option: ${variant.benched.join(", ")}`}
        </p>
      )}
    </div>
  );
}

function TeamColumnAndDivider({
  team,
  teamIndex,
  showDivider,
}: Readonly<{ team: PickupTeam; teamIndex: number; showDivider: boolean }>) {
  return (
    <>
      <TeamColumn team={team} teamIndex={teamIndex} />
      {showDivider ? (
        <div
          aria-hidden="true"
          className="flex shrink-0 items-center justify-center border-y border-[color:var(--aqt-border)] bg-[color:var(--aqt-bg-2)] py-2 lg:w-16 lg:border-x lg:border-y-0 lg:py-0"
        >
          <span className="font-display text-[15px] font-bold tracking-[0.1em] text-[color:var(--aqt-fg-faint)]">
            VS
          </span>
        </div>
      ) : null}
    </>
  );
}

function TeamColumn({ team, teamIndex }: Readonly<{ team: PickupTeam; teamIndex: number }>) {
  // The global OW grid, not the workspace's: balancer-service resolves a mix's
  // ranks against the grid with `workspace_id=None`, so `seat.rating` is on the
  // OW scale. Labelling it with a workspace's tiers renames the same number.
  const grid = OW_REFERENCE_GRID;
  const accent = teamAccent(teamIndex);

  return (
    <section className="min-w-0 flex-1 px-4 pb-4 pt-4">
      <header className="flex items-baseline gap-2.5 border-b border-[color:var(--aqt-border)] pb-3">
        <span aria-hidden="true" className={cn("h-4 w-[3px] shrink-0 rounded-sm", accent.bar)} />
        <h3 className="truncate font-display text-xl font-bold tracking-[0.01em] text-[color:var(--aqt-fg)]">
          {`Team ${teamIndex + 1}`}
        </h3>
        <span
          className={cn(
            "ml-auto shrink-0 font-mono text-[11px] uppercase tracking-[0.12em]",
            "text-[color:var(--aqt-fg-faint)]",
          )}
        >
          avg
        </span>
        <span className="shrink-0 font-mono text-xl font-bold tabular-nums text-[color:var(--aqt-fg)]">
          {team.averageRank == null ? "\u2014" : Math.round(team.averageRank)}
        </span>
      </header>
      <ul className="mt-2.5 space-y-1">
        {team.seats.map((seat) => {
          const division = resolveDivisionFromRank(grid, seat.rating);
          const icon = ROLES.find((item) => item.code === seat.role)?.icon ?? "Support";
          return (
            <li
              key={`${seat.uuid}:${seat.role}`}
              className="flex items-center gap-3 rounded-lg border border-[color:var(--aqt-border)] bg-white/[0.015] px-3.5 py-3 transition-colors hover:bg-white/[0.045]"
            >
              <span
                className="flex size-6 shrink-0 items-center justify-center opacity-90"
                title={`${ROLE_LABELS[seat.role]}${seat.subRole ? ` \u00B7 ${seat.subRole}` : ""}`}
              >
                <PlayerRoleIcon role={icon} size={24} label={ROLE_LABELS[seat.role]} />
              </span>
              {division == null ? null : (
                <DivisionIcon
                  division={division}
                  tournamentGrid={grid}
                  width={32}
                  height={32}
                  className="shrink-0"
                />
              )}
              <span
                className="min-w-0 flex-1 truncate text-[17px] font-semibold text-[color:var(--aqt-fg)]"
                title={seat.name}
              >
                {seat.name}
              </span>
              {seat.offRole ? (
                <span
                  title="Assigned off their first-preference role"
                  className="shrink-0 rounded border border-[color:color-mix(in_srgb,var(--aqt-amber)_30%,transparent)] px-1.5 py-px font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-[color:var(--aqt-amber)]"
                >
                  Off-role
                </span>
              ) : null}
              <span className="shrink-0 font-mono text-lg font-bold tabular-nums text-[color:var(--aqt-fg)]">
                {seat.rating == null ? "\u2014" : Math.round(seat.rating)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
