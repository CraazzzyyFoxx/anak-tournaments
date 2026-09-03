/**
 * Mapping a published version's divisions onto the draft's, by rank overlap.
 *
 * Every tournament keeps the grid version it was played on, so the workspace
 * needs a translation from each still-read version's tiers to the new ones. The
 * translation is not a guess: both sides are bands of the same 45-rank ladder,
 * so "which division does this old division become" is the band with the most
 * ranks in common — computed here, client-side, and only ambiguous where the
 * old band was cut in half and no target holds a majority. Those are the rows
 * the user resolves by hand; the rest are AUTO.
 *
 * Pure: takes tiers and bands, returns rows and rules. The screen decides what
 * to render and when to PUT them.
 */

import type { DivisionGridMappingRule, DivisionTier } from "@/types/workspace.types";

import { bandSize, bandsFromTiers, type Band } from "./draftReducer";

export interface MappingCandidate {
  band: Band;
  /** Ladder ranks shared with the source band. */
  overlap: number;
  /** `overlap` as a share of the source band, `0 … 1`. */
  weight: number;
}

export interface MappingRow {
  /**
   * The source tier as a ladder band, so it carries the tier id the rules key
   * on alongside the span they are computed from.
   */
  source: Band;
  /** Most overlap first; ties broken by position from the top of the ladder. */
  candidates: MappingCandidate[];
  /**
   * `split` when the leading candidates tie — the old band was cut and no new
   * one holds a majority of its players, so the primary has to be chosen.
   */
  kind: "auto" | "split";
  /** Share of the source band covered by the leading candidate. */
  coverage: number;
}

export function autoMap(sourceTiers: DivisionTier[], bands: Band[]): MappingRow[] {
  return bandsFromTiers(sourceTiers).map((source) => {
    const size = bandSize(source);
    const candidates = bands
      .map((band) => {
        const overlap =
          Math.min(source.owTo, band.owTo) - Math.max(source.owFrom, band.owFrom) + 1;
        return { band, overlap, weight: overlap / size };
      })
      .filter((candidate) => candidate.overlap > 0)
      .sort((left, right) => right.overlap - left.overlap || left.band.owFrom - right.band.owFrom);

    const leader = candidates[0];
    const tied = candidates.length > 1 && candidates[1].overlap === leader?.overlap;
    return {
      source,
      candidates,
      kind: tied ? ("split" as const) : ("auto" as const),
      coverage: leader ? leader.weight : 0
    };
  });
}

/** The primary target for a row: the user's choice, else the leading candidate. */
export function primaryTarget(
  row: MappingRow,
  chosen: Record<number, number | undefined>
): Band | null {
  const pickedId = row.source.id === undefined ? undefined : chosen[row.source.id];
  if (pickedId !== undefined) {
    return row.candidates.find((candidate) => candidate.band.id === pickedId)?.band ?? null;
  }
  return row.kind === "auto" ? (row.candidates[0]?.band ?? null) : null;
}

/** Rows still waiting on a decision — the tab badge, and the publish blocker. */
export function unresolvedRows(
  rows: MappingRow[],
  chosen: Record<number, number | undefined>
): MappingRow[] {
  return rows.filter((row) => primaryTarget(row, chosen) === null);
}

/**
 * The rows as mapping rules.
 *
 * One rule per overlapping target, carrying the overlap as its `weight`, and
 * exactly one of them primary — that pair is what the backend normalizer reads:
 * `weight` records how the old band was divided, `is_primary` decides where a
 * player from it actually lands. A row without a primary contributes nothing,
 * which is what leaves the mapping incomplete until it is resolved.
 */
export function mappingRules(
  rows: MappingRow[],
  chosen: Record<number, number | undefined>
): DivisionGridMappingRule[] {
  const rules: DivisionGridMappingRule[] = [];
  for (const row of rows) {
    const sourceTierId = row.source.id;
    const primary = primaryTarget(row, chosen);
    if (sourceTierId === undefined || primary === null) continue;

    for (const candidate of row.candidates) {
      if (candidate.band.id === undefined) continue;
      rules.push({
        source_tier_id: sourceTierId,
        target_tier_id: candidate.band.id,
        weight: candidate.weight,
        is_primary: candidate.band.id === primary.id
      });
    }
  }
  return rules;
}
