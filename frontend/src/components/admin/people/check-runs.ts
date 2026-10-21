import type { SubscriptionCheckLogRow } from "@/types/admin.types";

/**
 * The check log (newest first) folded into runs of consecutive identical
 * results: newest run first, each run newest check first.
 *
 * A scheduled sweep logs the same verdict on every pass, so the raw log is a
 * wall of identical rows that hides the one row that matters — the change.
 * "Consecutive" is per provider: a sweep that checks Boosty and Twitch
 * interleaves their rows, and a Twitch check between two identical Boosty
 * checks changes nothing about Boosty. Only a different result (state, tier,
 * reason, error or source) for the same provider starts a new run, so a state
 * change is always its own row.
 */
export function collapseCheckRuns(
  rows: readonly SubscriptionCheckLogRow[]
): SubscriptionCheckLogRow[][] {
  const runs: SubscriptionCheckLogRow[][] = [];
  const openRun = new Map<string, SubscriptionCheckLogRow[]>();
  for (const row of rows) {
    const run = openRun.get(row.provider);
    const head = run?.[0];
    if (
      run &&
      head &&
      head.state === row.state &&
      head.tier_rank === row.tier_rank &&
      head.tier_label === row.tier_label &&
      head.reason === row.reason &&
      head.error === row.error &&
      head.source === row.source
    ) {
      run.push(row);
    } else {
      const next = [row];
      runs.push(next);
      openRun.set(row.provider, next);
    }
  }
  return runs;
}
