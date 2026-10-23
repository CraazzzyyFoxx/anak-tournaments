import { PlaceBadge } from "@/components/ui/place-badge";

/**
 * Placement medal for a player's performance rank within a single match. The medal colours come from
 * `PlaceBadge` / the `--aqt-medal-*` tokens.
 */
export const PerformanceBadge = ({ performance }: { performance: number | null | undefined }) => {
  if (performance == null || !Number.isFinite(performance)) {
    return <span className="text-xs tabular-nums text-[color:var(--aqt-fg-faint)]">—</span>;
  }

  return <PlaceBadge place={performance} />;
};
