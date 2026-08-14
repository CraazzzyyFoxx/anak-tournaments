"use client";

import { useSyncExternalStore } from "react";
import { CalendarClock } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { getTournamentStatusMeta } from "@/lib/tournament-status";
import { cn } from "@/lib/utils";
import type { Tournament } from "@/types/tournament.types";

import { TournamentPageState } from "../_components/TournamentPageState";
import { TournamentScheduleSkeleton } from "../_components/TournamentSkeletons";
import { useTournamentQuery } from "../_hooks/useTournamentClientData";
import styles from "../TournamentDetail.module.css";
import { buildTournamentSchedule, type PhaseSegment } from "./tournamentSchedule.model";

/**
 * Phase boundaries are minutes-scale, so ticking a coarse grid keeps every
 * displayed minute honest. The grid also makes the store's snapshot stable
 * between notifications, which is what `useSyncExternalStore` requires.
 */
const TICK_MS = 30_000;

/**
 * The viewer's wall clock, quantized to `TICK_MS`. It is external state, so it
 * is read as such rather than cascaded in from an effect — the same reasoning
 * `EncountersTable` documents for its hydration flag.
 */
const clock = {
  subscribe(onChange: () => void) {
    const id = window.setInterval(onChange, TICK_MS);
    return () => window.clearInterval(id);
  },
  now: () => Math.floor(Date.now() / TICK_MS) * TICK_MS,
  /**
   * `null` on the server AND during hydration, which React uses this snapshot
   * for. The page renders its skeleton until a real clock arrives: every stamp
   * here is the viewer's own local time, and there is no honest way to render
   * one before knowing which zone that is.
   */
  none: () => null
};

const STAMP = {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short"
} as const;

const TournamentScheduleView = ({ tournament }: { tournament: Tournament }) => {
  const t = useTranslations();
  const format = useFormatter();

  const now = useSyncExternalStore(clock.subscribe, clock.now, clock.none);

  // Server render and hydration render share this branch, so they cannot
  // disagree about an instant neither of them has.
  if (now === null) return <TournamentScheduleSkeleton />;

  const { segments, automationOff } = buildTournamentSchedule({ tournament, now });

  /**
   * next-intl resolves its default zone on the SERVER — the deployment's, UTC in
   * the container — and `NextIntlClientProvider` inherits that value, so the
   * formatter's own default quotes every time in a clock no viewer lives in.
   * These stamps are the viewer's local time, so the zone is named explicitly.
   * Reading the browser is safe here: nothing renders before hydration (see
   * `clock.none`).
   */
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const stamp = (iso: string) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return format.dateTime(date, { ...STAMP, timeZone });
  };

  const countdown = (segment: PhaseSegment) => {
    if (segment.countdownMs === null || segment.countdownTo === null) return null;
    const relative = format.relativeTime(new Date(now + segment.countdownMs), now);
    return segment.countdownTo === "close"
      ? t("tournamentDetail.publicPages.schedule.closesRelative", { relative })
      : t("tournamentDetail.publicPages.schedule.startsRelative", { relative });
  };

  if (segments.length === 0) {
    return (
      <section className={styles.publicDataPage} aria-label={t("common.schedule")}>
        <TournamentPageState
          state="empty"
          title={t("tournamentDetail.publicPages.schedule.emptyTitle")}
          description={t("tournamentDetail.publicPages.schedule.emptyDescription")}
        />
      </section>
    );
  }

  const hasWindow = segments.some((segment) => segment.endsAt !== null);

  return (
    <section className={styles.publicDataPage} aria-label={t("common.schedule")}>
      <div className="aqt-card-surface">
        <div className="aqt-card-head">
          <h2 className="aqt-card-title">
            <span className="aqt-card-title-ic">
              <CalendarClock className="size-4" aria-hidden />
            </span>
            {t("tournamentDetail.publicPages.schedule.title")}
          </h2>
        </div>

        <div className="aqt-card-body">
          <ol>
            {segments.map((segment, index) => {
              const meta = getTournamentStatusMeta(segment.status);
              const isLast = index === segments.length - 1;
              const startText = stamp(segment.startsAt);
              const endText = segment.endsAt === null ? null : stamp(segment.endsAt);
              const countdownText = countdown(segment);

              return (
                <li
                  key={segment.status}
                  aria-current={segment.state === "current" ? "step" : undefined}
                  className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3"
                >
                  <div className="flex flex-col items-center pt-1.5">
                    <span
                      aria-hidden
                      className={cn(
                        "size-2.5 shrink-0 rounded-full",
                        segment.state === "upcoming"
                          ? "border border-[color:var(--aqt-border)]"
                          : segment.state === "done"
                            ? "bg-[color:var(--aqt-fg-faint)]"
                            : meta.dotClassName
                      )}
                    />
                    {isLast ? null : (
                      <span aria-hidden className="mt-1 w-px flex-1 bg-[color:var(--aqt-border)]" />
                    )}
                  </div>

                  <div className={cn("min-w-0", isLast ? "pb-0" : "pb-5")}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={cn(
                          "text-sm font-semibold",
                          segment.state === "upcoming"
                            ? "text-[color:var(--aqt-fg-dim)]"
                            : meta.textClassName
                        )}
                      >
                        {t(`common.statusBadge.${segment.status}`)}
                      </span>
                      {segment.state === "done" ? (
                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--aqt-fg-faint)]">
                          {t("tournamentDetail.publicPages.schedule.state.done")}
                        </span>
                      ) : null}
                      {segment.state === "current" ? (
                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--aqt-teal)]">
                          {t("tournamentDetail.publicPages.schedule.state.current")}
                        </span>
                      ) : null}
                      {countdownText === null ? null : (
                        <span className="aqt-tnum text-xs text-[color:var(--aqt-teal)]">
                          {countdownText}
                        </span>
                      )}
                    </div>

                    <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-0.5 text-xs">
                      {startText === null ? null : (
                        <div className="flex items-baseline gap-1.5">
                          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--aqt-fg-faint)]">
                            {t("tournamentDetail.publicPages.schedule.startsLabel")}
                          </dt>
                          <dd className="aqt-tnum text-[color:var(--aqt-fg-muted)]">
                            <time dateTime={segment.startsAt}>{startText}</time>
                          </dd>
                        </div>
                      )}
                      {endText === null ? null : (
                        <div className="flex items-baseline gap-1.5">
                          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--aqt-fg-faint)]">
                            {t("tournamentDetail.publicPages.schedule.closesLabel")}
                          </dt>
                          <dd className="aqt-tnum text-[color:var(--aqt-fg-muted)]">
                            <time dateTime={segment.endsAt ?? undefined}>{endText}</time>
                          </dd>
                        </div>
                      )}
                    </dl>

                    {segment.progress === null ? null : (
                      <div
                        aria-hidden
                        className="mt-2 h-1 w-full max-w-56 overflow-hidden rounded-full bg-[color:var(--aqt-border)]"
                      >
                        <div
                          className="h-full rounded-full bg-[color:var(--aqt-teal)]"
                          style={{ width: `${Math.round(segment.progress * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          {hasWindow || automationOff ? (
            <div className="mt-4 space-y-1 border-t border-[color:var(--aqt-border)] pt-3 text-xs text-[color:var(--aqt-fg-dim)]">
              {hasWindow ? (
                <p className="max-w-[68ch] text-pretty">
                  {t("tournamentDetail.publicPages.schedule.windowHint")}
                </p>
              ) : null}
              {automationOff ? (
                <p className="max-w-[68ch] text-pretty">
                  {t("tournamentDetail.publicPages.schedule.manualHint")}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
};

/**
 * Resolves the shared tournament overview so the route file stays a one-line
 * delegation, matching every other tournament sub-route. The overview is already
 * primed by the layout and carries `phase_schedule`, so this page needs no query
 * of its own — the guards below only fire if that layout contract ever changes.
 */
const TournamentSchedulePage = ({ tournamentId }: { tournamentId: number }) => {
  const tournamentQuery = useTournamentQuery(tournamentId);

  if (!tournamentQuery.data) {
    if (tournamentQuery.isError) {
      return (
        <TournamentPageState state="initial-error" onRetry={() => void tournamentQuery.refetch()} />
      );
    }
    return <TournamentScheduleSkeleton />;
  }

  return <TournamentScheduleView tournament={tournamentQuery.data} />;
};

export default TournamentSchedulePage;
