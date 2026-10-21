import { describe, expect, it } from "vitest";

import { clock, parsePlayersParams, playersSortHref, splitBattleTag } from "./statistics.model";

describe("statistics page model", () => {
  it("reads the players table state, falling back to the defaults", () => {
    expect(parsePlayersParams({})).toEqual({ sort: "titles", query: "", page: 1 });
    expect(parsePlayersParams({ sort: ["winrate"], q: "  fox ", page: "3" })).toEqual({
      sort: "winrate",
      query: "fox",
      page: 3
    });
    expect(parsePlayersParams({ sort: "value", page: "-2" })).toMatchObject({ sort: "titles", page: 1 });
  });

  it("keeps the game and the search on a sort header and never writes the default sort", () => {
    expect(playersSortHref("titles", { discipline: undefined, query: "" })).toBe("/statistics");
    expect(playersSortHref("maps_won", { discipline: ["lol"], query: "fox" })).toBe(
      "/statistics?discipline=lol&q=fox&sort=maps_won"
    );
  });

  it("formats a map length and splits a BattleTag", () => {
    expect(clock(754)).toBe("12:34");
    expect(clock(59.6)).toBe("1:00");
    expect(splitBattleTag("Fox#2130")).toEqual(["Fox", "#2130"]);
    expect(splitBattleTag("Fox")).toEqual(["Fox", null]);
  });
});
