/** Below this many games a winrate is greyed and any comparison hidden (DESIGN.md §11). */
export const LOW_SAMPLE_GAMES = 10;

/**
 * Winrate (0–100) → accent color on the design-book §1 thresholds:
 * ≥60 good · 50–59 mid · <50 bad.
 *
 * `lowSample` greys the number out entirely: a 100% winrate over three maps is
 * noise, and painting it green reads as a ranking it has not earned.
 */
export const winrateColor = (pct: number, lowSample = false): string => {
  if (lowSample) return "var(--aqt-fg-faint)";
  if (pct >= 60) return "var(--aqt-emerald)";
  if (pct >= 50) return "var(--aqt-amber)";
  return "var(--aqt-rose)";
};

/** 0–100 impact/percentile score → ramp: high up-green, low rose, the middle blue. */
export const getImpactColor = (value: number) => {
  if (value >= 66) return "var(--aqt-up)";
  if (value <= 34) return "var(--aqt-rose)";
  return "var(--aqt-blue)";
};
