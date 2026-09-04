"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import { Tournament } from "@/types/tournament.types";
import { Player, Team } from "@/types/team.types";
import type { Encounter } from "@/types/encounter.types";
import encounterService from "@/services/encounter.service";
import teamService from "@/services/team.service";
import { TournamentTeamCard } from "@/components/TournamentTeamCard";
import DivisionIcon from "@/components/DivisionIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import TeamName from "@/components/TeamName";
import { FilterChip } from "@/components/ui/filter-chip";
import { SearchField } from "@/components/ui/search-field";
import { getDivisionLabel } from "@/lib/division-grid";
import { normalizePlayerRole } from "@/lib/player-role";
import { ROSTER_SLOT_CODES, type RosterSlotCode } from "@/lib/roster-shape";
import { isTournamentStatusEnded } from "@/lib/tournament-status";
import { tournamentQueryKeys } from "@/lib/tournament-query-keys";
import { cn } from "@/lib/utils";
import { useDivisionGrid } from "@/hooks/useCurrentWorkspace";
import { useQueryParams } from "@/hooks/useQueryParams";
import { formatSubRoleLabel, getPlayerSlug, sortTeamPlayers } from "@/utils/player";

import { isEncounterCompleted } from "../_components/MatchCard";
import { SectionToolbar } from "../_components/SectionToolbar";
import { TournamentPageState } from "../_components/TournamentPageState";
import { TournamentTeamsSkeleton } from "../_components/TournamentSkeletons";
import { UpdatingBadge } from "../_components/UpdatingBadge";
import { ViewSegment, readViewParam } from "../_components/ViewSegment";
import { useTournamentQuery } from "../_hooks/useTournamentClientData";
import { getPublicPageQueryPresentation } from "./publicPageQueryPresentation";

const VIEWS = ["list", "cards"] as const;
type TeamsView = (typeof VIEWS)[number];

const SORTS = ["placement", "group", "sr", "name"] as const;
type SortBy = (typeof SORTS)[number];

/** Remembers the reader's pick across tournaments; the URL still outranks it. */
const VIEW_STORAGE_KEY = "owt:teams-view";

/**
 * `<mark>` on its own is a yellow block from the user agent, unreadable on the
 * dark surface. The element stays — it is what "this is the match" means to
 * assistive tech — and only the colours come from the tokens.
 */
const MARK_CLASS =
  "rounded-[3px] bg-[color:color-mix(in_srgb,var(--aqt-teal)_22%,transparent)] px-0.5 text-[color:var(--aqt-fg)]";

/** Slot code -> the canonical role name `PlayerRoleIcon` maps to a glyph. */
const SLOT_ROLE: Record<RosterSlotCode, string> = {
  tank: "Tank",
  dps: "Damage",
  support: "Support",
  flex: "Flex"
};

/** A team's settled series record. `null` when encounters are unavailable. */
type TeamRecord = { won: number; lost: number };

function readStoredView(): TeamsView | null {
  try {
    const saved = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return saved === "list" || saved === "cards" ? saved : null;
  } catch {
    // Private-mode Safari and a locked-down Node both throw on access; a
    // remembered view is a convenience, never a reason to fail the page.
    return null;
  }
}

function writeStoredView(view: TeamsView) {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // See `readStoredView`.
  }
}

/**
 * `true` below the `sm` breakpoint, where `ViewSegment` hides itself. The view
 * follows: a link carrying `?view=cards` opened on a phone still gets the list,
 * because there is no control there to switch back with.
 */
function useIsNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)");
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return narrow;
}

/** Battletags and the team name, lowercased once per team for the search. */
function matchesSearch(team: Team, needle: string): boolean {
  if (needle === "") return true;
  if (team.name.toLowerCase().includes(needle)) return true;
  return team.players.some((player) => player.name.toLowerCase().includes(needle));
}

function compareTeams(a: Team, b: Team, sortBy: SortBy): number {
  switch (sortBy) {
    case "placement": {
      const ap = a.placement ?? Number.POSITIVE_INFINITY;
      const bp = b.placement ?? Number.POSITIVE_INFINITY;
      return ap - bp || a.name.localeCompare(b.name);
    }
    case "group": {
      const ag = a.group?.name ?? "";
      const bg = b.group?.name ?? "";
      // Ungrouped teams sort after every named group rather than before it.
      if (ag !== bg) return ag === "" ? 1 : bg === "" ? -1 : ag.localeCompare(bg);
      return compareTeams(a, b, "placement");
    }
    case "sr":
      return (b.avg_sr ?? 0) - (a.avg_sr ?? 0) || a.name.localeCompare(b.name);
    case "name":
      return a.name.localeCompare(b.name);
  }
}

/**
 * Settled series per team. A draw counts for neither side; unplayed and live
 * matches are not a record yet.
 */
function buildRecords(encounters: Encounter[]): Map<number, TeamRecord> {
  const records = new Map<number, TeamRecord>();
  const bump = (teamId: number | null | undefined, won: boolean) => {
    if (teamId == null) return;
    const current = records.get(teamId) ?? { won: 0, lost: 0 };
    if (won) current.won += 1;
    else current.lost += 1;
    records.set(teamId, current);
  };

  for (const encounter of encounters) {
    if (!isEncounterCompleted(encounter)) continue;
    const home = encounter.score?.home ?? 0;
    const away = encounter.score?.away ?? 0;
    if (home === away) continue;
    bump(encounter.home_team_id, home > away);
    bump(encounter.away_team_id, away > home);
  }

  return records;
}

/**
 * The roster slots of the tournament, one entry per player the shape asks for,
 * paired positionally with the team's roster. `sortTeamPlayers` orders players
 * tank -> damage -> support -> flex, the same canonical order the slot codes
 * come in, so index pairing lands each glyph on its own player.
 */
function rosterSlots(tournament: Tournament, team: Team): { role: string; player?: Player }[] {
  const players = sortTeamPlayers(team.players);
  const shape = tournament.roster_shape;

  if (!shape) {
    // No shape entity on this read: the team's own roster is the shape.
    return players.map((player) => ({ role: normalizePlayerRole(player.role), player }));
  }

  const slots: { role: string; player?: Player }[] = [];
  for (const code of ROSTER_SLOT_CODES) {
    for (let index = 0; index < (shape.slots[code] ?? 0); index += 1) {
      slots.push({ role: SLOT_ROLE[code] });
    }
  }
  return slots.map((slot, index) => {
    const player = players[index];
    // The player's own role is the truth when one fills the slot; the slot's
    // role only labels a seat nobody took.
    return player ? { role: normalizePlayerRole(player.role), player } : slot;
  });
}

const TeamRosterRow = ({
  player,
  tournament,
  needle
}: {
  player: Player;
  tournament: Tournament;
  needle: string;
}) => {
  const t = useTranslations();
  const workspaceGrid = useDivisionGrid();
  const grid = tournament.division_grid_version ?? workspaceGrid;
  const name = player.name;
  const notes = [
    formatSubRoleLabel(player.sub_role),
    player.is_newcomer_role ? t("teams.roster.newcomerRole") : null,
    player.is_newcomer ? t("teams.roster.newcomer") : null
  ].filter(Boolean);

  // Wireframe §5 ③ also asks for each player's top three heroes. The public
  // teams read (`/api/v1/teams`, entities `players` + `players.user`) carries
  // no hero data, and the only per-player hero source is one hero-playtime
  // request per user — a hundred requests for one expanded roster. The column
  // is therefore absent rather than filled with a placeholder.
  return (
    <div className="grid grid-cols-[3rem_minmax(0,1fr)_4.5rem_3rem_minmax(0,6rem)] items-center gap-2 py-1">
      <span className="aqt-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--aqt-fg-faint)]">
        {normalizePlayerRole(player.role)}
      </span>
      <Link
        href={`/users/${getPlayerSlug(name)}`}
        className="truncate hover:text-[color:var(--aqt-teal)]"
        title={name}
      >
        {needle !== "" && name.toLowerCase().includes(needle) ? (
          <mark className={MARK_CLASS}>{name}</mark>
        ) : (
          name
        )}
      </Link>
      <span className="flex items-center gap-1">
        <DivisionIcon
          division={player.division}
          width={20}
          height={20}
          tournamentGrid={tournament.division_grid_version}
        />
        <span className="aqt-mono text-[10px] text-[color:var(--aqt-fg-muted)]">
          {getDivisionLabel(grid, player.division) ?? ""}
        </span>
      </span>
      <span className="tabular-nums text-[11px] text-[color:var(--aqt-fg-muted)]">
        {player.rank}
      </span>
      <span className="truncate text-[11px] text-[color:var(--aqt-fg-dim)]">
        {notes.join(" · ")}
      </span>
    </div>
  );
};

/**
 * One team as a collapsed row that unfolds its roster. `<details>` and not
 * per-row state, so several teams stay open at once and the browser keeps them
 * open across a re-render.
 */
const TeamListRow = ({
  team,
  tournament,
  slug,
  record,
  needle
}: {
  team: Team;
  tournament: Tournament;
  slug: string;
  record: TeamRecord | null | undefined;
  needle: string;
}) => {
  const t = useTranslations();
  const slots = rosterSlots(tournament, team);
  const subtitle = [
    team.group?.name ? t("teams.groupLabel", { name: team.group.name }) : null,
    team.placement === 1 ? t("tournamentDetail.teams.champion") : null
  ].filter(Boolean);

  return (
    <details className="group border-b border-[color:var(--aqt-border)]/60">
      <summary className="cursor-pointer list-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--aqt-teal)] [&::-webkit-details-marker]:hidden">
        <div className="grid grid-cols-[2rem_minmax(0,1fr)_3.5rem_2.75rem_1.25rem] items-center gap-2 px-2 py-2 text-sm sm:grid-cols-[2.5rem_minmax(0,1fr)_4rem_auto_3.5rem_1.25rem] sm:gap-3">
          <span className="aqt-mono tabular-nums text-[11px] text-[color:var(--aqt-fg-faint)]">
            {team.placement != null ? `#${team.placement}` : ""}
          </span>
          <span className="flex min-w-0 flex-col">
            <TeamName team={team} size="sm" />
            {subtitle.length > 0 ? (
              <span className="truncate text-[11px] text-[color:var(--aqt-fg-dim)]">
                {subtitle.join(" · ")}
              </span>
            ) : null}
          </span>
          <span className="tabular-nums text-[color:var(--aqt-fg-muted)]">
            {team.avg_sr.toFixed(0)}
          </span>
          <span className="hidden items-center gap-0.5 sm:flex">
            {slots.map((slot, index) => (
              <span
                key={index}
                title={slot.player?.name ?? undefined}
                className={cn("inline-flex", slot.player == null && "opacity-40")}
              >
                <PlayerRoleIcon
                  role={slot.role}
                  size={16}
                  label={slot.player?.name ?? undefined}
                />
              </span>
            ))}
          </span>
          <span className="text-right tabular-nums text-[color:var(--aqt-fg-muted)]">
            {record ? `${record.won}–${record.lost}` : "—"}
          </span>
          <span className="flex justify-end">
            <ChevronDown
              className="size-3.5 text-[color:var(--aqt-fg-faint)] transition-transform group-open:rotate-180"
              aria-hidden
            />
          </span>
        </div>
      </summary>
      <div className="mb-2 ml-2 mr-2 rounded-md border border-dashed border-[color:var(--aqt-border)] bg-[color:var(--aqt-card)] px-3 py-2 text-xs sm:ml-[2.5rem]">
        <div className="grid grid-cols-[3rem_minmax(0,1fr)_4.5rem_3rem_minmax(0,6rem)] gap-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--aqt-fg-faint)]">
          <span>{t("teams.roster.role")}</span>
          <span>{t("teams.roster.battleTag")}</span>
          <span>{t("teams.roster.division")}</span>
          <span>{t("tournamentDetail.teams.sr")}</span>
          <span />
        </div>
        {sortTeamPlayers(team.players).map((player) => (
          <TeamRosterRow
            key={player.id}
            player={player}
            tournament={tournament}
            needle={needle}
          />
        ))}
        <div className="mt-1.5 flex flex-wrap gap-3 border-t border-[color:var(--aqt-border)]/60 pt-1.5 font-mono text-[10px]">
          <Link
            href={`/tournaments/${slug}/matches?team=${team.id}`}
            className="text-[color:var(--aqt-fg-muted)] hover:text-[color:var(--aqt-teal)]"
          >
            {t("tournamentDetail.teams.teamMatches")}
          </Link>
          {/* Wireframe §5 ④ offers "Team profile" only when a team route exists.
              The public site has no `/teams/[id]` page — `(site)/teams` is the
              index — so the button is absent rather than dead. */}
        </div>
      </div>
    </details>
  );
};

const TournamentTeamsView = ({
  tournament,
  slug
}: {
  tournament: Tournament;
  slug: string;
}) => {
  const t = useTranslations();
  const teamsQuery = useQuery({
    queryKey: tournamentQueryKeys.teams(tournament.id, tournament.workspace_id),
    queryFn: () =>
      teamService.getAll({
        tournamentId: tournament.id,
        workspaceId: tournament.workspace_id
      })
  });

  // Same key and same call the bracket and the matches section use, so the
  // W-L column is a cache read wherever the reader has already been.
  const encountersQuery = useQuery({
    queryKey: tournamentQueryKeys.encounters(tournament.id, tournament.workspace_id),
    queryFn: () =>
      encounterService.getAll(
        1,
        "",
        tournament.id,
        -1,
        undefined,
        undefined,
        tournament.workspace_id
      )
  });

  const { searchParams, setParams } = useQueryParams({ resetOnChange: [] });
  const [storedView, setStoredView] = useState<TeamsView | null>(null);
  const narrow = useIsNarrowViewport();

  // Post-hydration: the server has no localStorage, so reading it during
  // render would make the first client paint disagree with the markup.
  useEffect(() => setStoredView(readStoredView()), []);

  const teams = useMemo(() => teamsQuery.data?.results ?? [], [teamsQuery.data]);

  const defaultSort: SortBy = isTournamentStatusEnded(tournament.status) ? "placement" : "group";
  const sortBy = readViewParam(searchParams, "sort", SORTS, defaultSort);
  const groupFilter = searchParams?.get("group") ?? null;
  const search = searchParams?.get("q") ?? "";
  const needle = search.trim().toLowerCase();
  const view = narrow ? "list" : readViewParam(searchParams, "view", VIEWS, storedView ?? "list");

  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const team of teams) {
      const name = team.group?.name;
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [teams]);

  const visibleTeams = useMemo(
    () =>
      teams
        .filter((team) => groupFilter == null || team.group?.name === groupFilter)
        .filter((team) => matchesSearch(team, needle))
        .sort((a, b) => compareTeams(a, b, sortBy)),
    [teams, groupFilter, needle, sortBy]
  );

  const records = useMemo(() => {
    const encounters = encountersQuery.data?.results;
    return encounters ? buildRecords(encounters) : null;
  }, [encountersQuery.data]);

  const presentation = getPublicPageQueryPresentation({
    data: teamsQuery.data,
    itemCount: teams.length,
    isPending: teamsQuery.isPending,
    isError: teamsQuery.isError,
    isFetching: teamsQuery.isFetching
  });

  if (presentation.initialState === "error") {
    return <TournamentPageState state="initial-error" onRetry={() => void teamsQuery.refetch()} />;
  }

  if (presentation.initialState === "skeleton" || presentation.contentState === null) {
    return <TournamentTeamsSkeleton />;
  }

  const content = (
    <div className="space-y-4">
      {presentation.showUpdating ? <UpdatingBadge /> : null}
      {presentation.contentState === "empty" ? (
        <TournamentPageState state="empty" />
      ) : (
        <>
          <SectionToolbar
            label={t("common.filters")}
            end={
              <>
                <SearchField
                  value={search}
                  onValueChange={(value) => setParams({ q: value || null })}
                  label={t("tournamentDetail.teams.searchLabel")}
                  placeholder={t("tournamentDetail.teams.searchPlaceholder")}
                  containerClassName="w-[11rem]"
                  className="h-8 py-1"
                />
                <select
                  className="filter-sort h-8"
                  aria-label={t("tournamentDetail.sortTeams")}
                  value={sortBy}
                  onChange={(event) => {
                    const next = event.target.value as SortBy;
                    setParams({ sort: next === defaultSort ? null : next });
                  }}
                >
                  <option value="placement">{t("common.byPlacement")}</option>
                  <option value="group">{t("tournamentDetail.teams.byGroup")}</option>
                  <option value="sr">{t("common.byAvgSr")}</option>
                  <option value="name">{t("common.byName")}</option>
                </select>
                <ViewSegment
                  param="view"
                  defaultValue={storedView ?? "list"}
                  options={[
                    { value: "list", label: t("tournamentDetail.teams.viewList") },
                    { value: "cards", label: t("tournamentDetail.teams.viewCards") }
                  ]}
                  onChange={(next) => {
                    writeStoredView(next);
                    setStoredView(next);
                  }}
                  label={t("tournamentDetail.teams.viewLabel")}
                />
              </>
            }
          >
            <FilterChip
              active={groupFilter == null}
              count={teams.length}
              onClick={() => setParams({ group: null })}
            >
              {t("common.all")}
            </FilterChip>
            {groups.map(([name, count]) => (
              <FilterChip
                key={name}
                active={groupFilter === name}
                count={count}
                onClick={() => setParams({ group: name })}
              >
                {t("common.group")} {name}
              </FilterChip>
            ))}
          </SectionToolbar>

          {visibleTeams.length === 0 ? (
            <TournamentPageState
              state="filtered-empty"
              onReset={() => setParams({ group: null, q: null })}
            />
          ) : view === "cards" ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visibleTeams.map((team) => {
                const matched =
                  needle === ""
                    ? []
                    : team.players.filter((player) => player.name.toLowerCase().includes(needle));
                return (
                  <div key={team.id} className="space-y-1">
                    {/* Wireframe §5 ⑤ keeps this card byte-for-byte; the matched
                        battletag is therefore marked above it rather than
                        inside `TournamentTeamCard`, which this screen does not
                        own. Nothing renders when nothing was searched, so the
                        card's surroundings are unchanged by default. */}
                    {matched.length > 0 ? (
                      <p className="truncate text-[11px] text-[color:var(--aqt-fg-dim)]">
                        {t("tournamentDetail.teams.matchedPlayers")}{" "}
                        {matched.map((player, index) => (
                          <span key={player.id}>
                            {index > 0 ? ", " : null}
                            <mark className={MARK_CLASS}>{player.name}</mark>
                          </span>
                        ))}
                      </p>
                    ) : null}
                    <TournamentTeamCard team={team} />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-[color:var(--aqt-border)]">
              <div className="grid grid-cols-[2rem_minmax(0,1fr)_3.5rem_2.75rem_1.25rem] items-center gap-2 border-b border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-1)] px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--aqt-fg-faint)] sm:grid-cols-[2.5rem_minmax(0,1fr)_4rem_auto_3.5rem_1.25rem] sm:gap-3">
                <span>#</span>
                <span>{t("tournamentDetail.teams.team")}</span>
                <span>{t("teams.roster.avgSr")}</span>
                <span className="hidden sm:block">
                  {t("tournamentDetail.teams.rosterColumn")}
                </span>
                <span className="text-right">{t("tournamentDetail.teams.record")}</span>
                <span />
              </div>
              {visibleTeams.map((team) => (
                <TeamListRow
                  key={team.id}
                  team={team}
                  tournament={tournament}
                  slug={slug}
                  record={records?.get(team.id) ?? null}
                  needle={needle}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );

  if (presentation.showRefreshError) {
    return (
      <TournamentPageState
        state="refresh-error"
        onRetry={() => void teamsQuery.refetch()}
        isUpdating={teamsQuery.isFetching}
      >
        {content}
      </TournamentPageState>
    );
  }

  return content;
};

/**
 * Resolves the shared tournament overview so the route file stays a one-line
 * delegation, matching every other tournament sub-route. The overview is
 * already primed by the layout, so this is a cache read in practice — the
 * guards below only fire if that layout contract ever changes.
 */
const TournamentTeamsPage = ({ slug }: { slug: string }) => {
  // Keyed by `slug`: shares TournamentClientLayout's overview cache entry.
  const tournamentQuery = useTournamentQuery(slug);

  if (!tournamentQuery.data) {
    if (tournamentQuery.isError) {
      return (
        <TournamentPageState state="initial-error" onRetry={() => void tournamentQuery.refetch()} />
      );
    }
    return <TournamentTeamsSkeleton />;
  }

  return <TournamentTeamsView tournament={tournamentQuery.data} slug={slug} />;
};

export default TournamentTeamsPage;
