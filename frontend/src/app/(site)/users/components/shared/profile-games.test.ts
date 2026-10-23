import { describe, expect, it } from "vitest";

import type { GameScopeInit } from "@/lib/site/discipline-scope";
import type { DisciplineDescriptor } from "@/types/discipline.types";
import type { UserGameSummary } from "@/types/user.types";

import { blockGameOf, orderPlayerGames, playerGameChoices } from "./profile-games";

const game = (code: string, enabled = true) => ({ code, name: code, enabled }) as DisciplineDescriptor;
// Distinct counts, most first in the order given (ties are covered by their own case below).
const played = (...codes: string[]): UserGameSummary[] =>
  codes.map((discipline, index) => ({
    discipline,
    roles: [],
    tournaments_count: codes.length - index,
    tournaments_won: 0
  }));
const init = (lastGame: string | null, disciplines = [game("overwatch"), game("lol")]): GameScopeInit => ({
  stored: "all",
  lastGame,
  axis: 1,
  hostLockedWorkspaceId: null,
  disciplines
});

describe("orderPlayerGames (R14: ties in the area's order)", () => {
  const tied: UserGameSummary[] = [
    { discipline: "overwatch", roles: [], tournaments_count: 2, tournaments_won: 0 },
    { discipline: "lol", roles: [], tournaments_count: 2, tournaments_won: 1 }
  ];

  it("breaks a tie in the community's order, not the installed one", () => {
    const reversed = init(null, [game("lol"), game("overwatch")]);
    expect(orderPlayerGames(tied, reversed).map((entry) => entry.discipline)).toEqual(["lol", "overwatch"]);
    expect(blockGameOf(tied, reversed)).toBe("lol");
    expect(orderPlayerGames(tied, init(null)).map((entry) => entry.discipline)).toEqual(["overwatch", "lol"]);
  });
});

describe("blockGameOf (spec §6.6 per-game tabs under all games)", () => {
  it("opens on the last game when the player played it", () => {
    expect(blockGameOf(played("lol", "overwatch"), init("overwatch"))).toBe("overwatch");
  });

  it("falls back to the player's main game (most tournaments first) when the last game was never played", () => {
    expect(blockGameOf(played("lol", "overwatch"), init(null))).toBe("lol");
    expect(blockGameOf(played("lol"), init("overwatch"))).toBe("lol");
  });

  it("offers only games the area runs, in the player's order", () => {
    const area = [game("overwatch"), game("lol", false)];
    expect(playerGameChoices(played("lol", "overwatch"), init(null, area)).map((entry) => entry.code)).toEqual([
      "lol",
      "overwatch"
    ]);
    expect(blockGameOf(played("lol", "overwatch"), init(null, area))).toBe("overwatch");
    expect(blockGameOf([], init(null))).toBeNull();
  });
});
