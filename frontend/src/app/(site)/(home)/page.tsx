import React, { Suspense, cache } from "react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { BarChart3, Calendar, Trophy, Users } from "lucide-react";

import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHero, HeroCoord } from "@/components/site/PageHero";
import { PageStateCard } from "@/components/ui/page-state-card";
import { PlaceBadge } from "@/components/ui/place-badge";
import { PlatformStatsGrid } from "@/components/stats/PlatformStatsGrid";
import statisticsService from "@/services/statistics.service";
import workspaceService from "@/services/workspace.service";
import tournamentService from "@/services/tournament.service";
import { isTenantHost } from "@/lib/tenant-host";
import { formatDateRange } from "@/lib/utils";
import {
  ChartCardSkeleton,
  StatsGridSkeleton,
  TableCardSkeleton,
} from "@/components/skeletons/dashboard-skeletons";
import {
  isTournamentStatusActive,
  getTournamentStatusMeta,
} from "@/lib/tournament-status";
import type { Tournament } from "@/types/tournament.types";
import type { Workspace } from "@/types/workspace.types";

export const dynamic = "force-dynamic";

// Both of these are asked for by half a dozen independent sections of this
// page. `cache()` collapses them to one header read / one HTTP request per
// render instead of seven and two.
const getTenantMode = cache(isTenantHost);
const getWorkspaces = cache(() => workspaceService.getAll());

// Deterministic accent per workspace, cycled over the palette tokens so a
// workspace theme can retint it. This used to be a raw HSL hue rotation.
const WORKSPACE_ACCENTS = [
  "--aqt-teal",
  "--aqt-blue",
  "--aqt-amber",
  "--aqt-violet",
  "--aqt-emerald",
  "--aqt-rose",
] as const;

function workspaceAccent(id: number): string {
  return `var(${WORKSPACE_ACCENTS[id % WORKSPACE_ACCENTS.length]})`;
}

function accentTint(accent: string, percent: number): string {
  return `color-mix(in srgb, ${accent} ${percent}%, transparent)`;
}

/** Focus ring for the whole-card links (event cards, workspace cards). */
const CARD_LINK_FOCUS =
  "rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--aqt-bg)]";

// ─────────────────────────────────────────────────────────────────────────────
// Root page
// ─────────────────────────────────────────────────────────────────────────────

export default async function Home() {
  // On a tenant (white-label) host the whole site is locked to one
  // workspace, so the cross-workspace "communities on this platform" list
  // is hidden. See middleware.ts (Task 6) for the header injection.
  const tenantMode = await getTenantMode();
  const t = await getTranslations();

  return (
    <div className="space-y-8">
      {/* Cinematic page intro */}
      <PageIntroSection tenantMode={tenantMode} />

      {/* Live / upcoming events */}
      <section>
        <Suspense fallback={<EventsSkeleton />}>
          <LiveEventsSection />
        </Suspense>
      </section>

      {/* Platform stats */}
      <section>
        <p className="mb-4 text-[11px] font-semibold tracking-[0.14em] uppercase text-muted-foreground/50">
          {t("home.byTheNumbers")}
        </p>
        <Suspense fallback={<StatsGridSkeleton />}>
          <StatsGrid />
        </Suspense>
      </section>

      {/* Workspace / community cards */}
      {!tenantMode && (
        <section>
          <p className="mb-1.5 text-[11px] font-semibold tracking-[0.14em] uppercase text-muted-foreground/50">
            {t("home.workspaces")}
          </p>
          <h2 className="font-display text-3xl font-bold uppercase tracking-wide text-foreground mb-5">
            {t("home.communitiesOnPlatform")}
          </h2>
          <Suspense fallback={<CommunitiesSkeleton />}>
            <CommunitiesSection />
          </Suspense>
        </section>
      )}

      {/* Season dashboard */}
      <section className="pb-8 space-y-4">
        <div>
          <p className="mb-1.5 text-[11px] font-semibold tracking-[0.14em] uppercase text-muted-foreground/50">
            {t("home.seasonOverview")}
          </p>
          <h2 className="font-display text-3xl font-bold uppercase tracking-wide text-foreground">
            {t("home.communityDashboard")}
          </h2>
        </div>

        {/* Full-width tournament activity chart */}
        <Card className="overflow-hidden border-border">
          <Suspense fallback={<ChartCardSkeleton />}>
            <TournamentActivityCard />
          </Suspense>
        </Card>

        {/* 3-column: division rings | champions | top winrate */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="overflow-hidden border-border">
            <Suspense fallback={<ChartCardSkeleton />}>
              <DivisionRingsCard />
            </Suspense>
          </Card>

          <Card className="overflow-hidden border-border">
            <Suspense fallback={<TableCardSkeleton />}>
              <ChampionsCard />
            </Suspense>
          </Card>

          <Card className="overflow-hidden border-border">
            <Suspense fallback={<TableCardSkeleton />}>
              <TopWinRateCard />
            </Suspense>
          </Card>
        </div>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page intro (cinematic header)
// ─────────────────────────────────────────────────────────────────────────────

async function PageIntroSection({ tenantMode }: { tenantMode: boolean }) {
  const t = await getTranslations();
  return (
    <PageHero
      align="center"
      eyebrow={<HeroCoord>{t("home.eyebrow")}</HeroCoord>}
      title={t.rich("home.title", { em: (chunks) => <em>{chunks}</em> })}
      lede={tenantMode ? t("home.ledeTenant") : t("home.ledePlatform")}
      actions={
        <>
          <Button asChild size="lg" className="shadow-lg shadow-primary/20">
            <Link href="/tournaments">
              <Trophy className="mr-2 h-5 w-5" aria-hidden />
              {t("home.browseTournaments")}
            </Link>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link href="/tournaments/analytics">
              <BarChart3 className="mr-2 h-5 w-5" aria-hidden />
              {t("common.analytics")}
            </Link>
          </Button>
        </>
      }
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Live events section
// ─────────────────────────────────────────────────────────────────────────────

type TournamentWithCount = Tournament & { registrations_count?: number };

async function LiveEventsSection() {
  const t = await getTranslations();
  const tenantMode = await getTenantMode();
  let activeTournaments: TournamentWithCount[] = [];
  let workspaceMap = new Map<number, Workspace>();

  try {
    const [tournamentsData, workspaces] = await Promise.all([
      tournamentService.getActive({ skipWorkspace: !tenantMode }),
      getWorkspaces(),
    ]);

    activeTournaments = (tournamentsData.results as TournamentWithCount[])
      .filter((tour) => isTournamentStatusActive(tour.status))
      .slice(0, 6);

    workspaceMap = new Map(workspaces.map((w) => [w.id, w]));
  } catch {
    // fail silently — show empty state
  }

  const liveCount = activeTournaments.filter(
    (tour) => tour.status === "live" || tour.status === "playoffs"
  ).length;
  const upcomingCount = activeTournaments.length - liveCount;

  if (activeTournaments.length === 0) {
    return <NoEventsState />;
  }

  return (
    <div>
      <div className="flex items-center gap-2.5 mb-4">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[color:var(--aqt-emerald)] opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[color:var(--aqt-emerald)]" />
        </span>
        <span className="text-[11px] font-bold tracking-[0.14em] uppercase text-[color:var(--aqt-emerald)]">
          {liveCount > 0 && t("statistics.liveCount", { count: liveCount })}
          {liveCount > 0 && upcomingCount > 0 && " · "}
          {upcomingCount > 0 && t("statistics.upcomingCount", { count: upcomingCount })}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {activeTournaments.map((tour) => (
          <EventCard
            key={tour.id}
            tournament={tour}
            workspace={workspaceMap.get(tour.workspace_id)}
            showWorkspaceBadge={!tenantMode}
          />
        ))}
      </div>
    </div>
  );
}

async function EventCard({
  tournament,
  workspace,
  showWorkspaceBadge = true,
}: {
  tournament: TournamentWithCount;
  workspace?: Workspace;
  showWorkspaceBadge?: boolean;
}) {
  const t = await getTranslations();
  const locale = await getLocale();
  const isLive =
    tournament.status === "live" || tournament.status === "playoffs";
  const statusMeta = getTournamentStatusMeta(tournament.status);
  const accent = workspace ? workspaceAccent(workspace.id) : "var(--aqt-teal)";
  const dateStr = formatDateRange(
    tournament.start_date,
    tournament.end_date,
    locale
  );

  return (
    <Link href={`/tournaments/${tournament.id}`} className={CARD_LINK_FOCUS}>
      <div className="group h-full rounded-xl border border-border/60 bg-card/50 p-4 flex flex-col gap-3 hover:bg-card hover:border-border transition-all duration-150">
        {/* Status + badges row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {isLive ? (
              <>
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[color:var(--aqt-emerald)] opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[color:var(--aqt-emerald)]" />
                </span>
                <span className="text-[10px] font-bold tracking-[0.1em] uppercase text-[color:var(--aqt-emerald)]">
                  {t("common.live")}
                </span>
              </>
            ) : (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--aqt-amber)] inline-block flex-shrink-0" />
                <span
                  className={`text-[10px] font-bold tracking-[0.1em] uppercase ${statusMeta.textClassName}`}
                >
                  {statusMeta.badgeLabel}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {tournament.is_league && (
              <span
                className="text-[9px] font-bold tracking-[0.1em] uppercase px-1.5 py-0.5 rounded-full"
                style={{
                  background: accentTint("var(--aqt-violet)", 14),
                  border: `1px solid ${accentTint("var(--aqt-violet)", 28)}`,
                  color: "var(--aqt-violet)",
                }}
              >
                {t("common.league")}
              </span>
            )}
            {workspace && showWorkspaceBadge && (
              <span
                className="text-[9px] font-bold tracking-[0.08em] uppercase px-1.5 py-0.5 rounded-full"
                style={{
                  background: accentTint(accent, 12),
                  border: `1px solid ${accentTint(accent, 25)}`,
                  color: accent,
                }}
              >
                {workspace.name}
              </span>
            )}
          </div>
        </div>

        {/* Tournament name */}
        <div className="font-display text-[17px] font-bold leading-snug text-foreground flex-1">
          {tournament.name}
        </div>

        {/* Meta info */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Calendar className="h-3 w-3 flex-shrink-0" aria-hidden />
            {dateStr}
          </div>
          <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Users className="h-3 w-3 flex-shrink-0" aria-hidden />
            <span className="tabular-nums">
              {tournament.registrations_count ?? 0}
            </span>{" "}
            {isLive ? t("common.participants") : t("common.registered")}
          </div>
        </div>

        {/* Footer */}
        <div className="pt-2.5 border-t border-border/50 flex justify-end">
          <span
            className="text-[12px] font-semibold tracking-[0.02em]"
            style={{ color: accent }}
          >
            {t("common.view")} →
          </span>
        </div>
      </div>
    </Link>
  );
}

async function NoEventsState() {
  const t = await getTranslations();
  return (
    <div className="flex flex-col items-center gap-3 p-8 rounded-xl border border-dashed border-border/50 max-w-sm mx-auto text-center">
      <Calendar className="h-7 w-7 text-muted-foreground/30" aria-hidden />
      <div>
        <p className="text-sm font-semibold text-muted-foreground mb-1">
          {t("home.noEventsTitle")}
        </p>
        <p className="text-xs text-muted-foreground/50 leading-relaxed">
          {t("home.noEventsBody")}
        </p>
      </div>
      <Button variant="outline" size="sm" asChild className="mt-1">
        <Link href="/tournaments">{t("home.browsePastTournaments")}</Link>
      </Button>
    </div>
  );
}

function EventsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-44 rounded-xl border border-border/60 bg-card/30 animate-pulse"
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Communities section
// ─────────────────────────────────────────────────────────────────────────────

async function CommunitiesSection() {
  let workspaces: Workspace[] = [];
  try {
    workspaces = (await getWorkspaces()).filter((w) => w.is_active);
  } catch {
    return null;
  }

  if (workspaces.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {workspaces.map((workspace) => (
        <WorkspaceCard key={workspace.id} workspace={workspace} />
      ))}
    </div>
  );
}

function WorkspaceCard({ workspace }: { workspace: Workspace }) {
  const accent = workspaceAccent(workspace.id);
  const abbr = workspace.name.slice(0, 2).toUpperCase();

  return (
    <Link
      href={`/workspace/${workspace.slug}`}
      className={`border border-border/60 bg-card/50 p-5 flex flex-col gap-3 hover:bg-card hover:border-border transition-all duration-150 ${CARD_LINK_FOCUS}`}
    >
      <div className="flex items-center gap-3">
        <div
          aria-hidden
          className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center font-display font-extrabold text-[14px] tracking-[0.04em]"
          style={{
            background: accentTint(accent, 15),
            border: `1px solid ${accentTint(accent, 30)}`,
            color: accent,
          }}
        >
          {abbr}
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-sm text-foreground truncate">
            {workspace.name}
          </div>
          {workspace.description && (
            <div className="text-[11px] text-muted-foreground/60 mt-0.5 line-clamp-1">
              {workspace.description}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

function CommunitiesSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-20 rounded-xl border border-border/60 bg-card/30 animate-pulse"
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats grid
// ─────────────────────────────────────────────────────────────────────────────

async function StatsGrid() {
  const skipWorkspace = !(await getTenantMode());
  let overall = null;
  try {
    overall = await statisticsService.getOverallStatistics({ skipWorkspace });
  } catch {
    // Fail silently
  }

  if (!overall) {
    return <PageStateCard state="error" />;
  }

  return <PlatformStatsGrid totals={overall} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard primitives
// ─────────────────────────────────────────────────────────────────────────────

function DashHeader({ children }: { children: React.ReactNode }) {
  return (
    <CardHeader className="border-b border-border px-5 py-4 font-display text-[15px] font-bold uppercase tracking-[0.04em] text-foreground">
      {children}
    </CardHeader>
  );
}

/**
 * Header + explained failure/empty body for a dashboard card. `error` is a
 * genuine fetch failure; `empty` is a successful request whose (workspace
 * scoped) result set is empty — e.g. a fresh tenant community with no finished
 * tournaments yet. Border and background are dropped because the surrounding
 * `Card` already draws them.
 */
function DashCardState({
  title,
  state,
}: {
  title: string;
  state: "error" | "empty";
}) {
  return (
    <>
      <DashHeader>{title}</DashHeader>
      <PageStateCard state={state} className="border-0 bg-transparent" />
    </>
  );
}

/**
 * One leaderboard row, shared by the championships and win-rate cards — they
 * used to be the same markup pasted twice with a different rank treatment.
 */
function LeaderboardRow({
  rank,
  name,
  value,
  accent,
}: {
  rank: number;
  name: string;
  value: string;
  accent: string;
}) {
  return (
    <div
      className="flex items-center justify-between px-5 py-2.5 text-[13px] border-b last:border-b-0 hover:bg-[color:var(--aqt-overlay-2)] transition-colors"
      style={{
        borderColor: "var(--aqt-border)",
        color: "var(--aqt-fg-muted)",
      }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <PlaceBadge place={rank} />
        <Link
          href={`/users/${name.replace("#", "-")}`}
          className="font-semibold truncate rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)]"
        >
          {name}
        </Link>
      </div>
      <span
        className="font-bold tabular-nums min-w-[44px] text-right"
        style={{ color: accent }}
      >
        {value}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard cards
// ─────────────────────────────────────────────────────────────────────────────

async function TournamentActivityCard() {
  const t = await getTranslations();
  const skipWorkspace = !(await getTenantMode());
  let visible = null;
  let max = 1;
  try {
    const data = await statisticsService.getTournaments({ skipWorkspace });
    visible = data.slice(-24);
    if (visible.length > 0) {
      max = Math.max(...visible.map((d) => d.players_count), 1);
    }
  } catch {
    // visible stays null on a genuine fetch error
  }

  const title = t("statistics.tournamentActivity");

  if (visible === null) {
    return <DashCardState title={title} state="error" />;
  }

  if (visible.length === 0) {
    return <DashCardState title={title} state="empty" />;
  }

  const labelEvery = Math.ceil(visible.length / 8);

  return (
    <>
      <DashHeader>{title}</DashHeader>
      <div className="px-5 pb-3 pt-5">
        <div className="flex items-end gap-[4px]" style={{ height: 110 }}>
          {visible.map((entry, i) => (
            <div
              key={entry.id}
              className="flex-1 flex flex-col justify-end"
              style={{ height: "100%" }}
            >
              <div
                style={{
                  height: `${(entry.players_count / max) * 100}%`,
                  background:
                    i === visible.length - 1
                      ? "var(--aqt-teal)"
                      : accentTint("var(--aqt-teal)", 22),
                  borderRadius: "3px 3px 0 0",
                  minHeight: 3,
                }}
              />
            </div>
          ))}
        </div>
        <div className="flex mt-1.5">
          {visible.map((entry, i) => (
            <span
              key={entry.id}
              className="flex-1 text-center"
              style={{ fontSize: 9, color: "var(--aqt-fg-faint)" }}
            >
              {i % labelEvery === 0 ? entry.name : ""}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

async function DivisionRingsCard() {
  const t = await getTranslations();
  const skipWorkspace = !(await getTenantMode());
  let roles: { label: string; val: number; pct: number; color: string }[] | null = null;
  try {
    const data = await statisticsService.getTournamentsDivision({
      skipWorkspace,
    });
    roles = [];
    if (data.length > 0) {
      const mean = (vals: (number | null)[]) => {
        const nums = vals.filter((v): v is number => v != null);
        return nums.length
          ? nums.reduce((a, b) => a + b, 0) / nums.length
          : 0;
      };

      const meanTank = mean(data.map((d) => d.tank_avg_div));
      const meanDamage = mean(data.map((d) => d.damage_avg_div));
      const meanSupport = mean(data.map((d) => d.support_avg_div));
      const globalMax = Math.max(meanTank, meanDamage, meanSupport, 0.001);

      roles = [
        { label: t("statistics.roleTank"), val: meanTank, pct: (meanTank / globalMax) * 100, color: "var(--aqt-tank)" },
        { label: t("statistics.roleDamage"), val: meanDamage, pct: (meanDamage / globalMax) * 100, color: "var(--aqt-damage)" },
        { label: t("statistics.roleSupport"), val: meanSupport, pct: (meanSupport / globalMax) * 100, color: "var(--aqt-support)" },
      ];
    }
  } catch {
    // Fail silently
  }

  const title = t("statistics.avgDivisionByRole");

  if (roles === null) {
    return <DashCardState title={title} state="error" />;
  }

  if (roles.length === 0) {
    return <DashCardState title={title} state="empty" />;
  }

  const r = 28;
  const circum = 2 * Math.PI * r;

  return (
    <>
      <DashHeader>{title}</DashHeader>
      <div className="px-5 py-5 flex gap-4 items-start flex-wrap">
        {roles.map((role) => (
          <div
            key={role.label}
            className="flex flex-col items-center gap-2 flex-1"
            style={{ minWidth: 76 }}
          >
            <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden>
              <circle
                cx="36" cy="36" r={r}
                fill="none"
                stroke="var(--aqt-border)"
                strokeWidth="7"
              />
              <circle
                cx="36" cy="36" r={r}
                fill="none"
                stroke={role.color}
                strokeWidth="7"
                strokeDasharray={`${(circum * role.pct) / 100} ${circum}`}
                strokeLinecap="round"
                transform="rotate(-90 36 36)"
              />
              <text
                x="36" y="40"
                textAnchor="middle"
                fontSize="12"
                fontWeight="700"
                fill={role.color}
                style={{ fontFamily: "var(--font-onest)" }}
              >
                {role.val.toFixed(1)}
              </text>
            </svg>
            <span
              className="text-[12px] font-medium"
              style={{ color: "var(--aqt-fg-muted)" }}
            >
              {role.label}
            </span>
          </div>
        ))}
        <p
          className="flex-[2] text-[12px] leading-relaxed self-center"
          style={{ color: "var(--aqt-fg-dim)", minWidth: 90 }}
        >
          {t("home.avgDivisionDesc")}
        </p>
      </div>
    </>
  );
}

async function ChampionsCard() {
  const t = await getTranslations();
  const skipWorkspace = !(await getTenantMode());
  let top = null;
  try {
    const data = await statisticsService.getChampions({ skipWorkspace });
    top = data.results.slice(0, 5);
  } catch {
    // Fail silently
  }

  const title = t("statistics.mostChampionships");

  if (!top) {
    return <DashCardState title={title} state="error" />;
  }

  if (top.length === 0) {
    return <DashCardState title={title} state="empty" />;
  }

  return (
    <>
      <DashHeader>{title}</DashHeader>
      {top.map((player, i) => (
        <LeaderboardRow
          key={player.id}
          rank={i + 1}
          name={player.name}
          value={`${player.value}×`}
          accent="var(--aqt-teal)"
        />
      ))}
    </>
  );
}

async function TopWinRateCard() {
  const t = await getTranslations();
  const skipWorkspace = !(await getTenantMode());
  let top = null;
  try {
    const data = await statisticsService.getTopWinratePlayers({
      skipWorkspace,
    });
    top = data.results.slice(0, 5);
  } catch {
    // Fail silently
  }

  const title = t("statistics.topWinRate");

  if (!top) {
    return <DashCardState title={title} state="error" />;
  }

  if (top.length === 0) {
    return <DashCardState title={title} state="empty" />;
  }

  return (
    <>
      <DashHeader>{title}</DashHeader>
      {top.map((player, i) => (
        <LeaderboardRow
          key={player.id}
          rank={i + 1}
          name={player.name}
          value={`${(player.value * 100).toFixed(1)}%`}
          accent="var(--aqt-emerald)"
        />
      ))}
    </>
  );
}
