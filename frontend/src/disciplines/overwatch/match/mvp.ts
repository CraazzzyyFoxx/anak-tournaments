import { selectFacts } from "@/lib/stats/facts";
import type { MatchWithUserStats } from "@/types/user.types";

/**
 * The overperformance score a member must reach (at the top of the match) to earn the badge. Mirrors
 * `shared.core.impact.BADGE_THRESHOLD`, which the backend no longer applies on the wire.
 */
const BADGE_THRESHOLD = 2.0;

export type MvpRank = "gold" | "silver" | "bronze" | "default";

/** Map a 1-based per-match performance placement to an MVP medal rank. */
export const mvpRank = (performance: number | null | undefined): MvpRank => {
  if (performance === 1) return "gold";
  if (performance === 2) return "silver";
  if (performance === 3) return "bronze";
  return "default";
};

/**
 * Official MVP placement from a member's whole-match facts: impact rank when computed, legacy performance
 * otherwise. An absent fact is missing, never a placement.
 */
export const resolveMvpPlacement = (
  facts: Readonly<Record<string, number>> | null | undefined
): number | null => facts?.impact_rank ?? facts?.performance ?? null;

/**
 * Whether the viewer earned the overperformance badge: the top competition rank (ties share it) by
 * `overperformance_score` among every observed member of the match, and at least `BADGE_THRESHOLD`. The rank
 * counts members, not just the viewer's own rows, so it needs the match's `member_totals` — which carry exactly the
 * stats Overwatch declares as its `member_total_stats` (backend `disciplines/overwatch`): rank by another stat here
 * only after declaring it there.
 */
export const overperformanceBadge = (
  match: Pick<MatchWithUserStats, "viewer" | "member_totals">
): boolean => {
  const score = match.viewer?.facts.overperformance_score;
  if (score == null) return false;
  const totals = selectFacts(match.member_totals ?? [], { segment: 0, entity: "none" }).filter(
    (fact) => fact.workspace_member_id != null && fact.stat_code === "overperformance_score"
  );
  const position = 1 + totals.filter((fact) => fact.value > score).length;
  return position === 1 && score >= BADGE_THRESHOLD;
};

/**
 * Signed, 1-decimal display for the overperformance score (z-composite vs the
 * player's role×rank baseline): how much better/worse than expected they
 * played. `raised` drives the up/down + positive/negative styling. Returns
 * null when there is no score (legacy match / not computed).
 */
export const formatOverperformance = (
  score: number | null | undefined
): { text: string; raised: boolean } | null => {
  if (score == null || Number.isNaN(score)) return null;
  const raised = score >= 0;
  return { text: `${raised ? "+" : "−"}${Math.abs(score).toFixed(1)}`, raised };
};

const ORDINAL_PLURAL_RULES = new Intl.PluralRules("en-US", { type: "ordinal" });
const ORDINAL_SUFFIXES: Partial<Record<Intl.LDMLPluralRule, string>> = {
  one: "st",
  two: "nd",
  few: "rd"
};

/** Ordinal for a positive integer ("1st", "2nd", "13th"), shown in every locale. */
export const ordinal = (n: number): string => {
  if (!Number.isFinite(n)) return String(n);
  return `${n}${ORDINAL_SUFFIXES[ORDINAL_PLURAL_RULES.select(n)] ?? "th"}`;
};
