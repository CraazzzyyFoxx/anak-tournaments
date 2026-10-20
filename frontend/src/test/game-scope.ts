import type { GameScopeState } from "@/hooks/useGameScope";
import type { PageGame, PageGameResolution } from "@/lib/site/discipline-scope";
import { LOL_METADATA, OW_METADATA } from "@/test/discipline-metadata";
import type { DisciplineDescriptor } from "@/types/discipline.types";

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

/** The two installed games as `GameMark` reads them (a short name, no artwork). */
export const OW_GAME = { ...OW_METADATA.discipline, short_name: "OW", icon: null } as DisciplineDescriptor;
export const LOL_GAME = { ...LOL_METADATA.discipline, short_name: "LoL", icon: null } as DisciplineDescriptor;

/** `useGameDescriptors()` over both games. */
export const GAME_DESCRIPTORS = new Map([OW_GAME, LOL_GAME].map((game) => [game.code, game]));

/** A multi page's resolution: `null` is the all-games view, a code is that game in scope. */
export function multiResolution(game: string | null): PageGameResolution {
  return game === null
    ? { game: { kind: "all" }, pill: { kind: "all" }, tabs: false, scope: "all" }
    : {
        game: { kind: "game", code: game, source: "scope" },
        pill: { kind: "game", code: game, locked: false },
        tabs: false,
        scope: game
      };
}

/** A settled multi-page `useGameScope()` over both games; override any field (a spy, another resolution). */
export function gameScopeState(game: string | null, overrides: Partial<GameScopeState> = {}): GameScopeState {
  return {
    axis: 1,
    games: [OW_GAME, LOL_GAME],
    resolution: multiResolution(game),
    game,
    isError: false,
    refetch: () => undefined,
    selectScope: () => undefined,
    selectTab: () => undefined,
    ...overrides
  };
}
