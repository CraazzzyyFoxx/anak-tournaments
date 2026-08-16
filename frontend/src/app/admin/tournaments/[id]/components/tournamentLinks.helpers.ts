import type { TournamentLink } from "@/types/stream.types";

/**
 * The `sort_order` to PATCH so `link` leads this tournament's official
 * broadcasts, or `null` when the row must not offer the action at all.
 *
 * There is no `is_featured` column and there must not be one: "primary" is
 * already expressed by coming first in the stream order, which the public
 * broadcast block reads straight off `sort_order`. A flag beside it would be a
 * second way to say the same thing, with two sources of truth to keep in sync.
 *
 * One function answers both questions on purpose — the button is rendered iff
 * this returns a number, and it sends exactly the number it returned, so what
 * a row offers and what it does cannot drift apart.
 *
 * Returns `min - 1` rather than `0` because the backend orders by
 * `(sort_order, id)`: a link tied with the current leader loses on its larger
 * id. A freshly added link already defaults to `sort_order = 0`, so sending
 * `0` would be a no-op the operator can only read as the button being broken.
 * Negative values are safe — the column is a plain NOT NULL integer with no
 * CHECK constraint.
 */
export function primaryStreamLinkSortOrder(
  link: TournamentLink,
  links: readonly TournamentLink[]
): number | null {
  // Archived rows never reach the public page and a Discord invite is not a
  // broadcast, so neither is a candidate — and neither may drag the minimum
  // down for the rows that are.
  if (link.kind !== "stream" || !link.is_active) {
    return null;
  }

  // Seeded with `link` itself, which has just been proven eligible, so the fold
  // never has to describe an empty set.
  const leader = links.reduce((best, candidate) => {
    if (candidate.kind !== "stream" || !candidate.is_active) {
      return best;
    }
    const winsTheOrder =
      candidate.sort_order < best.sort_order ||
      (candidate.sort_order === best.sort_order && candidate.id < best.id);
    return winsTheOrder ? candidate : best;
  }, link);

  return leader.id === link.id ? null : leader.sort_order - 1;
}
