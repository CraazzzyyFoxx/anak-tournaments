"use client";

import { DisciplineWidget } from "@/disciplines/DisciplineWidget";
import { loadMatchUI } from "@/disciplines/registry/match";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import type { MatchWithUserStats } from "@/types/user.types";

/**
 * The viewer's per-match badge on a profile row (a game's placement chip), drawn by the match's own game's
 * `matchRowBadge` module slot. Nothing renders while the game's metadata loads or when its module has no badge
 * (or the viewer was not observed in the match). Rendered inside a `TooltipProvider`.
 */
export default function MatchRowBadge({ match }: Readonly<{ match: MatchWithUserStats }>) {
  const metadata = useDisciplineMetadata(match.workspace_id, match.discipline);
  if (!match.viewer || !metadata.data) return null;
  return (
    <DisciplineWidget
      discipline={match.discipline}
      load={loadMatchUI}
      slot="matchRowBadge"
      capabilities={metadata.data.discipline.capabilities}
      props={{ match, metadata: metadata.data }}
      fallback={null}
    />
  );
}
