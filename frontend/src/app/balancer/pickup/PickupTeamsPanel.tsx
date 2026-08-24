"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Shuffle } from "lucide-react";

import { PANEL_CLASS, TEAM_BADGE_ACCENTS } from "@/app/balancer/components/balancer-page-helpers";
import DivisionIcon from "@/components/DivisionIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageStateCard } from "@/components/ui/page-state-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useDivisionGrid } from "@/hooks/useCurrentWorkspace";
import { resolveDivisionFromRank } from "@/lib/division-grid";
import { ROLES, ROLE_LABELS } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type { CustomGame } from "@/services/custom-game.service";

import {
  PICKUP_STATUS_LABELS,
  parseVariants,
  type PickupTeam,
  type PickupVariant,
} from "./pickup-lineup";

type PickupTeamsPanelProps = {
  canEdit: boolean;
  canWrite: boolean;
  games: CustomGame[];
  gamesLoading: boolean;
  gamesError: boolean;
  onRetryGames: () => void;
  game: CustomGame | undefined;
  gameLoading: boolean;
  selectedGameId: number | null;
  onSelectGame: (gameId: number) => void;
  creating: boolean;
  onCreateGame: (name: string) => void;
  balancing: boolean;
  activeCount: number;
  onBalance: () => void;
};

/**
 * The result side: which mix is open, and the teams the solver produced.
 *
 * Teams are read from the stored `result_json` rather than the roster's
 * `team_index`, because only the payload knows which *seat* each player got and
 * at what rating — the difference between "these five are together" and a
 * lineup a host can actually call out. The solver returns many equally-scored
 * options, so the variant pager walks them without re-running the balance.
 */
export function PickupTeamsPanel({
  canEdit,
  canWrite,
  games,
  gamesLoading,
  gamesError,
  onRetryGames,
  game,
  gameLoading,
  selectedGameId,
  onSelectGame,
  creating,
  onCreateGame,
  balancing,
  activeCount,
  onBalance,
}: Readonly<PickupTeamsPanelProps>) {
  const [newName, setNewName] = useState("");
  const [variantIndex, setVariantIndex] = useState(0);

  const variants = parseVariants(game?.result_json);
  // Clamped rather than reset in an effect: a shorter result must not leave the
  // pager pointing past the end.
  const index = Math.min(variantIndex, Math.max(0, variants.length - 1));
  const variant = variants[index];

  return (
    <div className={cn(PANEL_CLASS, "flex min-h-0 flex-col p-4")}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <div className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--aqt-fg-dim)]">Mix</div>
          <div className="mt-1 flex items-center gap-2">
            <Select
              value={selectedGameId == null ? undefined : String(selectedGameId)}
              disabled={gamesLoading || games.length === 0}
              onValueChange={(value) => onSelectGame(Number(value))}
            >
              <SelectTrigger className="h-9 min-w-0 flex-1" aria-label="Select a mix">
                <SelectValue placeholder={games.length === 0 ? "No mixes yet" : "Pick a mix"} />
              </SelectTrigger>
              <SelectContent>
                {games.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {game ? (
              <Badge variant="outline" className="shrink-0">
                {PICKUP_STATUS_LABELS[game.status] ?? game.status}
              </Badge>
            ) : null}
          </div>
        </div>

        {canEdit ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const name = newName.trim();
              if (!name) return;
              onCreateGame(name);
              setNewName("");
            }}
          >
            <div>
              <label
                htmlFor="pickup-new-mix"
                className="block text-[11px] uppercase tracking-[0.14em] text-[color:var(--aqt-fg-dim)]"
              >
                New mix
              </label>
              <Input
                id="pickup-new-mix"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Thursday scrim"
                autoComplete="off"
                className="mt-1 h-9 w-44"
              />
            </div>
            <Button type="submit" size="sm" className="h-9" disabled={creating || !newName.trim()}>
              {creating ? <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden="true" /> : null}
              Create
            </Button>
          </form>
        ) : null}
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        {gamesError ? (
          <PageStateCard
            state="error"
            title="Unable to load mixes"
            description="Check your connection and try again."
            actionLabel="Retry"
            onAction={onRetryGames}
            className="px-4 py-16"
          />
        ) : gamesLoading ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : games.length === 0 ? (
          <PageStateCard
            state="empty"
            title="No mixes yet"
            description={
              canEdit
                ? "Name a mix above to create it, then click players in the pool to fill the lobby."
                : "A host has not created a mix in this workspace yet."
            }
            className="px-4 py-16"
          />
        ) : gameLoading ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : variant == null ? (
          <PageStateCard
            state="empty"
            title="No teams yet"
            description={
              canWrite
                ? "Fill the lobby, then press Balance teams to see the matchup."
                : "This mix has not been balanced yet."
            }
            className="px-4 py-16"
          />
        ) : (
          <VariantView variant={variant} />
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[color:var(--aqt-border)] pt-3">
        {canWrite ? (
          <Button type="button" className="h-9" disabled={balancing || activeCount === 0} onClick={onBalance}>
            {balancing ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Shuffle className="mr-1 size-3.5" aria-hidden="true" />
            )}
            Balance teams
          </Button>
        ) : null}
        {activeCount === 0 && canWrite ? (
          <p className="text-xs text-[color:var(--aqt-fg-dim)]">Check at least one player in the lobby.</p>
        ) : null}
        <div className="flex-1" />
        {variants.length > 1 ? (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              disabled={index === 0}
              onClick={() => setVariantIndex(index - 1)}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              <span className="sr-only">Previous balance option</span>
            </Button>
            <span
              role="status"
              aria-live="polite"
              className="min-w-20 text-center text-xs tabular-nums text-[color:var(--aqt-fg-muted)]"
            >
              {`${index + 1} / ${variants.length}`}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              disabled={index >= variants.length - 1}
              onClick={() => setVariantIndex(index + 1)}
            >
              <ChevronRight className="size-4" aria-hidden="true" />
              <span className="sr-only">Next balance option</span>
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function VariantView({ variant }: Readonly<{ variant: PickupVariant }>) {
  const { stats } = variant;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-[color:var(--aqt-fg-muted)]">
        {stats.compositeScore == null ? null : (
          <span title="Composite solver score across balance and role comfort.">
            Quality <span className="tabular-nums text-[color:var(--aqt-fg)]">{stats.compositeScore.toFixed(2)}</span>
          </span>
        )}
        {stats.mmrStdDev == null ? null : (
          <span title="Standard deviation of team rank — lower means closer teams.">
            Spread <span className="tabular-nums text-[color:var(--aqt-fg)]">{stats.mmrStdDev.toFixed(1)}</span>
          </span>
        )}
        {stats.ratingGap == null ? null : (
          <span title="Rank gap between the strongest and weakest team.">
            Gap <span className="tabular-nums text-[color:var(--aqt-fg)]">{Math.round(stats.ratingGap)}</span>
          </span>
        )}
        {stats.offRoleCount == null || stats.offRoleCount === 0 ? null : (
          <span className="text-amber-200" title="Players placed outside their first-choice role.">
            Off-role <span className="tabular-nums">{stats.offRoleCount}</span>
          </span>
        )}
      </div>

      <div
        className={cn(
          "grid items-start gap-3",
          // `minmax(0, 1fr)` rather than `1fr`: a long player name would
          // otherwise let one team's column grow past its half.
          variant.teams.length === 2
            ? "lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
            : "lg:grid-cols-2",
        )}
      >
        {variant.teams.map((team, teamIndex) => (
          <TeamCardAndSeparator
            key={team.id}
            team={team}
            teamIndex={teamIndex}
            showSeparator={variant.teams.length === 2 && teamIndex === 0}
          />
        ))}
      </div>

      {variant.benched.length === 0 ? null : (
        <p className="text-xs text-[color:var(--aqt-fg-dim)]">
          {`Left out of this option: ${variant.benched.join(", ")}`}
        </p>
      )}
    </div>
  );
}

function TeamCardAndSeparator({
  team,
  teamIndex,
  showSeparator,
}: Readonly<{ team: PickupTeam; teamIndex: number; showSeparator: boolean }>) {
  return (
    <>
      <TeamCard team={team} teamIndex={teamIndex} />
      {showSeparator ? (
        <div
          aria-hidden="true"
          className="hidden self-center px-1 text-3xl font-black tracking-tighter text-[color:var(--aqt-fg-muted)] lg:block"
        >
          VS
        </div>
      ) : null}
    </>
  );
}

function TeamCard({ team, teamIndex }: Readonly<{ team: PickupTeam; teamIndex: number }>) {
  const grid = useDivisionGrid();
  const accent = TEAM_BADGE_ACCENTS[teamIndex % TEAM_BADGE_ACCENTS.length];

  return (
    <section className="overflow-hidden rounded-xl border border-[color:var(--aqt-border)] bg-white/[0.02]">
      {/* The same accent on the header strip and on every rank badge: team
          identity has to survive a glance, and one shared class keeps it from
          drifting into a second palette. */}
      <header className={cn("flex items-baseline justify-between gap-2 border-b px-3 py-2", accent)}>
        <h3 className="truncate text-sm font-semibold uppercase tracking-[0.14em]">{`Team ${teamIndex + 1}`}</h3>
        <span className="shrink-0 text-xs tabular-nums opacity-80">
          {team.averageRank == null ? "\u2014" : `avg ${Math.round(team.averageRank)}`}
        </span>
      </header>
      <ul>
        {team.seats.map((seat) => {
          const division = resolveDivisionFromRank(grid, seat.rating);
          const icon = ROLES.find((item) => item.code === seat.role)?.icon ?? "Support";
          return (
            <li
              key={`${seat.uuid}:${seat.role}`}
              className="flex items-center gap-3 border-b border-[color:var(--aqt-border)] px-3 py-2 last:border-b-0"
            >
              <div
                className={cn(
                  "flex w-14 shrink-0 flex-col items-center gap-0.5 rounded-lg border px-1 py-1",
                  accent,
                )}
              >
                {division == null ? null : <DivisionIcon division={division} width={22} height={22} />}
                <span className="text-[11px] font-semibold tabular-nums">
                  {seat.rating == null ? "\u2014" : Math.round(seat.rating)}
                </span>
              </div>
              <span
                className="min-w-0 flex-1 truncate text-base font-semibold text-[color:var(--aqt-fg)]"
                title={seat.name}
              >
                {seat.name}
              </span>
              {seat.offRole ? (
                <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-200">
                  Off-role
                </span>
              ) : null}
              <span
                className="flex size-7 shrink-0 items-center justify-center"
                title={`${ROLE_LABELS[seat.role]}${seat.subRole ? ` \u00B7 ${seat.subRole}` : ""}`}
              >
                <PlayerRoleIcon role={icon} size={18} label={ROLE_LABELS[seat.role]} />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
