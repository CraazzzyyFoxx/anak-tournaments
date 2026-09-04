"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";

import TournamentBroadcastDock from "./TournamentBroadcastDock";
import TournamentLinkChips from "./TournamentLinkChips";
import TournamentRegisterButton from "./TournamentRegisterButton";
import { NextPhaseChip } from "./NextPhaseChip";
import {
  areStreamsVisible,
  getTournamentStatusMeta,
  isTournamentStatusEnded,
} from "@/lib/tournament-status";
import { cn, formatDateRange } from "@/lib/utils";
import { useTournamentRealtime } from "@/hooks/useTournamentRealtime";
import { createTrailingCoalescer } from "@/hooks/tournamentRealtime.helpers";
import { useTournamentQuery } from "../_hooks/useTournamentClientData";
import { TournamentRouteProvider } from "../_hooks/useTournamentId";
import { useSyncActiveWorkspace } from "@/hooks/useSyncActiveWorkspace";
import { useTournamentStreamRealtime } from "@/hooks/useTournamentStreamRealtime";
import { useTournamentStreamsQuery } from "../_hooks/useTournamentStreams";
import type { StageSummary } from "@/types/tournament.types";

import { useTranslations, useLocale } from "next-intl";
import TournamentSectionNav from "./TournamentSectionNav";
import { TournamentShellSkeleton } from "./TournamentSkeletons";
import TournamentShellError from "../TournamentShellError";
import { PageHero, HeroCoord } from "@/components/site/PageHero";
import { PageStateCard } from "@/components/ui/page-state-card";
import { buttonVariants } from "@/components/ui/button";

type TournamentClientLayoutProps = {
  slug: string;
  children: React.ReactNode;
};

/** The translator the header helpers accept — next-intl's own, for the root namespace. */
export type Translate = ReturnType<typeof useTranslations<never>>;

export function formatLabel(stages: StageSummary[], t: Translate): string {
  const hasGroup = stages.some((s) => s.stage_type === "round_robin" || s.stage_type === "swiss");
  const hasElim = stages.some(
    (s) => s.stage_type === "single_elimination" || s.stage_type === "double_elimination"
  );
  if (hasGroup && hasElim) return t("common.formatLabel.groupsPlayoff");
  if (hasElim) return t("common.formatLabel.playoffBracket");
  if (hasGroup) return t("common.formatLabel.groupStage");
  return stages[0]?.stage_type?.replace(/_/g, " ") ?? "—";
}

/**
 * Whether the hero has scrolled under the site header. Drives the rail's
 * collapsed slots: the rail is the only sticky surface this page adds under the
 * site header, so the tournament's name moves INTO it rather than into a second
 * bar. `false` on the server and until the observer fires, so SSR never renders
 * the collapsed state.
 */
function useScrolledPast<T extends HTMLElement>(): [(node: T | null) => void, boolean] {
  const [past, setPast] = React.useState(false);
  const observerRef = React.useRef<IntersectionObserver | null>(null);
  // A callback ref, not an effect on mount: the hero mounts AFTER the shell's
  // skeleton, so a mount-time effect would observe nothing.
  const attach = React.useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setPast(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      // The site header covers the top 3.5rem; the hero counts as gone once it
      // slides under that band, not only once it leaves the window.
      { rootMargin: "-56px 0px 0px 0px" }
    );
    observer.observe(node);
    observerRef.current = observer;
  }, []);
  React.useEffect(() => () => observerRef.current?.disconnect(), []);
  return [attach, past];
}

export default function TournamentClientLayout({
  slug,
  children
}: Readonly<TournamentClientLayoutProps>) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const tournamentQuery = useTournamentQuery(slug);
  const tournament = tournamentQuery.data;
  // Known immediately once the overview resolves; `undefined` while pending —
  // every hook below already tolerates that (see their `| undefined` params),
  // so the realtime subscription and streams query start the instant the
  // numeric id is known instead of waiting for the render past the early
  // returns below.
  const tournamentId = tournament?.id;
  const routeRefresh = React.useMemo(
    () => createTrailingCoalescer(() => router.refresh(), 500),
    [router, tournamentId],
  );

  React.useEffect(() => () => routeRefresh.cancel(), [routeRefresh]);

  useTournamentRealtime({
    tournamentId,
    workspaceId: tournament?.workspace_id,
    onStructureChanged: routeRefresh.schedule,
  });

  // Follow the tournament the viewer opened: switch the active workspace to its
  // owner (apex-only; a manual switch on the page is not fought).
  useSyncActiveWorkspace(tournament?.workspace_id);

  // The shell owns the tournament's streams, for two consumers that outlive any
  // one section: the persistent broadcast block below the hero, and the Stream
  // tab's present-or-absent gate in the nav. It is also the single owner of the
  // `tournament:{id}:streams` subscription — the sections read the same query
  // key, so one jittered refetch here keeps all of them fresh.
  //
  // Both are gated on the phase (`areStreamsVisible`) at the SOURCE rather than
  // at each render site: a registration-phase page then makes no stream read and
  // opens no stream subscription, and the two consumers go quiet on their own —
  // the dock renders nothing without officials, the nav tab nothing without
  // entries.
  const streamsTournamentId =
    tournament && areStreamsVisible(tournament.status) ? tournamentId : undefined;
  const streams = useTournamentStreamsQuery(streamsTournamentId).data;
  useTournamentStreamRealtime({ tournamentId: streamsTournamentId });

  const [heroRef, heroScrolledPast] = useScrolledPast<HTMLDivElement>();

  if (tournamentQuery.isPending) {
    return <TournamentShellSkeleton />;
  }

  if (tournamentQuery.isError) {
    return <TournamentShellError />;
  }

  if (!tournament) {
    return (
      <div className="aqt-tn">
        <PageStateCard state="not-found" title={t("common.tournamentNotFound")} />
      </div>
    );
  }

  const stages = tournament.stages;
  const teamsCount = tournament.teams_count ?? 0;
  const registrations = tournament.registrations_count ?? 0;

  const statusVariant = getTournamentStatusMeta(tournament.status).variant;
  const isEnded = isTournamentStatusEnded(tournament.status);
  const isLive = tournament.status === "live" || tournament.status === "playoffs";
  const overviewHref = `/tournaments/${tournament.slug}`;
  // The draft room is an external route, so it is a header action rather than a
  // rail tab. It appears once registration is over — before that there is no
  // room to open.
  const showDraftLink =
    tournament.team_formation === "draft" && tournament.status !== "registration";

  const registerButton = !isEnded ? <TournamentRegisterButton tournament={tournament} /> : null;
  const nextPhaseChip = <NextPhaseChip tournament={tournament} href={`${overviewHref}#phases`} />;

  return (
    <div className="aqt-tn space-y-4">
      {tournament.is_hidden && (
        <div
          role="status"
          className="rounded-xl border px-4 py-3"
          style={{
            borderColor: "var(--aqt-border)",
            background: "var(--aqt-overlay-2)"
          }}
        >
          <p className="text-sm font-semibold">{t("tournamentDetail.previewBanner")}</p>
          <p className="text-xs opacity-70">{t("tournamentDetail.previewBannerDescription")}</p>
        </div>
      )}
      <div ref={heroRef}>
        <PageHero
          align="start"
          eyebrow={
            <HeroCoord className="inline-flex flex-wrap items-center gap-2">
              <Link
                href="/tournaments"
                className="transition-colors hover:text-[color:var(--aqt-teal)]"
              >
                {t("common.tournaments")}
              </Link>
              <span className="opacity-50">/</span>
              <span>{formatDateRange(tournament.start_date, tournament.end_date, locale)}</span>
            </HeroCoord>
          }
          title={tournament.name}
          meta={
            <>
              <span className={cn("status-pill", statusVariant)}>
                {isLive && <span className="dot" />}
                {t(`common.statusBadge.${tournament.status}`)}
              </span>
              {nextPhaseChip}
              {tournament.is_league && <span className="meta-pill">{t("common.league")}</span>}
              {stages.length > 0 ? (
                <span className="meta-pill">
                  <span className="k">{t("common.format")}</span>
                  <span className="v">{formatLabel(stages, t)}</span>
                </span>
              ) : null}
              <span className="meta-pill">
                <span className="k">{t("common.teamFormation")}</span>
                {/* The cast must list every value the column can hold. It said
                    `"balancer" | "draft"` while `team_formation` is a free string,
                    so a "registration" tournament rendered the raw key path
                    `common.registration` in the badge. */}
                <span className="v">
                  {t(
                    `common.${(tournament.team_formation ?? "balancer") as "balancer" | "draft" | "registration"}`,
                  )}
                </span>
              </span>
              <span className="meta-pill aqt-tnum">
                {teamsCount > 0
                  ? t("tournamentDetail.header.teamsAndPlayers", {
                      teams: teamsCount,
                      players: registrations
                    })
                  : t("tournamentDetail.header.players", { players: registrations })}
              </span>
            </>
          }
          lede={
            tournament.description ? (
              /* One line; the whole text lives in the overview's Format card,
                 so this is a teaser, not the place to read it. A span, because
                 PageHero wraps the lede in a <p>. */
              <span className="line-clamp-1 block" title={tournament.description}>
                {tournament.description}
              </span>
            ) : undefined
          }
          actions={
            <>
              {registerButton}
              {showDraftLink ? (
                <Link
                  href={`/draft/${tournament.slug}`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
                >
                  {t("common.draft")}
                  <ExternalLink className="size-3.5" aria-hidden />
                </Link>
              ) : null}
              <TournamentLinkChips links={tournament.links} />
            </>
          }
        />
      </div>

      <TournamentSectionNav
        tournamentId={tournament.slug}
        status={tournament.status}
        stages={stages}
        hasTeams={teamsCount > 0}
        hasStreams={(streams?.official.length ?? 0) > 0 || (streams?.participants.length ?? 0) > 0}
        collapsed={heroScrolledPast}
        collapsedTitle={<span title={tournament.name}>{tournament.name}</span>}
        collapsedActions={
          <>
            {nextPhaseChip}
            {registerButton}
          </>
        }
      />

      <section className="min-w-0">
        <TournamentRouteProvider value={{ tournamentId: tournament.id, slug: tournament.slug }}>
          {children}
        </TournamentRouteProvider>
      </section>

      {/* Fixed to the bottom-trailing corner, so it takes no room in this
          stack. Rendered LAST on purpose: a complementary panel that a
          keyboard user reaches after the section content, rather than two tab
          stops standing in front of every page. */}
      <TournamentBroadcastDock streams={streams} />
    </div>
  );
}
