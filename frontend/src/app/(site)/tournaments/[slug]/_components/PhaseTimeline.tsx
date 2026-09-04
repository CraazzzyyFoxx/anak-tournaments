"use client";

import { useFormatter, useTranslations } from "next-intl";

import { useMinuteClock } from "@/hooks/useMinuteClock";
import { getTournamentStatusMeta } from "@/lib/tournament-status";
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

  const { segments, automationOff } = buildTournamentSchedule({ tournament, now });
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

  const footnote =
    automationOff || segments.some((segment) => segment.endsAt !== null) ? (
      <div className="mt-3 space-y-1 text-xs text-[color:var(--aqt-fg-dim)]">
        {segments.some((segment) => segment.endsAt !== null) ? (
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
    ) : null;

  if (orientation === "horizontal") {
    return (
      <div id={id} className={cn("scroll-mt-28", className)}>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="aqt-card-title">{t("tournamentDetail.publicPages.schedule.title")}</h2>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--aqt-fg-faint)]">
            {zoneLabel}
          </span>
        </div>
        <ol className="grid auto-cols-fr grid-flow-col gap-1 overflow-x-auto" aria-label={t("tournamentDetail.publicPages.schedule.title")}>
          {segments.map((segment) => {
            const meta = getTournamentStatusMeta(segment.status);
            const startText = stamp(segment.startsAt);
            const endText = segment.endsAt === null ? null : clock24(segment.endsAt);
            const countdownText = countdown(segment);
            return (
              <li
                key={segment.status}
                aria-current={segment.state === "current" ? "step" : undefined}
                className={cn(
                  "relative min-w-[9rem] border-t-[3px] px-3 pb-2 pt-2.5",
                  segment.state === "upcoming"
                    ? "border-[color:var(--aqt-border)] text-[color:var(--aqt-fg-dim)]"
                    : segment.state === "done"
                      ? "border-[color:var(--aqt-fg-faint)]"
                      : "border-[color:var(--aqt-teal)] bg-[color:var(--aqt-overlay-1)]"
                )}
              >
                {segment.state === "current" ? (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute -top-[7px] left-3 size-[11px] rounded-full ring-[3px] ring-[color:var(--aqt-bg)]",
                      meta.dotClassName
                    )}
                  />
                ) : null}
                <div className={cn("text-sm font-semibold", segment.state === "current" && meta.textClassName)}>
                  {t(`common.statusBadge.${segment.status}`)}
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
        {footnote}
      </div>
    );
  }

  return (
    <div id={id} className={cn("scroll-mt-28", className)}>
      <ol aria-label={t("tournamentDetail.publicPages.schedule.title")}>
        {segments.map((segment, index) => {
          const meta = getTournamentStatusMeta(segment.status);
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
                    segment.state === "upcoming"
                      ? "border border-[color:var(--aqt-border)]"
                      : segment.state === "done"
                        ? "bg-[color:var(--aqt-fg-faint)]"
                        : cn(meta.dotClassName, "ring-[3px] ring-[color:var(--aqt-overlay-2)]")
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
                    segment.state === "current"
                      ? cn("font-semibold", meta.textClassName)
                      : segment.state === "upcoming"
                        ? "text-[color:var(--aqt-fg-dim)]"
                        : "text-[color:var(--aqt-fg-muted)]"
                  )}
                >
                  {t(`common.statusBadge.${segment.status}`)}
                </span>
                <span className="aqt-tnum font-mono text-[11px] text-[color:var(--aqt-fg-faint)]">
                  {countdownText ?? (startText ? <time dateTime={segment.startsAt}>{startText}</time> : null)}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      {footnote}
    </div>
  );
}
