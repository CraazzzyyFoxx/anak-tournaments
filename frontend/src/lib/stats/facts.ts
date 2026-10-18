import type { StatDefinition } from "@/types/discipline.types";

/** The two keys that place a native fact at a grain; any `NativeFact` satisfies it. */
interface GrainKeyed {
  segment: number;
  entity_id: number | null;
}

/** `segment` 0 is the whole match; `entity` "none" is the no-entity grain (null `entity_id`). */
export type FactGrain = { segment: number; entity: "none" | number };

/**
 * Exactly the facts at one grain. Never merges segment 0 with its child segments or null-entity totals with
 * per-entity rows: they are different observations of the same stat.
 */
export function selectFacts<F extends GrainKeyed>(facts: F[], grain: FactGrain): F[] {
  const entity = grain.entity === "none" ? null : grain.entity;
  return facts.filter((fact) => fact.segment === grain.segment && fact.entity_id === entity);
}

/** The generated wire enum, as the string literals it carries (callers may pass either). */
type Aggregation = `${StatDefinition["aggregation"]}`;

/** One match's value of a stat. `at` is `played_at ?? created_at`; `matchId` breaks equal timestamps. */
export type Observation = { value: number; at: string; matchId: number };

/**
 * Aggregate observations of ONE stat at ONE grain by the definition's rule. `last` is the latest by
 * `(at, matchId)`. Non-finite values are missing, and nothing observed is `null`, never 0.
 */
export function aggregateFacts(
  observations: Observation[],
  aggregation: Aggregation
): number | null {
  const seen = observations.filter((o) => Number.isFinite(o.value));
  if (seen.length === 0) return null;
  const values = seen.map((o) => o.value);
  switch (aggregation) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "max":
      return Math.max(...values);
    case "min":
      return Math.min(...values);
    case "last":
      return seen.reduce((a, b) =>
        (Date.parse(b.at) - Date.parse(a.at) || b.matchId - a.matchId) >= 0 ? b : a
      ).value;
  }
}
