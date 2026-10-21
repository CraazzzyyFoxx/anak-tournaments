"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ActivityFeed } from "@/components/admin/dashboard/ActivityFeed";
import { Backlog } from "@/components/admin/dashboard/Backlog";
import { BlockError } from "@/components/admin/dashboard/Block";
import { DashboardRealtime } from "@/components/admin/dashboard/DashboardRealtime";
import { PhaseCards, PhaseCardsSkeleton } from "@/components/admin/dashboard/PhaseCards";
import { PlatformHealth } from "@/components/admin/dashboard/PlatformHealth";
import { Timeline } from "@/components/admin/dashboard/Timeline";
import { Trends } from "@/components/admin/dashboard/Trends";
import { WorkQueue } from "@/components/admin/dashboard/WorkQueue";
import { gameFilterDefs } from "@/components/admin/game-filter";
import { EmptyNote } from "@/components/kit/EmptyNote";
import { FilterBar } from "@/components/kit/FilterBar";
import { useFilters } from "@/components/kit/useFilters";
import { Button } from "@/components/ui/button";
import { useAuthProfile } from "@/hooks/useAuthProfile";
import { useCurrentWorkspaceId } from "@/hooks/useCurrentWorkspace";
import { useGameScope } from "@/hooks/useGameScope";
import { usePermissions, type AppPermission } from "@/hooks/usePermissions";
import { adminQueryKeys } from "@/lib/admin/query-keys";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";

/** `GET /api/v1/admin/dashboard` answers anyone holding one of these in the workspace. */
const DASHBOARD_PERMISSIONS: AppPermission[] = [
  "tournament.read",
  "team.read",
  "match.read",
  "user.read",
  "achievement.read"
];

/**
 * The organizer's home: one card per tournament in a live phase, what the next
 * seven days hold, what to do now, what the staff did, and how the last
 * tournaments went. Every block loads, fails and hides on its own; a block the
 * reader's role cannot see is absent, never zero.
 */
export default function AdminDashboard() {
  const t = useTranslations("adminShell.dashboard");
  const tGame = useTranslations("common.discipline");
  const { canAccessPermission, isSuperuser } = usePermissions();
  const workspaceId = useCurrentWorkspaceId();
  const { user } = useAuthProfile();
  const hour = new Date().getHours();
  const greetingPeriod = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

  // `?discipline=` as on the other multi pages. The chip exists only over two
  // or more enabled games; without it every game's tournaments are shown.
  const scope = useGameScope({ pageClass: "multi", axis: workspaceId ?? "all" });
  const gameDefs = gameFilterDefs(scope.games, tGame("column"), undefined, tGame("all"));
  const filters = useFilters(gameDefs);
  const game = gameDefs.length > 0 ? scope.game : null;

  const canReadDashboard = DASHBOARD_PERMISSIONS.some((permission) => canAccessPermission(permission, workspaceId));
  const canReadTournaments = canAccessPermission("tournament.read", workspaceId);
  const canReadAudit = canAccessPermission("audit.read", workspaceId);
  const canCreateTournaments = canAccessPermission("tournament.create", workspaceId);

  const dashboardQuery = useQuery({
    queryKey: adminQueryKeys.dashboard(workspaceId),
    queryFn: () => adminService.getDashboard(),
    enabled: workspaceId != null && canReadDashboard
  });

  const createButton = (
    <Button asChild size="sm">
      <Link href="/admin/tournaments?create=1">
        <Plus className="size-3.5" aria-hidden />
        {t("createTournament")}
      </Link>
    </Button>
  );
  // The breadcrumb already names the page, so the h1 stays in the outline only
  // and the visible line is the greeting.
  const header = (
    <AdminPageHeader
      title={t("dashboardTitle")}
      titleHidden
      description={t("greeting", { period: greetingPeriod, username: user?.username ?? t("defaultAdmin") })}
      actions={workspaceId != null && canCreateTournaments ? createButton : null}
    />
  );

  // "All workspaces": nothing here is workspace-wide except platform health.
  if (workspaceId == null) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <EmptyNote className="text-center">{t("pickWorkspace")}</EmptyNote>
        {isSuperuser ? <PlatformHealth workspaceId={null} /> : null}
      </div>
    );
  }

  const data = dashboardQuery.data;
  // A failed background refetch keeps the last good data on screen.
  const failed = dashboardQuery.isError && data === undefined;
  const retry = () => void dashboardQuery.refetch();
  // The game filter is client-side: the dashboard is small and already whole.
  const cards = data && (game === null ? data.tournaments : data.tournaments.filter((card) => card.discipline === game));
  // Timeline and queue rows carry their tournament's game and hidden flag through its card.
  const cardOf = new Map(data?.tournaments.map((card) => [card.id, card] as const));
  const issues = data?.issues.filter((issue) => game === null || cardOf.get(issue.tournament_id)?.discipline === game);
  // `null` is no `tournament.read`: the block is absent, not loading.
  const timelineHidden = data?.timeline === null;
  const timeline = data?.timeline?.filter(
    (event) => game === null || cardOf.get(event.tournament_id)?.discipline === game
  );
  const betweenTournaments = data?.tournaments.length === 0;
  // In the live phase the queue is what an organizer opens the page for.
  const liveFirst = cards?.some((card) => card.phase === "live") ?? false;
  // No queue between tournaments: the left column then takes the full width.
  const showQueue = canReadDashboard && !betweenTournaments;

  return (
    <div className="flex flex-col gap-4">
      {header}
      {gameDefs.length > 0 ? <FilterBar defs={gameDefs} filters={filters} /> : null}
      {!canReadDashboard && !canReadAudit && !isSuperuser ? <EmptyNote>{t("noAccess")}</EmptyNote> : null}
      {canReadDashboard ? (
        <DashboardRealtime workspaceId={workspaceId} tournamentIds={data?.tournaments.map((card) => card.id) ?? []} />
      ) : null}

      {/* One column below `xl`. The left-column wrapper is `contents` there, so
          its blocks are siblings of the cards and `order` can lift the queue.
          `minmax(0, …)`: a bare `fr` track grows to its widest child's min-content
          (the timeline strip), pushing the right column off-screen. */}
      <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] xl:items-start">
        {canReadDashboard ? (
          <div className="xl:col-span-2">
            {failed ? (
              <BlockError title={t("cardsTitle")} onRetry={retry} />
            ) : !cards ? (
              <PhaseCardsSkeleton />
            ) : betweenTournaments ? (
              // The header already carries "Create tournament": one CTA per intent.
              <EmptyNote title={t("betweenTitle")}>{t("betweenBody")}</EmptyNote>
            ) : cards.length === 0 ? (
              <EmptyNote>{t("noCardsForGame")}</EmptyNote>
            ) : (
              <PhaseCards cards={cards} />
            )}
          </div>
        ) : null}

        {/* The queue comes first in the DOM, so below `xl` it follows the cards;
            at `xl` it is pinned to the right column of the second row. */}
        {showQueue ? (
          <WorkQueue
            issues={issues}
            cardOf={cardOf}
            failed={failed}
            onRetry={retry}
            className={cn("xl:col-start-2 xl:row-start-2", liveFirst && "max-md:order-first")}
          />
        ) : null}

        <div
          className={cn(
            "contents xl:col-start-1 xl:row-start-2 xl:flex xl:flex-col xl:gap-4",
            !showQueue && "xl:col-span-2"
          )}
        >
          {canReadTournaments && !timelineHidden && !betweenTournaments ? (
            <Timeline events={timeline} cardOf={cardOf} failed={failed} onRetry={retry} />
          ) : null}
          {canReadTournaments ? <Trends workspaceId={workspaceId} discipline={game} /> : null}
          {canReadAudit ? <ActivityFeed workspaceId={workspaceId} /> : null}
        </div>

        {canReadDashboard ? (
          <Backlog backlog={data?.backlog} game={game} failed={failed} onRetry={retry} className="xl:col-span-2" />
        ) : null}
        {isSuperuser ? <PlatformHealth workspaceId={workspaceId} className="xl:col-span-2" /> : null}
      </div>
    </div>
  );
}
