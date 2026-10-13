import { describe, expect, it } from "vitest";
import { isLobby } from "@/lib/encounter/seats";

describe("isLobby", () => {
  it("follows how the encounter is scored, not how many seats it has", () => {
    expect(isLobby({ scoring_preset: "wins" })).toBe(false);
    expect(isLobby({ scoring_preset: "points" })).toBe(true);
  });
});
