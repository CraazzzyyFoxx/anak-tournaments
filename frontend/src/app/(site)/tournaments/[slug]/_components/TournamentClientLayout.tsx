"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";

import TournamentBroadcastDock from "./TournamentBroadcastDock";
import { TOURNAMENT_ACTION_CLASS } from "./tournamentActionClass";
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
import type { Tournament } from "@/types/tournament.types";

import { useTranslations, useLocale } from "next-intl";
import TournamentSectionNav from "./TournamentSectionNav";
import { TournamentShellSkeleton } from "./TournamentSkeletons";
import TournamentShellError from "../TournamentShellError";
import { PageHero, HeroCoord } from "@/components/site/PageHero";
import { PageStateCard } from "@/components/ui/page-state-card";

type TournamentClientLayoutProps = {
  slug: string;
  children: React.ReactNode;
};

/**
 * The one "players" figure every surface of the page quotes. Registrations
 * count while the field is still forming; once teams exist (`participants_count`
 * is only populated then) the rostered players are the tournament's players —
 * the header and the overview's numbers must not disagree by the withdrawn.
 */
export function tournamentPlayersCount(
  tournament: Pick<Tournament, "participants_count" | "registrations_count" | "teams_count">
): number {
  const rostered = tournament.participants_count ?? 0;
  return (tournament.teams_count ?? 0) > 0 && rostered > 0
    ? rostered
    : (tournament.registrations_count ?? 0);
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
  const players = tournamentPlayersCount(tournament);

  const isEnded = isTournamentStatusEnded(tournament.status);
  const statusVariant = getTournamentStatusMeta(tournament.status).variant;
  const isLive = statusVariant === "live";
  const overviewHref = `/tournaments/${tournament.slug}`;
  // The draft room is an external route, so it cannot be a rail tab. It appears
  // once registration is over — before that there is no room to open.
  const showDraftLink =
    tournament.team_formation === "draft" && tournament.status !== "registration";

  // The draft room is an external route, so it cannot be a rail tab; it stands
  // in the action row as its own button (wireframes §2 ④). Team formation used
  // to carry this link as a pill, because the row then held nothing else for an
  // ended tournament — with the organizer's links moved into the overview that
  // trade is gone, and the formation itself reads in the Format card, beside the
  // roster shape a pill could not show.
  const draftButton = showDraftLink ? (
    <Link href={`/draft/${tournament.slug}`} className={TOURNAMENT_ACTION_CLASS}>
      {t("common.draft")}
      <ExternalLink className="size-3.5 opacity-80" aria-hidden />
    </Link>
  ) : null;

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
          compact
          /* The organizer's banner, when there is one. Absent — the common case
             — the frame renders exactly what it rendered before: teal hairline,
             masked grid, one glow. Nothing is reserved for a missing image. */
          coverUrl={tournament.cover_image_url}
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
          title={
            <span className="flex items-center gap-3">
              {tournament.logo_url ? (
                /* Plain `<img>`, like every other S3 image on the site: the URL
                   points at whatever host the deployment configured, and
                   `next/image` hard-errors on a hostname missing from
                   `remotePatterns`. Decorative — the h1 beside it is the name. */
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={tournament.logo_url}
                  alt=""
                  aria-hidden
                  width={44}
                  height={44}
                  loading="lazy"
                  decoding="async"
                  className="size-11 shrink-0 rounded-md border border-[color:var(--aqt-border)] bg-[color:var(--aqt-bg)] object-cover"
                />
              ) : null}
              <span className="min-w-0">{tournament.name}</span>
            </span>
          }
          meta={
            <>
              {/* The status pill keeps the site-wide status colours (the same
                  ones the tournaments list uses), so a reader coming from the
                  list meets the same signal here. */}
              <span className={cn("status-pill", statusVariant)}>
                {isLive && <span className="dot" />}
                {t(`common.statusBadge.${tournament.status}`)}
              </span>
              {nextPhaseChip}
              {tournament.is_league && <span className="meta-pill">{t("common.league")}</span>}
              <span className="meta-pill aqt-tnum">
                {teamsCount > 0
                  ? t("tournamentDetail.header.teamsAndPlayers", { teams: teamsCount, players })
                  : t("tournamentDetail.header.players", { players })}
              </span>
            </>
          }
          /* Right-hand action column (wireframes §2 ④): what a reader can DO,
             across from the title. The organizer's informational links are NOT
             here — they are reference material, and they live in the overview's
             Links card, where a translucent chip is not sitting on artwork.
             `empty:hidden` because an ended tournament without a draft room
             renders nothing at all in this column. */
          aside={
            <div className="flex flex-wrap items-center gap-2.5 empty:hidden lg:justify-end">
              {registerButton}
              {draftButton}
            </div>
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
