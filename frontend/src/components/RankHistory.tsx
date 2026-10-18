"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Link2Off, Radar } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { ChartEmptyState, RankHistorySkeleton } from "@/components/RankHistoryState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DisciplineWidget } from "@/disciplines/DisciplineWidget";
import { useCurrentWorkspaceId } from "@/hooks/useCurrentWorkspace";
import { useNativeRankCollector } from "@/hooks/useNativeRankCollector";
import { userQueryKeys } from "@/lib/users/query-keys";
import userService from "@/services/user.service";

/**
 * The player is identified by exactly one of these. `userId` is the cheap path;
 * `battleTag` costs a lookup, so callers that already hold the id pass that
 * instead. Either may be nullish — that renders the "no linked profile" state.
 */
type RankHistoryTarget =
  | { userId: number | null | undefined; battleTag?: never }
  | { battleTag: string | null | undefined; userId?: never };

type RankHistoryProps = RankHistoryTarget & {
  /**
   * The owning game (tournament, mix, draft, registration…). Without one the concrete browsing game is
   * used. Either way the game is resolved first and only then checked for rank collection: a game that
   * does not collect ranks gets the unsupported state, never another game's history.
   */
  discipline?: string | null;
  /** When set, the chart is wrapped in a titled card; otherwise it renders bare. */
  title?: string;
  className?: string;
};

/**
 * Rank history for one player: resolves the player and the game, gates on the discipline's native-rank
 * collection capability and hands the drawing to that game's `rankHistory` module slot. Used on the player
 * profile, the admin rank console, the registration review and the balancer player sheet.
 */
export default function RankHistory({
  userId,
  battleTag,
  discipline,
  title,
  className
}: Readonly<RankHistoryProps>) {
  const t = useTranslations();
  const axis = useCurrentWorkspaceId() ?? "all";
  const collector = useNativeRankCollector(axis, discipline);

  const resolve = useQuery({
    queryKey: userQueryKeys.rankResolve(battleTag),
    queryFn: async () => {
      if (!battleTag) return null;
      const user = await userService.getUserByName(battleTag).catch(() => null);
      return user?.id ?? null;
    },
    staleTime: 5 * 60_000,
    enabled: Boolean(battleTag)
  });
  const resolvedUserId = battleTag === undefined ? (userId ?? null) : (resolve.data ?? null);

  // `title` owns the card chrome, so the caller's className lands on the Card
  // there and on the bare content otherwise.
  const contentClassName = title == null ? className : undefined;
  const descriptor = collector.descriptor;

  let content: ReactNode;
  if (resolve.isLoading || collector.isLoading) {
    content = <RankHistorySkeleton className={contentClassName} />;
  } else if (resolvedUserId == null) {
    content = (
      <ChartEmptyState
        className={contentClassName}
        icon={Link2Off}
        title={t("rankHistory.noProfileTitle")}
        body={t("rankHistory.noProfileBody")}
      />
    );
  } else if (collector.isError) {
    content = (
      <ChartEmptyState
        className={contentClassName}
        icon={AlertCircle}
        tone="error"
        title={t("rankHistory.errorTitle")}
        body={t("rankHistory.errorBody")}
      />
    );
  } else if (!descriptor || !collector.supported) {
    content = (
      <ChartEmptyState
        className={contentClassName}
        icon={Radar}
        title={t("rankHistory.unsupportedTitle")}
        body={t("rankHistory.unsupportedBody")}
      />
    );
  } else {
    content = (
      <div className={contentClassName}>
        <DisciplineWidget
          discipline={descriptor.code}
          slot="rankHistory"
          capabilities={descriptor.capabilities}
          requires="native_rank_collection"
          props={{ userId: resolvedUserId, axis }}
          fallback={null}
        />
      </div>
    );
  }

  if (title == null) return content;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}
