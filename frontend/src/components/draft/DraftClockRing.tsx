"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { isUrgent, remainingMs } from "@/lib/draft-logic";
import { accentToken, type DraftAccent } from "@/lib/draft-visual";

interface DraftClockRingProps {
  expiresAt: string | null;
  paused: boolean;
  totalSeconds: number;
  accent: DraftAccent;
}

const SIZE = 88;
const STROKE = 6;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;
/** Seconds at which the clock announces itself. A 250ms live region is unusable. */
const ANNOUNCE_AT = [30, 10, 5];

export function DraftClockRing({ expiresAt, paused, totalSeconds, accent }: Readonly<DraftClockRingProps>) {
  const t = useTranslations();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const initialId = window.setTimeout(() => setNow(Date.now()), 0);
    const intervalId = !paused && expiresAt
      ? window.setInterval(() => setNow(Date.now()), 250)
      : null;

    return () => {
      window.clearTimeout(initialId);
      if (intervalId != null) window.clearInterval(intervalId);
    };
  }, [paused, expiresAt]);

  const ms = expiresAt && now != null ? remainingMs(expiresAt, now) : null;
  const seconds = ms == null ? null : Math.ceil(ms / 1000);
  const frac = ms == null || totalSeconds <= 0 ? 0 : Math.min(1, ms / (totalSeconds * 1000));
  const urgent = ms != null && isUrgent(ms);
  // Colour, not only the pulse: under prefers-reduced-motion the animation is
  // suppressed, so motion alone would leave no urgency cue at all.
  const color = paused ? "var(--aqt-amber)" : urgent ? "var(--aqt-live)" : accentToken(accent);
  const label = paused
    ? t("draft.clock.paused")
    : seconds == null
      ? t("draft.clock.idle")
      : t("draft.clock.remaining", { seconds });

  // Derived, not stateful: the text only exists while `seconds` sits on a
  // threshold, and React skips identical text writes, so the live region gets
  // exactly one announcement per threshold instead of one every 250ms tick.
  const announcement =
    !paused && seconds != null && ANNOUNCE_AT.includes(seconds)
      ? t("draft.clock.remaining", { seconds })
      : "";

  return (
    <div className="relative grid place-items-center" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} className="-rotate-90" aria-hidden>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--aqt-border)" strokeWidth={STROKE} />
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={color} strokeWidth={STROKE}
          strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)}
          className="transition-[stroke-dashoffset] duration-200 motion-reduce:transition-none"
        />
      </svg>
      <span
        role="timer"
        aria-label={label}
        className={`absolute font-onest text-xl font-semibold tabular-nums ${urgent ? "animate-pulse motion-reduce:animate-none" : ""}`}
        style={{ color }}
      >
        {paused ? t("draft.clock.pauseCompact") : seconds == null ? "--" : `${seconds}`}
      </span>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
