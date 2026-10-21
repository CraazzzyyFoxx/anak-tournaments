import type { Ladder } from "@/app/admin/settings/divisions/editor/draftReducer";
import type { DivisionTier } from "@/types/workspace.types";

export const editorHref = (versionId: number) => `/admin/settings/divisions/v/${versionId}`;

/**
 * The version's divisions are exactly the built-in ladder: one per rank, on the ladder's own rank values. Copying such
 * a version gives nothing a grid started from the ladder does not, so the two are not offered as a choice.
 */
export function matchesLadder(ladder: Ladder, tiers: readonly DivisionTier[]): boolean {
  if (tiers.length !== ladder.count) return false;
  const sorted = [...tiers].sort((left, right) => right.rank_min - left.rank_min);
  return sorted.every(
    (tier, index) =>
      tier.rank_min === ladder.ranks[index].rank_min &&
      (tier.rank_max ?? null) === (ladder.ranks[index].rank_max ?? null)
  );
}
