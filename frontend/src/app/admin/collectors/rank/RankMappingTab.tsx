"use client";

import { PageStateCard } from "@/components/ui/page-state-card";
import { Skeleton } from "@/components/ui/skeleton";
import { GameScopeControl } from "@/components/workspace/GameScopeControl";
import { DisciplineWidget } from "@/disciplines/DisciplineWidget";
import { loadAdminUI } from "@/disciplines/registry/admin";
import { useGameScope } from "@/hooks/useGameScope";
import type { DisciplineDescriptor } from "@/types/discipline.types";

/** The collector's candidates: only the games that declare native rank collection (spec §3.7). */
const collectsRanks = (games: DisciplineDescriptor[]) =>
  games.filter((game) => game.capabilities.native_rank_collection);

/**
 * The collector's rank-mapping tab: a platform surface. Its game tabs list every installed game that collects native
 * ranks (axis `all`); the game is `?discipline=`, else the scope's game, else the last one, else the first. A game
 * outside that list is named as unavailable — never replaced by another game's mapping panel.
 */
export function RankMappingTab() {
  const gameScope = useGameScope({ pageClass: "platform", axis: "all", filter: collectsRanks });
  const { resolution, games } = gameScope;

  if (resolution === null) {
    return gameScope.isError ? (
      <PageStateCard state="error" onAction={gameScope.refetch} />
    ) : (
      <Skeleton className="h-40 w-full rounded-xl" />
    );
  }
  if (resolution.game.kind === "invalid" || resolution.game.kind === "empty") {
    return <GameScopeControl scope={gameScope} variant="single" />;
  }
  const descriptor = games?.find((entry) => entry.code === gameScope.game);
  if (!descriptor) return null;

  return (
    <div className="space-y-4">
      <GameScopeControl scope={gameScope} variant="single" />
      <DisciplineWidget
        discipline={descriptor.code}
        load={loadAdminUI}
        slot="rankMapping"
        capabilities={descriptor.capabilities}
        requires="native_rank_collection"
        props={{}}
        fallback={null}
      />
    </div>
  );
}
