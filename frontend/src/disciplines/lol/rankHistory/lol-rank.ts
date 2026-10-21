import type { RankSeries } from "@/types/rank.types";

export type LolQueue = "solo" | "flex";
export const LOL_QUEUES: readonly LolQueue[] = ["solo", "flex"];

const ROMAN = ["", "I", "II", "III", "IV"];

/** "DIAMOND" + 1 -> "Diamond I"; an apex tier has no division; an unranked row has no name. */
export function formatLolRank(rank: { division: string | null; tier: number | null }): string | null {
  if (!rank.division) return null;
  const name = rank.division.charAt(0) + rank.division.slice(1).toLowerCase();
  return rank.tier ? `${name} ${ROMAN[rank.tier]}` : name;
}

/** One chart row: absent before a queue's first observation, `null` while no account is ranked in it. */
export type LolChartRow = { at: number } & Partial<Record<LolQueue, number | null>>;

/**
 * Solo and Flex merged by time: one row per change, a column per queue (recharts draws each as a step line). History
 * holds one series per Riot account × queue; like the current-rank card, a queue's value is the best rank among the
 * accounts currently ranked in it (each account's last observation carried forward, an unranked one dropping out), so
 * two accounts never zig-zag one line. Every row carries both queues' state, so a gap (`null`) means unranked.
 */
export function chartRows(series: RankSeries[]): LolChartRow[] {
  const changes = LOL_QUEUES.flatMap((queue) =>
    series
      .filter((line) => line.queue === queue)
      .flatMap((line) =>
        line.points.map((point) => ({
          queue,
          account: line.social_account_id,
          at: Date.parse(point.captured_at),
          value: point.is_ranked ? point.rank_value : null
        }))
      )
  ).sort((a, b) => a.at - b.at);
  const ranked: Partial<Record<LolQueue, Map<number, number>>> = {};
  // Changes arrive in time order, so the rows do too; a later change at the same moment rewrites that row.
  const rows = new Map<number, LolChartRow>();
  for (const change of changes) {
    const accounts = (ranked[change.queue] ??= new Map());
    if (change.value == null) accounts.delete(change.account);
    else accounts.set(change.account, change.value);
    const row: LolChartRow = { at: change.at };
    for (const queue of LOL_QUEUES) {
      const held = ranked[queue];
      if (held) row[queue] = held.size > 0 ? Math.max(...held.values()) : null;
    }
    rows.set(change.at, row);
  }
  return [...rows.values()];
}

/** A ranked point with no ranked neighbour: a step line has no segment there, so it needs a dot to be seen. */
export function isLone(points: ReadonlyArray<{ value?: number | null }>, index: number): boolean {
  return points[index]?.value != null && points[index - 1]?.value == null && points[index + 1]?.value == null;
}
