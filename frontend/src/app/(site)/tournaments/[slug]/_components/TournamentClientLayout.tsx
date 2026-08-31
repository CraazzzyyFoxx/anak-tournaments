"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import TournamentBroadcastDock from "./TournamentBroadcastDock";
import TournamentLinkChips from "./TournamentLinkChips";
import TournamentRegisterButton from "./TournamentRegisterButton";
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
import { PageHero, HeroCoord, HeroStat } from "@/components/site/PageHero";
import { PageStateCard } from "@/components/ui/page-state-card";

type TournamentClientLayoutProps = {
  slug: string;
  children: React.ReactNode;
};

type Translate = ReturnType<typeof useTranslations<never>>;

function formatLabel(stages: StageSummary[], t: Translate): string {
  const hasGroup = stages.some((s) => s.stage_type === "round_robin" || s.stage_type === "swiss");
  const hasElim = stages.some(
    (s) => s.stage_type === "single_elimination" || s.stage_type === "double_elimination"
  );
  if (hasGroup && hasElim) return t("common.formatLabel.groupsPlayoff");
  if (hasElim) return t("common.formatLabel.playoffBracket");
  if (hasGroup) return t("common.formatLabel.groupStage");
  return stages[0]?.stage_type?.replace(/_/g, " ") ?? "—";
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

  const statusVariant = getTournamentStatusMeta(tournament.status).variant;
  const isEnded = isTournamentStatusEnded(tournament.status);
  const players = tournament.participants_count ?? 0;
  const completedStages = stages.filter((stage) => stage.is_completed).length;

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
      <PageHero
        eyebrow={
          <HeroCoord className="inline-flex flex-wrap items-center gap-2">
            <Link
              href="/tournaments"
              className="transition-colors hover:text-[color:var(--aqt-teal)]"
            >
              {t("common.tournaments")}
            </Link>
            <span className="opacity-50">/</span>
            {tournament.is_league && (
              <>
                <span>{t("common.league")}</span>
                <span className="opacity-50">·</span>
              </>
            )}
            <span>{formatDateRange(tournament.start_date, tournament.end_date, locale)}</span>
          </HeroCoord>
        }
        title={tournament.name}
        meta={
          <>
            <span className={cn("status-pill", statusVariant)}>
              {(tournament.status === "live" || tournament.status === "playoffs") && (
                <span className="dot" />
              )}
              {t(`common.statusBadge.${tournament.status}`)}
            </span>
            <span className="meta-pill">
              <span className="k">{t("common.format")}</span>
              <span className="v">{formatLabel(stages, t)}</span>
            </span>
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
          </>
        }
        lede={tournament.description || undefined}
        actions={
          /* Discord, the rules doc, an external bracket and the VODs sit in the
             hero's own action row rather than in a strip between the hero and the
             nav, where they read as an orphaned line of chrome. Both slots share
             one flex row, so the chips wrap under the buttons on a phone and the
             row collapses to whichever of the two exists. */
          <>
            {!isEnded && <TournamentRegisterButton tournament={tournament} />}
            <TournamentLinkChips links={tournament.links} />
          </>
        }
        aside={
          <div className="grid grid-cols-2 gap-x-7 gap-y-5 xl:grid-cols-4">
            <HeroStat label={t("common.teams")} value={teamsCount} sub={t("common.registered")} />
            <HeroStat
              label={t("common.participants")}
              value={tournament.registrations_count ?? 0}
              sub={t("common.players")}
            />
            <HeroStat label={t("common.rostered")} value={players} sub={t("common.inTeams")} />
            <HeroStat
              label={t("common.stages")}
              value={stages.length}
              sub={`${completedStages} ${t("common.done")}`}
            />
          </div>
        }
      />

      <TournamentSectionNav
        tournamentId={tournament.slug}
        status={tournament.status}
        stages={stages}
        teamFormation={tournament.team_formation}
        hasSchedule={(tournament.phase_schedule?.length ?? 0) > 0}
        hasTeams={teamsCount > 0}
        hasStreams={(streams?.official.length ?? 0) > 0 || (streams?.participants.length ?? 0) > 0}
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
