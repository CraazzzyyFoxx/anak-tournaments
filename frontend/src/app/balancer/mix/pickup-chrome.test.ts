import { describe, expect, it } from "vitest";

import { lobbyIndexFromLetter } from "./pickup-chrome";

describe("lobbyIndexFromLetter", () => {
  it("reads a room's letter A..F in either case, and nothing else", () => {
    expect(["A", "b", "F"].map((letter) => lobbyIndexFromLetter(letter))).toEqual([0, 1, 5]);
    expect(["G", "AA", "", "1", undefined].map((letter) => lobbyIndexFromLetter(letter))).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});
