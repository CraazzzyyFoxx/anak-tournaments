import type { NativeTier } from "@/types/discipline.types";
import type { CurrentRank, RankSeries } from "@/types/rank.types";

export type Period = "2w" | "3m" | "1y";
export const PERIODS: readonly Period[] = ["2w", "3m", "1y"];
const PERIOD_DAYS: Record<Period, number> = { "2w": 14, "3m": 90, "1y": 365 };

/** The history window's start; an unknown (stale stored) period reads as three months. */
export function periodStart(period: Period): string {
  return new Date(Date.now() - (PERIOD_DAYS[period] ?? 90) * 86_400_000).toISOString();
}

/** A row's line inside one account: Overwatch's role, League's queue; `null` for a game with neither (Deadlock). */
export function dimensionOf(row: { role: string | null; queue?: string | null }): string | null {
  return row.role ?? row.queue ?? null;
}

/** The ladder rank holding a rank value; the ladder is top-first and its top is open-ended. */
export function tierAt(ladder: readonly NativeTier[], value: number | null | undefined): NativeTier | undefined {
  if (value == null) return undefined;
  return ladder.find((tier) => value >= tier.rank_min && (tier.rank_max == null || value <= tier.rank_max));
}

const score = (rank: CurrentRank) => (rank.is_ranked && rank.rank_value != null ? rank.rank_value : -1);

/**
 * Per line (role / queue / the one `null` line), the best current rank among the player's accounts on `platform`.
 * An unranked row stands in when no account is ranked there, so the line still shows as "Unranked".
 */
export function bestCurrent(ranks: readonly CurrentRank[], platform: string | null): Map<string | null, CurrentRank> {
  const best = new Map<string | null, CurrentRank>();
  for (const rank of ranks) {
    if ((rank.platform ?? null) !== platform) continue;
    const key = dimensionOf(rank);
    const held = best.get(key);
    if (!held || score(rank) > score(held)) best.set(key, rank);
  }
  return best;
}

/** One chart row: a column per line, absent before the line's first observation and `null` while it is unranked. */
export type ChartRow = { at: number; [line: string]: number | null };

/** Every line's changes merged by time, each line's last value carried forward, so a step line reads its state. */
export function chartRows(lines: readonly { key: string; series: RankSeries }[]): ChartRow[] {
  const changes = lines
    .flatMap(({ key, series }) =>
      series.points.map((point) => ({
        key,
        at: Date.parse(point.captured_at),
        value: point.is_ranked ? point.rank_value : null
      }))
    )
    .sort((a, b) => a.at - b.at);
  const held: Record<string, number | null> = {};
  // A later change at the same moment rewrites that row.
  const rows = new Map<number, ChartRow>();
  for (const change of changes) {
    held[change.key] = change.value;
    rows.set(change.at, { ...held, at: change.at });
  }
  return [...rows.values()];
}

/** A ranked point with no ranked neighbour: a step line has no segment there, so it needs a dot to be seen. */
export function isLone(points: ReadonlyArray<{ value?: number | null }>, index: number): boolean {
  return points[index]?.value != null && points[index - 1]?.value == null && points[index + 1]?.value == null;
}

/**
 * The y axis on ladder ranks: from the floor of the lowest rank drawn to the floor of the rank above the highest,
 * ticked on rank floors (at most five) so every tick names a real rank.
 */
export function rankAxis(
  ladder: readonly NativeTier[],
  rows: readonly ChartRow[]
): { domain: [number, number]; ticks: number[] | undefined } {
  const values = rows.flatMap((row) =>
    Object.entries(row).flatMap(([key, value]) => (key !== "at" && value != null ? [value] : []))
  );
  const min = Math.min(...values);
  const max = Math.max(...values);
  const floors = ladder.map((tier) => tier.rank_min).sort((a, b) => a - b);
  const lo = floors.filter((floor) => floor <= min).at(-1) ?? min;
  const hi = floors.find((floor) => floor > max) ?? max;
  const inside = floors.filter((floor) => floor >= lo && floor <= hi);
  const step = Math.ceil(inside.length / 5);
  return { domain: [lo, hi], ticks: inside.length > 0 ? inside.filter((_, i) => i % step === 0) : undefined };
}
