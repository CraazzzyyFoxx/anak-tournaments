import { describe, expect, it } from "vitest";

import { loadDisciplineUI } from "./registry";

describe("loadDisciplineUI", () => {
  it("resolves an unknown code to null, never to another game's module", async () => {
    await expect(loadDisciplineUI("chess")).resolves.toBeNull();
    await expect(loadDisciplineUI("")).resolves.toBeNull();
    // Object prototype keys are not installed modules.
    await expect(loadDisciplineUI("constructor")).resolves.toBeNull();
    await expect(loadDisciplineUI("__proto__")).resolves.toBeNull();
  });

  it("loads each installed module under its own code, memoised", async () => {
    const first = loadDisciplineUI("overwatch");
    expect(loadDisciplineUI("overwatch")).toBe(first);
    expect((await first)?.code).toBe("overwatch");
    expect((await loadDisciplineUI("lol"))?.code).toBe("lol");
  });

  it("gives LoL no Overwatch renderer: its slots are empty and share nothing with Overwatch's", async () => {
    const overwatch = await loadDisciplineUI("overwatch");
    const lol = await loadDisciplineUI("lol");

    expect(Object.keys(lol?.slots ?? { x: 1 })).toEqual([]);
    expect(Object.keys(overwatch?.slots ?? {}).sort()).toEqual([
      "nativeRankEditor",
      "pregameCharacterBans",
      "rankHistory",
      "rankMapping"
    ]);
  });

  it("keeps a slot's component identity stable across loads", async () => {
    const first = await loadDisciplineUI("overwatch");
    const second = await loadDisciplineUI("overwatch");

    expect(second?.slots.pregameCharacterBans).toBe(first?.slots.pregameCharacterBans);
  });
});
