"use client";

import { useFormatter, useTranslations } from "next-intl";

import { useMinuteClock } from "@/hooks/useMinuteClock";
import { cn } from "@/lib/utils";
import type { Tournament } from "@/types/tournament.types";

import { buildTournamentSchedule, type PhaseSegment } from "../_views/tournamentSchedule.model";

export type PhaseTimelineProps = {
  tournament: Pick<
    Tournament,
    "status" | "team_formation" | "phase_schedule" | "auto_transitions_enabled"
  >;
  /**
   * `horizontal` — a stepper across the page, for the registration-phase
   * overview where the phases ARE the page. `vertical` — a compact side-column
   * list once play has started and the phases are context, not content.
   */
  orientation: "horizontal" | "vertical";
  /** Viewer clock override for deterministic tests; defaults to the minute clock. */
  now?: number;
  /** Anchor id, so the header chip can deep-link here. */
  id?: string;
  className?: string;
};

const STAMP = {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit"
} as const;

/**
 * The tournament's phase schedule as one timeline: done / current / upcoming.
 *
 * Replaces the standalone Schedule tab. Everything about WHICH phases appear
 * and which is current comes from `buildTournamentSchedule`; this component
 * only decides how to draw the same segments in two orientations. Times are the
 * viewer's local time — the zone is named explicitly because next-intl's
 * default zone is the server's.
 *
 * Teal marks exactly one thing: the phase happening now. A current phase whose
 * window has closed (registration over, check-in not yet open) is drawn in the
 * neutral scale with a "closed" tag — the countdown then sits on the next phase.
 */
export function PhaseTimeline({
  tournament,
  orientation,
  now: nowOverride,
  id,
  className
}: Readonly<PhaseTimelineProps>) {
  const t = useTranslations();
  const format = useFormatter();
  const clock = useMinuteClock();
  const now = nowOverride ?? clock;

  // Server render and hydration render share this branch, so they cannot
  // disagree about an instant neither of them has.
  if (now === null) return null;

  const { segments } = buildTournamentSchedule({ tournament, now });
  if (segments.length === 0) return null;

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zoneLabel = format.dateTime(new Date(now), { timeZoneName: "short", timeZone }).split(" ").pop();

  const stamp = (iso: string) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return format.dateTime(date, { ...STAMP, timeZone });
  };
  const clock24 = (iso: string) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return format.dateTime(date, { hour: "2-digit", minute: "2-digit", timeZone });
  };

  const countdown = (segment: PhaseSegment) => {
    if (segment.countdownMs === null || segment.countdownTo === null) return null;
    const relative = format.relativeTime(new Date(now + segment.countdownMs), now);
    return segment.countdownTo === "close"
      ? t("tournamentDetail.publicPages.schedule.closesRelative", { relative })
      : t("tournamentDetail.publicPages.schedule.startsRelative", { relative });
  };

  const isNow = (segment: PhaseSegment) => segment.state === "current" && !segment.windowClosed;
  const label = (segment: PhaseSegment) => (
    <>
      {t(`common.statusBadge.${segment.status}`)}
      {segment.windowClosed ? (
        <span className="ml-1.5 font-mono text-[10px] font-normal uppercase tracking-[0.08em] text-[color:var(--aqt-fg-faint)]">
          {t("tournamentDetail.publicPages.schedule.closed")}
        </span>
      ) : null}
    </>
  );

  if (orientation === "horizontal") {
    return (
      <div id={id} className={cn("scroll-mt-28", className)}>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="aqt-mono text-[11px] uppercase tracking-[0.06em] text-[color:var(--aqt-fg-faint)]">
            {t("tournamentDetail.publicPages.schedule.title")}
          </h2>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--aqt-fg-faint)]">
            {zoneLabel}
          </span>
        </div>
        <ol className="grid auto-cols-fr grid-flow-col gap-1 overflow-x-auto" aria-label={t("tournamentDetail.publicPages.schedule.title")}>
          {segments.map((segment) => {
            const now = isNow(segment);
            const startText = stamp(segment.startsAt);
            const endText = segment.endsAt === null ? null : clock24(segment.endsAt);
            const countdownText = countdown(segment);
            return (
              <li
                key={segment.status}
                aria-current={segment.state === "current" ? "step" : undefined}
                className={cn(
                  "relative min-w-[9rem] border-t-[3px] px-3 pb-2 pt-2.5",
                  now
                    ? "border-[color:var(--aqt-teal)] bg-[color:var(--aqt-overlay-1)]"
                    : segment.state === "upcoming"
                      ? "border-[color:var(--aqt-border)] text-[color:var(--aqt-fg-dim)]"
                      : "border-[color:var(--aqt-fg-faint)]"
                )}
              >
                {now ? (
                  <span
                    aria-hidden
                    className="absolute -top-[7px] left-3 size-[11px] rounded-full bg-[color:var(--aqt-teal)] ring-[3px] ring-[color:var(--aqt-bg)]"
                  />
                ) : null}
                <div className={cn("text-sm font-semibold", now && "text-[color:var(--aqt-teal)]")}>
                  {label(segment)}
                </div>
                <div className="aqt-tnum mt-0.5 font-mono text-[11px] text-[color:var(--aqt-fg-muted)]">
                  {startText ? <time dateTime={segment.startsAt}>{startText}</time> : null}
                  {endText ? <> – <time dateTime={segment.endsAt ?? undefined}>{endText}</time></> : null}
                </div>
                {countdownText ? (
                  <div className="aqt-tnum mt-0.5 text-xs text-[color:var(--aqt-teal)]">{countdownText}</div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  return (
    <div id={id} className={cn("scroll-mt-28", className)}>
      <ol aria-label={t("tournamentDetail.publicPages.schedule.title")}>
        {segments.map((segment, index) => {
          const now = isNow(segment);
          const isLast = index === segments.length - 1;
          const startText = stamp(segment.startsAt);
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
                    now
                      ? "bg-[color:var(--aqt-teal)] ring-[3px] ring-[color:var(--aqt-overlay-2)]"
                      : segment.state === "upcoming"
                        ? "border border-[color:var(--aqt-border)]"
                        : "bg-[color:var(--aqt-fg-faint)]"
                  )}
                />
                {isLast ? null : (
                  <span aria-hidden className="mt-1 w-px flex-1 bg-[color:var(--aqt-border)]" />
                )}
              </div>
              <div className={cn("flex min-w-0 flex-wrap items-baseline justify-between gap-x-3", isLast ? "pb-0" : "pb-3")}>
                <span
                  className={cn(
                    "text-sm",
                    now
                      ? "font-semibold text-[color:var(--aqt-teal)]"
                      : segment.state === "upcoming"
                        ? "text-[color:var(--aqt-fg-dim)]"
                        : "text-[color:var(--aqt-fg-muted)]"
                  )}
                >
                  {label(segment)}
                </span>
                <span className="aqt-tnum font-mono text-[11px] text-[color:var(--aqt-fg-faint)]">
                  {countdownText ?? (startText ? <time dateTime={segment.startsAt}>{startText}</time> : null)}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
