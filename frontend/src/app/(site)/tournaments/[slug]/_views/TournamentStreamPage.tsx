"use client";

import { Radio } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { ConnectionIndicator } from "@/components/realtime/ConnectionIndicator";
import { StreamRow } from "@/components/stream/StreamRow";
import { StreamTheater } from "@/components/stream/StreamTheater";
import { useMinuteClock } from "@/hooks/useMinuteClock";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import {
  embeddableTwitchChannel,
  sortStreamsByAudience,
  streamEntryKey
} from "@/lib/stream-platform";
import { useRealtimeStore } from "@/stores/realtime.store";

import { TournamentPageState } from "../_components/TournamentPageState";
import { TournamentStreamSkeleton } from "../_components/TournamentSkeletons";
import { UpdatingBadge } from "../_components/UpdatingBadge";
import { useTournamentStreamsQuery } from "../_hooks/useTournamentStreams";
import styles from "../TournamentDetail.module.css";
import { getPublicPageQueryPresentation } from "./publicPageQueryPresentation";

/**
 * Who is streaming this tournament right now — and a player to watch them in.
 *
 * The official broadcast is deliberately NOT repeated here: it lives in
 * `TournamentBroadcastDock`, floating in the bottom-trailing corner of every
 * section of the page. So this list is exactly the participants, and it is
 * exactly the ones the poller reports live — the backend never sends an
 * offline participant.
 *
 * ## Theater, not a grid
 *
 * This page used to be a grid of thumbnail cards that all linked out to
 * twitch.tv: a page called "Streams" on which nothing could be watched. Every
 * participant entry is a live Twitch channel, so one of them now fills a player
 * and the rest are a rail that switches it. See `StreamTheater` for why exactly
 * one frame is mounted and `StreamRow` for why the rail is rows.
 *
 * ## Which one is in the frame, and when it starts
 *
 * Selection is DERIVED (`selectedKey` is only a preference), so a refetch that
 * drops the selected channel silently falls back to the busiest one instead of
 * leaving a dead frame — and `sortStreamsByAudience` is a total order, so the
 * fallback resolves to the same entry tick after tick rather than restarting
 * the iframe.
 *
 * The frame mounts on load only when the tournament has NO official broadcast.
 * With one, the shell's dock may already be playing in the corner of every tab,
 * and a second autoplaying player would be two streams on one screen; the
 * viewer opts in with the poster button instead. Once they have, switching
 * channels keeps playing — hence `hasStartedWatching` lives here and not in the
 * theater. Deliberately keyed on the broadcast EXISTING rather than on whether
 * the dock is currently open: reaching across for that would couple this view
 * to another component's local state to save one click.
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
  const connectionState = useRealtimeStore((s) => s.connectionState);
  const streamsQuery = useTournamentStreamsQuery(tournamentId);
  const participants = streamsQuery.data?.participants ?? [];
  const hasOfficialBroadcast = (streamsQuery.data?.official.length ?? 0) > 0;

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hasStartedWatching, setHasStartedWatching] = useState(false);
  // One clock for the whole page, so every uptime on screen is measured from
  // the same instant, and `null` until hydration so no server-side duration is
  // baked into the HTML.
  const now = useMinuteClock();
  // A frame that starts moving on its own is exactly what this preference asks
  // us not to do, and it is a decision CSS cannot make — `globals.css` can
  // flatten a transition but not decline to mount a player. The poster and its
  // button stay, so nothing is taken away; the viewer just asks first.
  const prefersReducedMotion = usePrefersReducedMotion();

  const sorted = useMemo(() => sortStreamsByAudience(participants), [participants]);
  const featured =
    sorted.find((entry) => streamEntryKey(entry) === selectedKey) ??
    sorted.find((entry) => embeddableTwitchChannel(entry) !== null) ??
    sorted[0] ??
    null;

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

  const totalViewers = sorted.reduce((sum, entry) => sum + (entry.viewer_count ?? 0), 0);

  const content = (
    <section className={styles.publicDataPage} aria-label={t("common.stream")}>
      {presentation.showUpdating ? <UpdatingBadge /> : null}

      {presentation.contentState === "empty" || !featured ? (
        // "Nobody live" is a true, frequent, and temporary state, so it gets its
        // own copy rather than the generic "the organizer has not published this
        // yet" — nothing here is waiting on the organizer.
        <TournamentPageState
          state="empty"
          title={t("stream.page.emptyTitle")}
          description={t("stream.page.emptyDescription")}
        />
      ) : (
        <div className="aqt-card-surface">
          {/* The section had no heading at all before — only an `aria-label` on
              the <section> — so the document went from the hero's <h1> straight
              to a card <h3>. This is the missing <h2>, in the same
              `.aqt-card-*` vocabulary the rest of the site's cards use. */}
          <div className="aqt-card-head">
            <h2 className="aqt-card-title">
              <span className="aqt-card-title-ic">
                <Radio className="size-4" aria-hidden />
              </span>
              {t("common.stream")}
            </h2>
            <span className="flex shrink-0 items-center gap-2.5">
              <span className="status-pill live">
                <span aria-hidden className="dot" />
                {t("stream.page.liveCount", { count: sorted.length })}
              </span>
              {totalViewers > 0 ? (
                <span className="aqt-mono text-[12px] tabular-nums text-[color:var(--aqt-fg-muted)]">
                  {t("stream.card.watching", { count: totalViewers })}
                </span>
              ) : null}
              <ConnectionIndicator connectionState={connectionState} />
            </span>
          </div>

          <div className="aqt-card-body aqt-flush">
            <div className="grid xl:grid-cols-[minmax(0,1fr)_368px]">
              <StreamTheater
                entry={featured}
                isPlaying={(!hasOfficialBroadcast && !prefersReducedMotion) || hasStartedWatching}
                onPlay={() => setHasStartedWatching(true)}
                now={now}
              />

              {/* Capped rather than free-running: the rail must not grow taller
                  than the player it belongs to, or the switcher scrolls the
                  page away from the thing it is switching. */}
              <ul
                aria-label={t("stream.page.channels")}
                className="m-0 grid list-none grid-cols-1 content-start gap-2 border-t border-[color:var(--aqt-border)] p-3 md:grid-cols-2 xl:max-h-[72vh] xl:grid-cols-1 xl:overflow-y-auto xl:border-t-0 xl:border-s"
              >
                {sorted.map((entry) => {
                  const key = streamEntryKey(entry);
                  const canEmbed = embeddableTwitchChannel(entry) !== null;
                  return (
                    <li key={key} className="min-w-0">
                      <StreamRow
                        entry={entry}
                        isSelected={key === streamEntryKey(featured)}
                        now={now}
                        onSelect={
                          canEmbed
                            ? () => {
                                setSelectedKey(key);
                                setHasStartedWatching(true);
                              }
                            : null
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
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
