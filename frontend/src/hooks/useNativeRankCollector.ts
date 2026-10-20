"use client";

import { usePathname } from "next/navigation";

import { useGameScope, type GameScopeState } from "@/hooks/useGameScope";
import { blockClassOf, type WorkspaceAxis } from "@/lib/site/discipline-scope";
import type { DisciplineDescriptor } from "@/types/discipline.types";

/**
 * The game a rank surface (history, collector mapping) talks about, and whether that game collects ranks.
 *
 * The game is resolved first through the shared resolver — the owning game when there is one, else the block rules of
 * the route (`blockClassOf`: single, or platform on a game-neutral page) — and only then gated by the
 * `native_rank_collection` capability. Capability never picks a game: a game that does not collect ranks resolves to
 * `supported: false`, never to another game that does; an invalid explicit value is `scope.resolution.game.kind ===
 * "invalid"`, with `GameScopeControl` as its way out.
 */
export interface NativeRankCollector {
  scope: GameScopeState;
  descriptor: DisciplineDescriptor | null;
  supported: boolean;
}

export function useNativeRankCollector(axis: WorkspaceAxis, ownerDiscipline?: string | null): NativeRankCollector {
  const blockClass = blockClassOf(usePathname());
  const scope = useGameScope({
    pageClass: ownerDiscipline ? "owner" : blockClass,
    axis,
    ownerGame: ownerDiscipline ?? null
  });
  const descriptor = scope.game === null ? null : (scope.games?.find((entry) => entry.code === scope.game) ?? null);
  return { scope, descriptor, supported: descriptor?.capabilities.native_rank_collection === true };
}
