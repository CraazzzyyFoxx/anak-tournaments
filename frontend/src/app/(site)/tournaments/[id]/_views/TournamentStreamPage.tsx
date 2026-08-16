"use client";

import { useTranslations } from "next-intl";

import { StreamCard } from "@/components/stream/StreamCard";

import { TournamentPageState } from "../_components/TournamentPageState";
import { TournamentStreamSkeleton } from "../_components/TournamentSkeletons";
import { UpdatingBadge } from "../_components/UpdatingBadge";
import { useTournamentStreamsQuery } from "../_hooks/useTournamentStreams";
import styles from "../TournamentDetail.module.css";
import { getPublicPageQueryPresentation } from "./publicPageQueryPresentation";

/**
 * Who is streaming this tournament right now, one card per channel.
 *
 * The official broadcast is deliberately NOT repeated here: it lives in
 * `TournamentBroadcastBlock`, above the section nav, on every section of the
 * page. So this list is exactly the participants, and it is exactly the ones the
 * poller reports live — the backend never sends an offline participant.
 *
 * ## Freshness
 *
 * There is no `useTournamentStreamRealtime` call in this view on purpose.
 * `TournamentClientLayout` — the ancestor of every tournament section — already
 * subscribes to `tournament:{id}:streams` for the broadcast block and the nav
 * gate, and its refetch invalidates `tournamentQueryKeys.streams(id)`, which is
 * the very key this view reads. A second subscription here would add a second
 * jittered coalescer racing to invalidate the same key, i.e. a duplicate of a
 * mechanism that already covers this page. Keep the single owner.
 */
const TournamentStreamPage = ({ tournamentId }: { tournamentId: number }) => {
  const t = useTranslations();
  const streamsQuery = useTournamentStreamsQuery(tournamentId);
  const participants = streamsQuery.data?.participants ?? [];

  // The same loading / empty / updating / refresh-error vocabulary every other
  // public tournament section speaks.
  const presentation = getPublicPageQueryPresentation({
    data: streamsQuery.data,
    itemCount: participants.length,
    isPending: streamsQuery.isPending,
    isError: streamsQuery.isError,
    isFetching: streamsQuery.isFetching
  });

  if (presentation.initialState === "error") {
    return (
      <TournamentPageState state="initial-error" onRetry={() => void streamsQuery.refetch()} />
    );
  }

  if (presentation.initialState === "skeleton" || presentation.contentState === null) {
    return <TournamentStreamSkeleton />;
  }

  const content = (
    <section className={styles.publicDataPage} aria-label={t("common.stream")}>
      {presentation.showUpdating ? <UpdatingBadge /> : null}

      {presentation.contentState === "empty" ? (
        // "Nobody live" is a true, frequent, and temporary state, so it gets its
        // own copy rather than the generic "the organizer has not published this
        // yet" — nothing here is waiting on the organizer.
        <TournamentPageState
          state="empty"
          title={t("stream.page.emptyTitle")}
          description={t("stream.page.emptyDescription")}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {participants.map((entry) => (
            // Platform + channel is what the poller dedupes on, so it is unique
            // per entry and stable across refetches — unlike the array index,
            // which would remount every card whenever a channel goes offline.
            <StreamCard key={`${entry.platform}:${entry.channel}`} entry={entry} />
          ))}
        </div>
      )}
    </section>
  );

  if (presentation.showRefreshError) {
    return (
      <TournamentPageState
        state="refresh-error"
        onRetry={() => void streamsQuery.refetch()}
        isUpdating={streamsQuery.isFetching}
      >
        {content}
      </TournamentPageState>
    );
  }

  return content;
};

export default TournamentStreamPage;
