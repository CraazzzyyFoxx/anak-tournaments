"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  buildRoundGroups,
  orderEliminationRounds,
  stageFinalRounds,
  type RoundGroup
} from "@/components/bracket-view.helpers";
import RosterSlotGlyph from "@/components/registration/RosterSlotGlyph";
import TeamName from "@/components/TeamName";
import { useBracketRoundLabel } from "@/hooks/useBracketRoundLabel";
import { useMinuteClock } from "@/hooks/useMinuteClock";
import { normalizePlayerRole, playerRoleSlotCode } from "@/lib/player-role";
import { ROSTER_SLOT_CODES, type RosterSlotCode } from "@/lib/roster-shape";
import { tournamentQueryKeys } from "@/lib/tournament-query-keys";
import { cn } from "@/lib/utils";
import encounterService from "@/services/encounter.service";
import heroService from "@/services/hero.service";
import registrationService from "@/services/registration.service";
import teamService from "@/services/team.service";
import tournamentService from "@/services/tournament.service";
import type { Encounter } from "@/types/encounter.types";
import type { Registration } from "@/types/registration.types";
import type { Team } from "@/types/team.types";
import type { StageSummary, Standings, TournamentStatus } from "@/types/tournament.types";

import { MapPool } from "../_components/MapPool";
import { MatchCard, isEncounterCompleted, isEncounterLive } from "../_components/MatchCard";
import { MatchRow } from "../_components/MatchRow";
import { PhaseTimeline } from "../_components/PhaseTimeline";
import { Podium, type PodiumTeam } from "../_components/Podium";
import { formatLabel, tournamentPlayersCount } from "../_components/TournamentClientLayout";
import { TournamentPageState } from "../_components/TournamentPageState";
import { TournamentOverviewSkeleton } from "../_components/TournamentSkeletons";
import { UpdatingBadge } from "../_components/UpdatingBadge";
import { useTournamentQuery } from "../_hooks/useTournamentClientData";
import { useTournamentMapPool } from "../_hooks/useTournamentMapPool";
import { useTournamentStreamsQuery } from "../_hooks/useTournamentStreams";
import { getBracketRefetchInterval } from "../bracket/bracketData";
import { buildLiveTeamStreams } from "../bracket/bracketLiveStreams";
import styles from "../TournamentDetail.module.css";
import { getPublicPageQueryPresentation } from "./publicPageQueryPresentation";

// ---------------------------------------------------------------------------
// Which of the three compositions a tournament gets
// ---------------------------------------------------------------------------

export type OverviewVariant = "registration" | "live" | "completed";

/**
 * Exhaustive over `TournamentStatus` on purpose: a status added on the backend
 * then fails the build here instead of silently landing on a fallback branch.
 */
const VARIANT_BY_STATUS: Record<TournamentStatus, OverviewVariant> = {
  draft: "registration",
  registration: "registration",
  check_in: "registration",
  live: "live",
  playoffs: "live",
  completed: "completed",
  archived: "completed"
};

export function overviewVariant(status: TournamentStatus): OverviewVariant {
  return VARIANT_BY_STATUS[status];
}

/** Stage types with a bracket to draw, and with a standings table instead. */
const ELIMINATION_TYPES: Record<string, true> = {
  single_elimination: true,
  double_elimination: true
};
const GROUP_TYPES: Record<string, true> = { round_robin: true, swiss: true };

/**
 * The stage the overview draws: the one being played now, and after the
 * tournament ends the one that decided it.
 *
 * Unpublished stages are skipped the way the bracket skips them
 * (`isStageVisibleToViewer`), unless nothing is published at all — an organizer
 * previewing their own tournament still sees which stage is meant.
 */
export function pickOverviewStage(
  stages: readonly StageSummary[],
  variant: OverviewVariant
): StageSummary | null {
  const ordered = [...stages].sort((left, right) => left.order - right.order);
  const visible = ordered.filter((stage) => stage.is_published || stage.is_completed);
  const pool = visible.length > 0 ? visible : ordered;
  if (pool.length === 0) return null;

  if (variant === "completed") {
    return (
      pool.filter((stage) => ELIMINATION_TYPES[stage.stage_type] === true).at(-1) ??
      pool.at(-1) ??
      null
    );
  }
  return (
    pool.find((stage) => stage.is_active) ??
    pool.find((stage) => !stage.is_completed) ??
    pool.at(-1) ??
    null
  );
}

/** The round the stage is on: the first with anything unfinished, else its last. */
export function currentRoundOf(groups: readonly RoundGroup[]): number | null {
  for (const group of groups) {
    if (group.matches.some((match) => !isEncounterCompleted(match))) return group.round;
  }
  return groups.at(-1)?.round ?? null;
}

/**
 * Up to four columns of the mini-bracket (§3 ⑥): the current round with a
 * neighbour on each side, plus the stage's decider when that window does not
 * already reach it — the wireframe's "R1 · R2 · LR3 · GRAND FINAL".
 */
export function pickRoundWindow(
  groups: readonly RoundGroup[],
  currentRound: number | null
): RoundGroup[] {
  if (groups.length <= 4) return [...groups];

  const index =
    currentRound === null ? -1 : groups.findIndex((group) => group.round === currentRound);
  const start = index < 0 ? groups.length - 3 : Math.max(0, Math.min(index - 1, groups.length - 3));
  const window = groups.slice(start, start + 3);
  const decider = groups[groups.length - 1];
  return window.includes(decider) ? window : [...window, decider];
}

/** The completed encounter that decided the bracket: highest positive round. */
export function findGrandFinal(
  encounters: readonly Encounter[],
  stageId: number
): Encounter | null {
  const played = encounters.filter(
    (encounter) =>
      encounter.stage_id === stageId && encounter.round > 0 && isEncounterCompleted(encounter)
  );
  return played.reduce<Encounter | null>(
    (best, encounter) => (best === null || encounter.round > best.round ? encounter : best),
    null
  );
}

/**
 * The lower-bracket final: the deepest negative round. Its loser is third in a
 * double elimination bracket (§5 of the plan's default decisions).
 */
export function findLowerFinal(
  encounters: readonly Encounter[],
  stageId: number
): Encounter | null {
  const played = encounters.filter(
    (encounter) =>
      encounter.stage_id === stageId && encounter.round < 0 && isEncounterCompleted(encounter)
  );
  return played.reduce<Encounter | null>(
    (best, encounter) => (best === null || encounter.round < best.round ? encounter : best),
    null
  );
}

function winnerSide(encounter: Encounter): "home" | "away" | null {
  const home = encounter.score?.home ?? 0;
  const away = encounter.score?.away ?? 0;
  if (home === away) return null;
  return home > away ? "home" : "away";
}

/** Registrations per role slot, counted from each entry's primary role. */
export function countRegistrationRoles(
  registrations: readonly Registration[]
): Record<RosterSlotCode, number> {
  const counts: Record<RosterSlotCode, number> = { tank: 0, dps: 0, support: 0, flex: 0 };
  for (const registration of registrations) {
    const roles = registration.roles ?? [];
    const primary = roles.find((role) => role.is_primary) ?? roles[0];
    if (!primary) continue;
    counts[playerRoleSlotCode(normalizePlayerRole(primary.role))] += 1;
  }
  return counts;
}

/**
 * Calendar days the tournament spans, inclusive. UTC getters on both ends so
 * the number is the same during SSR and after hydration.
 */
export function tournamentDaySpan(start: Date | string, end: Date | string): number | null {
  const from = new Date(start);
  const to = new Date(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  const days =
    Math.floor(
      (Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) -
        Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) /
        86_400_000
    ) + 1;
  return days > 0 ? days : null;
}

/** The champion's roster as one line — names only, the `#1234` is noise here (§3C). */
function rosterBattletags(team: Team | null | undefined): string {
  const players = team?.players ?? [];
  return players
    .map((player) => player.name)
    .filter((name): name is string => typeof name === "string" && name.length > 0)
    .map((name) => name.split("#")[0])
    .join(" · ");
}

// ---------------------------------------------------------------------------
// Small shared surfaces
// ---------------------------------------------------------------------------

/**
 * One block of the overview: a mono eyebrow over a hairline (wireframes §11),
 * not a framed card — see `.block` in the module CSS for why.
 */
function OverviewCard({
  title,
  action,
  id,
  children
}: Readonly<{
  title?: string;
  action?: React.ReactNode;
  id?: string;
  children: React.ReactNode;
}>) {
  return (
    <section className={cn(styles.block, "scroll-mt-28")} id={id}>
      {title || action ? (
        <div className={styles.blockHead}>
          {title ? <h2 className={styles.blockTitle}>{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function CardLink({ href, children }: Readonly<{ href: string; children: React.ReactNode }>) {
  return (
    <Link
      href={href}
      className="font-mono text-[12px] uppercase tracking-[0.08em] text-[color:var(--aqt-fg-muted)] transition-colors hover:text-[color:var(--aqt-teal)]"
    >
      {children}
    </Link>
  );
}

function StatTile({
  label,
  value,
  hint,
  accent
}: Readonly<{ label: string; value: string; hint?: string; accent?: string }>) {
  return (
    <div className={styles.figure}>
      <div className={cn(styles.figureLabel, "flex items-center gap-1.5")}>
        {accent ? (
          <span aria-hidden className="size-1.5 rounded-full" style={{ background: accent }} />
        ) : null}
        {label}
      </div>
      <div className={styles.figureValue}>
        {value}
        {hint ? <span className={styles.figureHint}>{hint}</span> : null}
      </div>
    </div>
  );
}

/** The site's role tints (`PlayerRoleIcon` uses the same tokens), keyed by slot code. */
const ROLE_TINT: Record<RosterSlotCode, string> = {
  tank: "var(--aqt-tank)",
  dps: "var(--aqt-damage)",
  support: "var(--aqt-support)",
  flex: "var(--aqt-flex)"
};

function KeyValue({ term, children }: Readonly<{ term: string; children: React.ReactNode }>) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
      <dt className="font-mono text-[12px] uppercase tracking-[0.08em] text-[color:var(--aqt-fg-faint)] sm:pt-0.5">
        {term}
      </dt>
      <dd className="min-w-0 text-[15px] text-[color:var(--aqt-fg-muted)]">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

type TournamentOverviewPageProps = {
  tournamentId: number;
  slug: string;
};

/**
 * The tournament's landing section — one component, three compositions keyed on
 * `status` (wireframes §3 A/B/C). It is also where the retired Schedule and Maps
 * tabs live now: the phase timeline (`#phases`) and the map pool (`#map-pool`)
 * are the anchors their 301s point at.
 */
export default function TournamentOverviewPage({
  tournamentId,
  slug
}: Readonly<TournamentOverviewPageProps>) {
  const t = useTranslations();
  const format = useFormatter();
  const roundLabel = useBracketRoundLabel();
  // Null until hydration — recency text waits rather than disagree with SSR.
  const clockNow = useMinuteClock();

  const tournamentQuery = useTournamentQuery(slug);
  const tournament = tournamentQuery.data;
  const variant = tournament ? overviewVariant(tournament.status) : null;
  const workspaceId = tournament?.workspace_id;

  const stage = tournament && variant ? pickOverviewStage(tournament.stages, variant) : null;
  const showsGroupTable =
    variant !== "registration" && stage !== null && GROUP_TYPES[stage.stage_type] === true;
  // A group-only tournament has no bracket to read third place off, so the
  // podium falls back to the standings (plan §5).
  const podiumNeedsStandings =
    variant === "completed" &&
    !(tournament?.stages ?? []).some((item) => ELIMINATION_TYPES[item.stage_type] === true);
  const needsStandings = showsGroupTable || podiumNeedsStandings;
  // Team registration counts teams, not players, so it never reads the roster.
  const needsRegistrations =
    variant === "registration" && tournament?.team_formation !== "registration";

  const mapPool = useTournamentMapPool(tournamentId);

  // Same key and fetcher as `TournamentParticipantsPage`, so the two sections
  // share one cache entry instead of each paying for the roster.
  const registrationsQuery = useQuery({
    queryKey: tournamentQueryKeys.registrationsList(workspaceId ?? 0, tournamentId),
    queryFn: () => registrationService.listRegistrations(tournamentId),
    enabled: tournament !== undefined && needsRegistrations
  });

  // Same key as the bracket's own plan (`bracketData.createBracketQueryPlan`).
  const encountersQuery = useQuery({
    queryKey: tournamentQueryKeys.encounters(tournamentId, workspaceId),
    queryFn: () =>
      encounterService.getAll(1, "", tournamentId, -1, undefined, undefined, workspaceId),
    enabled: tournament !== undefined && variant !== "registration",
    refetchInterval: tournament ? getBracketRefetchInterval(tournament.status) : false,
    refetchIntervalInBackground: false
  });

  // Same key as `TournamentStandingsPage`.
  const standingsQuery = useQuery({
    queryKey: tournamentQueryKeys.standings(tournamentId, workspaceId),
    queryFn: () => tournamentService.getStandings(tournamentId, workspaceId ?? null),
    enabled: tournament !== undefined && needsStandings
  });

  // Same key as `TournamentTeamsPage` — the champion's battletags come off the
  // roster entity, which the encounters read does not carry.
  const teamsQuery = useQuery({
    queryKey: tournamentQueryKeys.teams(tournamentId, workspaceId),
    queryFn: () => teamService.getAll({ tournamentId, workspaceId }),
    enabled: tournament !== undefined && variant === "completed"
  });

  // Same key as `TournamentHeroPlaytimePage`.
  const heroesQuery = useQuery({
    queryKey: tournamentQueryKeys.heroPlaytime(tournamentId),
    queryFn: () => heroService.getHeroPlaytime(1, -1, "all", tournamentId, { workspaceId }),
    enabled: tournament !== undefined && variant === "completed"
  });

  const streamsQuery = useTournamentStreamsQuery(variant === "live" ? tournamentId : undefined);

  const encounters = encountersQuery.data ? encountersQuery.data.results : [];
  const registrations = registrationsQuery.data ?? [];
  const standings = standingsQuery.data ?? [];
  const teams = teamsQuery.data ? teamsQuery.data.results : [];

  const stageId = stage?.id ?? null;
  const stageEncounters = useMemo(
    () =>
      stageId === null ? [] : encounters.filter((encounter) => encounter.stage_id === stageId),
    [encounters, stageId]
  );
  // Play order (upper → lower → finals), so the window ends on the decider at
  // the right — `buildRoundGroups` interleaves by depth and would put the
  // grand final in the middle of the lower bracket.
  const stageType = stage?.stage_type;
  const roundGroups = useMemo(
    () =>
      stageType !== undefined && ELIMINATION_TYPES[stageType] === true
        ? orderEliminationRounds(stageEncounters, stageType).groups
        : buildRoundGroups(stageEncounters),
    [stageEncounters, stageType]
  );
  // Per stage, because "Latest results" spans stages: a group stage's highest
  // round is not a Grand Final, and naming it one would contradict the bracket.
  const finalRoundsByStage = useMemo(() => {
    const byStage: Record<number, number[]> = {};
    for (const item of tournament?.stages ?? []) {
      const rounds = encounters
        .filter((encounter) => encounter.stage_id === item.id)
        .map((encounter) => encounter.round);
      byStage[item.id] = stageFinalRounds(item.id, item.stage_type, rounds, encounters);
    }
    return byStage;
  }, [encounters, tournament?.stages]);
  const finalRounds = stageId === null ? [] : (finalRoundsByStage[stageId] ?? []);

  const liveTeamStreams = useMemo(
    () => buildLiveTeamStreams(streamsQuery.data),
    [streamsQuery.data]
  );

  const clock = (value: Date | string | null) => {
    if (value === null) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    // No explicit zone: next-intl's configured deployment zone is the same on
    // the server and the client, so the stamp survives hydration.
    return format.dateTime(date, { hour: "2-digit", minute: "2-digit" });
  };

  const encounterRound = (encounter: Encounter) =>
    roundLabel(
      encounter.round,
      encounter.stage_id === null ? [] : (finalRoundsByStage[encounter.stage_id] ?? [])
    );

  /** `STAGE · ROUND · BoN[ · HH:MM]`; the card's eyebrow is uppercased by CSS. */
  const eyebrowOf = (encounter: Encounter) => {
    const stageName =
      encounter.stage?.name ?? (encounter.stage_id === stageId ? stage?.name : undefined);
    const at = clock(encounter.scheduled_at);
    return [
      stageName,
      encounterRound(encounter),
      encounter.best_of ? `Bo${encounter.best_of}` : null,
      at
    ]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(" · ");
  };

  const streamsCountOf = (encounter: Encounter) =>
    [encounter.home_team_id, encounter.away_team_id].filter((teamId) => liveTeamStreams.has(teamId))
      .length;

  const bracketHref = (encounter: Encounter) =>
    `/tournaments/${slug}/bracket?stage=${encounter.stage_id ?? stageId ?? ""}&match=${encounter.id}`;

  // The primary query per branch: what the page cannot be drawn without.
  const primary =
    variant === "registration" ? (needsRegistrations ? registrationsQuery : null) : encountersQuery;
  const presentation = getPublicPageQueryPresentation({
    // Nothing to wait for when the branch has no primary query: the overview
    // itself is already resolved by the time this runs.
    data: primary === null ? tournament : primary.data,
    itemCount:
      primary === null ? 1 : variant === "registration" ? registrations.length : encounters.length,
    isPending: primary?.isPending ?? false,
    isError: primary?.isError ?? false,
    isFetching: primary?.isFetching ?? false
  });

  if (!tournament || variant === null) {
    if (tournamentQuery.isError) {
      return (
        <TournamentPageState state="initial-error" onRetry={() => void tournamentQuery.refetch()} />
      );
    }
    return <TournamentOverviewSkeleton />;
  }

  if (presentation.initialState === "error") {
    return <TournamentPageState state="initial-error" onRetry={() => void primary?.refetch()} />;
  }
  if (presentation.initialState === "skeleton" || presentation.contentState === null) {
    return <TournamentOverviewSkeleton />;
  }

  const overviewHref = `/tournaments/${slug}`;
  const teamsCount = tournament.teams_count ?? 0;
  const playersCount = tournamentPlayersCount(tournament);

  // ---- shared right-column blocks -----------------------------------------

  const mapPoolTiles =
    mapPool.pool.total > 0 ? (
      <OverviewCard>
        <MapPool id="map-pool" pool={mapPool.pool} scopes={mapPool.scopes} variant="tiles" />
      </OverviewCard>
    ) : null;

  const mapPoolSummary =
    mapPool.pool.total > 0 ? (
      <OverviewCard id="map-pool">
        <MapPool pool={mapPool.pool} scopes={mapPool.scopes} variant="summary" />
        <div className="mt-3">
          <CardLink href={`${overviewHref}/stats?tab=maps`}>
            {t("tournamentDetail.overview.mapPoolStats")}
          </CardLink>
        </div>
      </OverviewCard>
    ) : null;

  const phasesCard = (
    <OverviewCard title={t("tournamentDetail.overview.phases.title")} id="phases">
      <PhaseTimeline tournament={tournament} orientation="vertical" />
    </OverviewCard>
  );

  // ---- the mini bracket / group table (§3 ⑥) -------------------------------

  const miniBracket =
    stage !== null && !showsGroupTable && roundGroups.length > 0 ? (
      <OverviewCard
        title={t("tournamentDetail.overview.bracketMini.title", { stage: stage.name })}
        action={
          <CardLink href={`${overviewHref}/bracket?stage=${stage.id}`}>
            {t("tournamentDetail.overview.bracketMini.open")}
          </CardLink>
        }
      >
        <div className="flex gap-2 overflow-x-auto pb-1">
          {pickRoundWindow(roundGroups, currentRoundOf(roundGroups)).map((group) => (
            <div className="min-w-[13rem] flex-1 space-y-1.5" key={group.round}>
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--aqt-fg-faint)]">
                {roundLabel(group.round, finalRounds)}
              </div>
              {group.matches.map((match) => {
                const encounter = stageEncounters.find((item) => item.id === match.id);
                if (!encounter) return null;
                return (
                  <MatchCard
                    key={encounter.id}
                    encounter={encounter}
                    eyebrow={eyebrowOf(encounter)}
                    href={bracketHref(encounter)}
                    size="sm"
                    streamsCount={streamsCountOf(encounter)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </OverviewCard>
    ) : null;

  const stageStandings = stage
    ? standings
        .filter((row) => row.stage_id === stage.id)
        .sort((left, right) => left.position - right.position)
    : [];

  const groupTable =
    showsGroupTable && stage !== null && stageStandings.length > 0 ? (
      <OverviewCard
        title={t("tournamentDetail.overview.groupTable.title", { stage: stage.name })}
        action={
          <CardLink href={`${overviewHref}/bracket?stage=${stage.id}&view=standings`}>
            {t("tournamentDetail.overview.groupTable.open")}
          </CardLink>
        }
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[color:var(--aqt-border)] font-mono text-[11px] uppercase tracking-[0.08em] text-[color:var(--aqt-fg-faint)]">
              <th scope="col" className="w-8 py-1.5 pr-2 text-left font-medium">
                {t("tournamentDetail.overview.groupTable.pos")}
              </th>
              <th scope="col" className="py-1.5 pr-2 text-left font-medium">
                {t("tournamentDetail.overview.groupTable.team")}
              </th>
              <th scope="col" className="py-1.5 pr-2 text-right font-medium">
                {t("tournamentDetail.overview.groupTable.record")}
              </th>
              <th scope="col" className="py-1.5 text-right font-medium">
                {t("tournamentDetail.overview.groupTable.points")}
              </th>
            </tr>
          </thead>
          <tbody>
            {stageStandings.map((row) => (
              <tr key={row.id} className="border-b border-[color:var(--aqt-border)]/60">
                <td className="aqt-tnum py-1.5 pr-2 text-[color:var(--aqt-fg-faint)]">
                  {row.position}
                </td>
                <td className="py-1.5 pr-2">
                  <TeamName team={row.team ?? { name: t("common.tbd") }} size="xs" />
                </td>
                <td className="aqt-tnum py-1.5 pr-2 text-right">
                  {row.win}–{row.lose}
                </td>
                <td className="aqt-tnum py-1.5 text-right font-semibold">{row.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </OverviewCard>
    ) : null;

  // ---- A: registration (§3A) ----------------------------------------------

  if (variant === "registration") {
    const roleCounts = countRegistrationRoles(registrations);
    const submitted = [...registrations]
      .filter((registration) => registration.submitted_at !== null)
      .sort((left, right) => String(right.submitted_at).localeCompare(String(left.submitted_at)));
    const latest = submitted
      .slice(0, 3)
      .map((registration) => registration.battle_tag)
      .filter((tag): tag is string => typeof tag === "string" && tag.length > 0);
    const latestAt = submitted[0]?.submitted_at ?? null;
    const latestAgo =
      latestAt !== null && clockNow !== null
        ? format.relativeTime(new Date(latestAt), clockNow)
        : null;
    const isTeamRegistration = tournament.team_formation === "registration";
    const rosterShape = tournament.roster_shape;
    // Slots as role glyphs, not "2 × Урон": the icon is the site's role
    // vocabulary everywhere else, and `RosterSlotGlyph` still announces the
    // slot name for screen readers.
    const rosterSlots = rosterShape
      ? ROSTER_SLOT_CODES.filter((code) => (rosterShape.slots[code] ?? 0) > 0).map((code) => ({
          code,
          count: rosterShape.slots[code] as number
        }))
      : [];
    // The share of each role in the field — what a draft/balancer organizer
    // reads ("tanks are short"). Role tints, the same dots on the figures above.
    const roleShares = ROSTER_SLOT_CODES.filter((code) => roleCounts[code] > 0);
    const roleTotal = roleShares.reduce((sum, code) => sum + roleCounts[code], 0);

    const content = (
      <section className={styles.publicDataPage} aria-label={t("common.overview")}>
        {presentation.showUpdating ? <UpdatingBadge /> : null}

        {/* ① The phase timeline IS the page before the tournament starts. */}
        <OverviewCard id="phases">
          <PhaseTimeline tournament={tournament} orientation="horizontal" />
        </OverviewCard>

        {/* One column when there is no map pool yet: an aside holding nothing
            reads as a broken layout, not as restraint. The organizer links live
            in the hero's action row already, so they are not repeated here. */}
        <div className={cn("grid gap-4", mapPoolTiles && "lg:grid-cols-[6fr_4fr]")}>
          <div className={cn("grid content-start gap-4", !mapPoolTiles && "lg:grid-cols-2")}>
            {/* ② "Tanks are short" is what a draft/balancer tournament is read
                for; a team-registration one counts teams instead. */}
            <OverviewCard
              title={t("tournamentDetail.overview.registration.title")}
              action={
                <CardLink href={`${overviewHref}/participants`}>
                  {t("tournamentDetail.overview.registration.all")}
                </CardLink>
              }
            >
              {isTeamRegistration ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <StatTile
                    label={t("tournamentDetail.overview.registration.teams")}
                    value={String(teamsCount)}
                  />
                  <StatTile
                    label={t("tournamentDetail.overview.registration.total")}
                    value={String(tournament.registrations_count ?? 0)}
                  />
                </div>
              ) : (
                <>
                  <div className="grid gap-2 sm:grid-cols-4">
                    <StatTile
                      label={t("tournamentDetail.overview.registration.total")}
                      value={String(tournament.registrations_count ?? registrations.length)}
                    />
                    {roleShares.map((code) => (
                      <StatTile
                        key={code}
                        label={t(`common.roles.${code}`)}
                        value={String(roleCounts[code])}
                        accent={ROLE_TINT[code]}
                      />
                    ))}
                  </div>
                  {roleShares.length > 1 && roleTotal > 0 ? (
                    <div aria-hidden className="mt-3 flex h-1.5 gap-px overflow-hidden rounded-sm">
                      {roleShares.map((code) => (
                        <span
                          key={code}
                          style={{
                            width: `${(roleCounts[code] / roleTotal) * 100}%`,
                            background: ROLE_TINT[code]
                          }}
                        />
                      ))}
                    </div>
                  ) : null}
                  {latest.length > 0 ? (
                    <p className="mt-2 truncate text-[13px] text-[color:var(--aqt-fg-faint)]">
                      {t("tournamentDetail.overview.registration.latest")}: {latest.join(" · ")}
                      {latestAgo ? ` · ${latestAgo}` : null}
                    </p>
                  ) : null}
                </>
              )}
            </OverviewCard>

            {/* ③ Format and the full description move out of the hero — the whole
                text, since the hero shows one clamped line. Team formation is
                repeated from the header chip so the block always has a body. */}
            <OverviewCard title={t("tournamentDetail.overview.format.title")}>
              <dl className="grid gap-2.5">
                {tournament.stages.length > 0 ? (
                  <KeyValue term={t("common.format")}>
                    {formatLabel(tournament.stages, t)}
                    <span className="text-[color:var(--aqt-fg-faint)]">
                      {" — "}
                      {[...tournament.stages]
                        .sort((left, right) => left.order - right.order)
                        .map((item) => item.name)
                        .join(" → ")}
                    </span>
                  </KeyValue>
                ) : null}
                <KeyValue term={t("common.teamFormation")}>
                  {t(
                    `common.${(tournament.team_formation ?? "balancer") as "balancer" | "draft" | "registration"}`
                  )}
                  {rosterSlots.length > 0 ? (
                    <span className="ml-2 inline-flex items-center gap-2 align-middle">
                      {rosterSlots.map(({ code, count }) => (
                        <span key={code} className="inline-flex items-center gap-1">
                          <RosterSlotGlyph code={code} size={14} />
                          <span className="aqt-tnum text-[color:var(--aqt-fg-faint)]">
                            ×{count}
                          </span>
                        </span>
                      ))}
                    </span>
                  ) : null}
                </KeyValue>
                {tournament.description ? (
                  <KeyValue term={t("tournamentDetail.overview.format.description")}>
                    <span className="block whitespace-pre-line leading-relaxed">
                      {tournament.description}
                    </span>
                  </KeyValue>
                ) : null}
              </dl>
            </OverviewCard>
          </div>

          {/* ④ The retired Maps tab, as tiles per game mode. */}
          {mapPoolTiles ? <div className="grid content-start gap-4">{mapPoolTiles}</div> : null}
        </div>
      </section>
    );

    if (presentation.showRefreshError) {
      return (
        <TournamentPageState
          state="refresh-error"
          onRetry={() => void primary?.refetch()}
          isUpdating={primary?.isFetching ?? false}
        >
          {content}
        </TournamentPageState>
      );
    }
    return content;
  }

  // ---- B / C: after the first whistle -------------------------------------

  const liveEncounters = encounters.filter(isEncounterLive);
  const upcoming = encounters
    .filter((encounter) => {
      if (isEncounterCompleted(encounter) || isEncounterLive(encounter)) return false;
      if (encounter.scheduled_at === null) return false;
      const at = new Date(encounter.scheduled_at).getTime();
      return Number.isFinite(at) && at > Date.now();
    })
    .sort(
      (left, right) =>
        new Date(left.scheduled_at ?? 0).getTime() - new Date(right.scheduled_at ?? 0).getTime()
    )
    .slice(0, 4);
  const recent = encounters
    .filter(isEncounterCompleted)
    .sort((left, right) => {
      const leftAt = new Date(left.ended_at ?? left.scheduled_at ?? left.created_at).getTime();
      const rightAt = new Date(right.ended_at ?? right.scheduled_at ?? right.created_at).getTime();
      if (leftAt !== rightAt) return rightAt - leftAt;
      return right.id - left.id;
    })
    .slice(0, 4);

  const matchRows = (rows: Encounter[], withTime: boolean) => (
    <div>
      {rows.map((encounter) => (
        <MatchRow
          key={encounter.id}
          encounter={encounter}
          leading={(withTime ? clock(encounter.scheduled_at) : null) ?? encounterRound(encounter)}
          trailing={encounter.best_of ? `Bo${encounter.best_of}` : undefined}
          bracketHref={bracketHref(encounter)}
          returnTo={overviewHref}
        />
      ))}
    </div>
  );

  // ⑤ Live first and framed; nothing live falls back to the schedule, and
  // without a schedule to the last results.
  const nowBlock =
    liveEncounters.length > 0 ? (
      <OverviewCard
        title={t("tournamentDetail.overview.live.title")}
        action={
          <CardLink href={`${overviewHref}/matches`}>
            {t("tournamentDetail.overview.live.all")}
          </CardLink>
        }
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {liveEncounters.map((encounter) => (
            <MatchCard
              key={encounter.id}
              encounter={encounter}
              eyebrow={eyebrowOf(encounter)}
              href={bracketHref(encounter)}
              streamsCount={streamsCountOf(encounter)}
            />
          ))}
        </div>
      </OverviewCard>
    ) : upcoming.length > 0 ? (
      <OverviewCard
        title={t("tournamentDetail.overview.upcoming.title")}
        action={
          <CardLink href={`${overviewHref}/matches?view=time`}>
            {t("tournamentDetail.overview.live.all")}
          </CardLink>
        }
      >
        {matchRows(upcoming, true)}
      </OverviewCard>
    ) : recent.length > 0 ? (
      <OverviewCard
        title={t("tournamentDetail.overview.recent.title")}
        action={
          <CardLink href={`${overviewHref}/matches`}>
            {t("tournamentDetail.overview.live.all")}
          </CardLink>
        }
      >
        {matchRows(recent, false)}
      </OverviewCard>
    ) : (
      <TournamentPageState
        state="empty"
        title={t("tournamentDetail.overview.empty.title")}
        description={t("tournamentDetail.overview.empty.description")}
      />
    );

  if (variant === "live") {
    const officialStreams = streamsQuery.data?.official ?? [];
    const official = officialStreams[0];
    const participantsOnAir = streamsQuery.data?.participants.length ?? 0;
    const playedCount = encounters.filter(isEncounterCompleted).length;

    const content = (
      <section className={styles.publicDataPage} aria-label={t("common.overview")}>
        {presentation.showUpdating ? <UpdatingBadge /> : null}
        <div className="grid gap-4 lg:grid-cols-[7fr_3fr]">
          <div className="grid content-start gap-4">
            {nowBlock}
            {miniBracket}
            {groupTable}
          </div>
          <div className="grid content-start gap-4">
            {/* ⑦ The same timeline, second orientation. */}
            {phasesCard}
            {/* Poster only, no autoplay: the broadcast dock already owns the
                player, and a second one would fight it for the audio. */}
            {official ? (
              <OverviewCard title={t("tournamentDetail.overview.stream.title")}>
                <Link
                  href={`${overviewHref}/stream`}
                  className="block overflow-hidden rounded-md border border-[color:var(--aqt-border)] transition-colors hover:border-[color:var(--aqt-border-3)]"
                >
                  {official.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- remote poster from an arbitrary streaming host; not in `next.config` image domains.
                    <img
                      src={official.thumbnail_url}
                      alt=""
                      className="aspect-video w-full object-cover"
                      loading="lazy"
                    />
                  ) : null}
                  <span className="block px-2.5 py-2 text-sm font-semibold">
                    {official.channel}
                  </span>
                  {official.viewer_count != null ? (
                    <span className="aqt-tnum block px-2.5 pb-2 text-[11px] text-[color:var(--aqt-fg-faint)]">
                      {t("tournamentDetail.overview.stream.viewers", {
                        count: format.number(official.viewer_count)
                      })}
                    </span>
                  ) : null}
                </Link>
                <div className="mt-2 grid gap-1">
                  <CardLink href={`${overviewHref}/stream`}>
                    {t("tournamentDetail.overview.stream.open")}
                  </CardLink>
                  {participantsOnAir > 0 ? (
                    <CardLink href={`${overviewHref}/stream`}>
                      {t("tournamentDetail.overview.stream.participants", {
                        count: participantsOnAir
                      })}
                    </CardLink>
                  ) : null}
                </div>
              </OverviewCard>
            ) : null}
            {mapPoolSummary}
            <OverviewCard title={t("tournamentDetail.overview.numbers.title")}>
              <div className="grid gap-2 sm:grid-cols-2">
                <StatTile
                  label={t("tournamentDetail.overview.numbers.teams")}
                  value={String(teamsCount)}
                />
                <StatTile
                  label={t("tournamentDetail.overview.numbers.played")}
                  value={`${playedCount}/${encounters.length}`}
                />
              </div>
            </OverviewCard>
          </div>
        </div>
      </section>
    );

    if (presentation.showRefreshError) {
      return (
        <TournamentPageState
          state="refresh-error"
          onRetry={() => void encountersQuery.refetch()}
          isUpdating={encountersQuery.isFetching}
        >
          {content}
        </TournamentPageState>
      );
    }
    return content;
  }

  // ---- C: completed (§3C) -------------------------------------------------

  const teamById = new Map(teams.map((team) => [team.id, team]));
  // Only a bracket crowns a champion by its last match. A group stage's final
  // round is just another round, so its podium comes off the standings below.
  const grandFinal =
    stageId === null || stage === null || ELIMINATION_TYPES[stage.stage_type] !== true
      ? null
      : findGrandFinal(encounters, stageId);
  const lowerFinal =
    stageId === null || stage?.stage_type !== "double_elimination"
      ? null
      : findLowerFinal(encounters, stageId);

  const podiumTeam = (team: Team | null | undefined, note: string | null): PodiumTeam | null => {
    if (!team) return null;
    return { id: team.id, name: team.name, image_url: team.image_url, note };
  };

  let podium: { first: PodiumTeam; second: PodiumTeam; third: PodiumTeam | null } | null = null;

  if (grandFinal) {
    const side = winnerSide(grandFinal);
    const championSide = side ?? "home";
    const champion = championSide === "home" ? grandFinal.home_team : grandFinal.away_team;
    const runnerUp = championSide === "home" ? grandFinal.away_team : grandFinal.home_team;
    const championScore = championSide === "home" ? grandFinal.score.home : grandFinal.score.away;
    const runnerUpScore = championSide === "home" ? grandFinal.score.away : grandFinal.score.home;
    // The roster comes off the teams read; the encounters read carries no players.
    const roster = rosterBattletags(teamById.get(champion?.id ?? -1) ?? champion);
    const first = podiumTeam(champion, roster.length > 0 ? roster : null);
    const second = podiumTeam(
      runnerUp,
      t("tournamentDetail.overview.result.finalScore", {
        score: `${runnerUpScore}–${championScore}`
      })
    );
    let third: PodiumTeam | null = null;
    if (lowerFinal) {
      const lowerSide = winnerSide(lowerFinal);
      const eliminated = lowerSide === "home" ? lowerFinal.away_team : lowerFinal.home_team;
      third = podiumTeam(
        eliminated,
        t("tournamentDetail.overview.result.exitedIn", {
          round: roundLabel(lowerFinal.round, finalRounds)
        })
      );
    }
    if (first && second) podium = { first, second, third };
  } else if (podiumNeedsStandings) {
    // Group-only: third by standings (plan §5).
    const ranked = [...standings].sort(
      (left, right) => left.overall_position - right.overall_position
    );
    const note = (row: Standings | undefined, roster: boolean) => {
      if (!row) return null;
      if (roster) {
        const tags = rosterBattletags(teamById.get(row.team_id) ?? row.team);
        if (tags.length > 0) return tags;
      }
      return t("tournamentDetail.overview.result.record", { wins: row.win, losses: row.lose });
    };
    const first = podiumTeam(
      teamById.get(ranked[0]?.team_id ?? -1) ?? ranked[0]?.team,
      note(ranked[0], true)
    );
    const second = podiumTeam(
      teamById.get(ranked[1]?.team_id ?? -1) ?? ranked[1]?.team,
      note(ranked[1], false)
    );
    const third = podiumTeam(
      teamById.get(ranked[2]?.team_id ?? -1) ?? ranked[2]?.team,
      note(ranked[2], false)
    );
    if (first && second) podium = { first, second, third };
  }

  const topHeroes = heroesQuery.data
    ? [...heroesQuery.data.results]
        .sort((left, right) => right.playtime - left.playtime)
        .slice(0, 5)
    : [];
  const days = tournamentDaySpan(tournament.start_date, tournament.end_date);

  const completedContent = (
    <section className={styles.publicDataPage} aria-label={t("common.overview")}>
      {presentation.showUpdating ? <UpdatingBadge /> : null}
      <div className="grid gap-4 lg:grid-cols-[7fr_3fr]">
        <div className="grid content-start gap-4">
          {/* ⑧ A finished tournament opens on its result, not on the bracket
              corner the final happens to sit in. */}
          {podium ? (
            <OverviewCard title={t("tournamentDetail.overview.result.title")}>
              <Podium first={podium.first} second={podium.second} third={podium.third} />
            </OverviewCard>
          ) : null}
          {miniBracket}
          {groupTable}
          {podium === null && miniBracket === null && groupTable === null ? nowBlock : null}
        </div>
        <div className="grid content-start gap-4">
          {topHeroes.length > 0 ? (
            <OverviewCard
              title={t("tournamentDetail.overview.heroes.title")}
              action={
                <CardLink href={`${overviewHref}/stats?tab=heroes`}>
                  {t("tournamentDetail.overview.heroes.all")}
                </CardLink>
              }
            >
              <ol className="grid gap-1.5">
                {topHeroes.map((entry, index) => {
                  const share = Math.min(100, Math.max(0, entry.playtime * 100));
                  const widest = Math.min(100, Math.max(0, topHeroes[0].playtime * 100));
                  return (
                    <li
                      className="grid grid-cols-[1rem_1.5rem_minmax(0,1fr)_auto_2.75rem] items-center gap-2"
                      key={entry.hero.id}
                    >
                      <span
                        className="aqt-tnum text-[10px] text-[color:var(--aqt-fg-faint)]"
                        aria-hidden
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <Avatar className="size-6 border-none bg-transparent">
                        {entry.hero.image_path ? (
                          <AvatarImage
                            src={entry.hero.image_path}
                            alt={entry.hero.name}
                            className="object-contain"
                          />
                        ) : null}
                        <AvatarFallback className="bg-transparent" />
                      </Avatar>
                      <span className="min-w-0 truncate text-[13px]" title={entry.hero.name}>
                        {entry.hero.name}
                      </span>
                      <span
                        aria-hidden
                        className="hidden h-1.5 w-16 overflow-hidden rounded-sm bg-[color:var(--aqt-border)] sm:block"
                      >
                        <span
                          className="block h-full bg-[color:var(--aqt-fg-muted)]"
                          style={{ width: `${widest > 0 ? (share / widest) * 100 : 0}%` }}
                        />
                      </span>
                      <span className="aqt-tnum text-right text-[12px] text-[color:var(--aqt-fg-muted)]">
                        {format.number(entry.playtime, {
                          style: "percent",
                          maximumFractionDigits: 1
                        })}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </OverviewCard>
          ) : null}
          {mapPoolSummary}
          <OverviewCard title={t("tournamentDetail.overview.numbers.title")}>
            <div className="grid gap-2 sm:grid-cols-2">
              <StatTile
                label={t("tournamentDetail.overview.numbers.teams")}
                value={String(teamsCount)}
              />
              <StatTile
                label={t("tournamentDetail.overview.numbers.players")}
                value={String(playersCount)}
              />
              <StatTile
                label={t("tournamentDetail.overview.numbers.matches")}
                value={String(encounters.length)}
              />
              {days !== null ? (
                <StatTile
                  label={t("tournamentDetail.overview.numbers.days")}
                  value={String(days)}
                />
              ) : null}
            </div>
          </OverviewCard>
        </div>
      </div>
    </section>
  );

  if (presentation.showRefreshError) {
    return (
      <TournamentPageState
        state="refresh-error"
        onRetry={() => void encountersQuery.refetch()}
        isUpdating={encountersQuery.isFetching}
      >
        {completedContent}
      </TournamentPageState>
    );
  }
  return completedContent;
}
