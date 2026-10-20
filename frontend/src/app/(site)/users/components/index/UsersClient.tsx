"use client";

import { GameScopeControl } from "@/components/workspace/GameScopeControl";
import { useGameBoundParams } from "@/components/workspace/scope-pill-store";
import { useGameScope } from "@/hooks/useGameScope";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import { isDivisionGridRequired } from "@/lib/api/error";
import type { GameScopeInit } from "@/lib/site/discipline-scope";
import type { StatsScope } from "@/lib/site/stats-scope";
import { UsersMissingGrid } from "@/app/(site)/users/components/shared/UsersMissingGrid";

import { useUsersIndexParams } from "./useUsersIndexParams";
import { useUsersIndexData } from "./useUsersIndexData";
import { UsersIndexHero } from "./UsersIndexHero";
import { UsersIndexFilters } from "./UsersIndexFilters";
import { UsersTableView } from "./UsersTableView";
import { UsersCatalogView } from "./UsersCatalogView";
import { UsersCompareBar, useCompareSelection } from "./UsersCompareBar";

/** The role and division filters name one game's roles and grid: a pick of another game leaves them behind (R5). */
const USERS_GAME_PARAMS = ["role", "div"];

/**
 * The player index of one game — a single page with local game tabs under "all games" until the cross-game index
 * lands (Task 41). Both views share one set of URL-backed filters; only the one on screen fetches its own list, and
 * the compare selection survives a switch between them.
 *
 * `scope` is resolved on the server (the cross-workspace mode does not exist
 * on a tenant host).
 */
const UsersClient = ({ scope, initial }: Readonly<{ scope: StatsScope; initial: GameScopeInit }>) => {
  const gameScope = useGameScope({ pageClass: "single", initial });
  useGameBoundParams(USERS_GAME_PARAMS);
  const discipline = gameScope.game;
  // The game's roles name the role chips and its native ladder is the all-communities division facet.
  const metadata = useDisciplineMetadata(gameScope.axis, discipline).data ?? null;
  const controls = useUsersIndexParams(scope, discipline, metadata);
  const data = useUsersIndexData(controls.params, discipline, metadata);
  const compare = useCompareSelection();
  const { view } = controls.params;
  // The game has no grid on this axis: every list read is refused the same way, so the notice stands in for the view.
  const gridMissing = isDivisionGridRequired((view === "catalog" ? data.catalogQuery : data.overviewQuery).error);

  if (gameScope.resolution?.game.kind === "invalid" || gameScope.resolution?.game.kind === "empty") {
    return <GameScopeControl scope={gameScope} variant="single" dropParams={USERS_GAME_PARAMS} />;
  }

  return (
    // Bottom padding leaves room for the fixed compare bar.
    <div className="space-y-4 pb-24">
      {gameScope.resolution?.tabs ? (
        <div className="flex justify-end">
          <GameScopeControl scope={gameScope} variant="single" dropParams={USERS_GAME_PARAMS} />
        </div>
      ) : null}
      <UsersIndexHero stats={data.statsQuery.data} />
      <UsersIndexFilters
        controls={controls}
        stats={data.statsQuery.data}
        ontology={data.ontology}
        // `null` means "we could not load it", which is not a count of zero and
        // not a load that is still running.
        foundCount={
          view === "catalog"
            ? data.catalogQuery.isError
              ? null
              : data.catalogQuery.data?.total
            : data.overviewQuery.isError
              ? null
              : data.overviewQuery.data?.total
        }
      />

      {gridMissing && discipline ? (
        <UsersMissingGrid
          discipline={discipline}
          gameName={gameScope.games?.find((entry) => entry.code === discipline)?.name ?? discipline}
          axis={data.workspaceId}
        />
      ) : view === "catalog" ? (
        <UsersCatalogView controls={controls} data={data} compare={compare} />
      ) : (
        <UsersTableView controls={controls} data={data} compare={compare} />
      )}

      <UsersCompareBar compare={compare} />
    </div>
  );
};

export default UsersClient;
