import type { GameScopeState } from "@/hooks/useGameScope";
import type { PageGame } from "@/lib/site/discipline-scope";

/**
 * A `useGameScope` result for component tests whose subject is not the resolution itself: the page reads `game`, no
 * tabs and no pill are asked for. `overrides` sets the axis, the candidate games or a spy.
 *
 *   vi.mock("@/hooks/useGameScope", async () => {
 *     const { gameScopeStub } = await import("@/test/game-scope");
 *     return { useGameScope: () => gameScopeStub({ kind: "game", code: "overwatch", source: "default" }) };
 *   });
 */
export function gameScopeStub(game: PageGame, overrides: Partial<GameScopeState> = {}): GameScopeState {
  return {
    axis: 1,
    games: [],
    resolution: { game, pill: { kind: "hidden" }, tabs: false, scope: "all" },
    game: game.kind === "game" ? game.code : null,
    isError: false,
    refetch: () => {},
    selectScope: () => {},
    selectTab: () => {},
    ...overrides
  };
}
