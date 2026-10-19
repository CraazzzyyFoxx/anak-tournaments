import { describe, expect, it } from "vitest";

import { createDisciplineLoader } from "./registry/create";
import { loadAdminUI } from "./registry/admin";
import { loadAnalyticsUI } from "./registry/analytics";
import { loadPregameUI } from "./registry/pregame";
import { loadProfileUI } from "./registry/profile";
import { loadRankUI } from "./registry/rank";

const FAMILIES = {
  rank: loadRankUI,
  pregame: loadPregameUI,
  admin: loadAdminUI,
  profile: loadProfileUI,
  analytics: loadAnalyticsUI
};

describe("slot-family loaders", () => {
  it("resolve an unknown code to null, never to another game's module", async () => {
    for (const load of Object.values(FAMILIES)) {
      await expect(load("chess")).resolves.toBeNull();
      await expect(load("")).resolves.toBeNull();
      // Object prototype keys are not installed modules.
      await expect(load("constructor")).resolves.toBeNull();
      await expect(load("__proto__")).resolves.toBeNull();
    }
  });

  it("load Overwatch's slots of exactly their own family, memoised", async () => {
    const slotsOf = async (load: (code: string) => Promise<{ slots: object } | null>) =>
      Object.keys((await load("overwatch"))?.slots ?? {}).sort();

    expect(loadRankUI("overwatch")).toBe(loadRankUI("overwatch"));
    expect(await slotsOf(loadRankUI)).toEqual(["rankHistory"]);
    expect(await slotsOf(loadPregameUI)).toEqual(["pregameCharacterBans"]);
    expect(await slotsOf(loadAdminUI)).toEqual(["nativeRankEditor", "rankMapping"]);
    expect(await slotsOf(loadProfileUI)).toEqual([
      "characterCompare",
      "characterCompareSummary",
      "characterPopover",
      "characterStats",
      "lobbyRankTiles",
      "roleSignatures",
      "topCharacters",
      "tournamentSummary"
    ]);
    expect(await slotsOf(loadAnalyticsUI)).toEqual(["analytics"]);
    for (const load of Object.values(FAMILIES)) expect((await load("overwatch"))?.code).toBe("overwatch");
  });

  it("give LoL no Overwatch renderer in any family", async () => {
    for (const load of Object.values(FAMILIES)) await expect(load("lol")).resolves.toBeNull();
  });

  it("keep a slot's component identity stable across loads", async () => {
    const first = await loadPregameUI("overwatch");
    const second = await loadPregameUI("overwatch");

    expect(second?.slots.pregameCharacterBans).toBe(first?.slots.pregameCharacterBans);
  });

  it("load a module once per code, however often it is asked for", async () => {
    let imports = 0;
    const load = createDisciplineLoader({
      chess: async () => {
        imports += 1;
        return { default: { code: "chess", slots: {} } };
      }
    });

    await Promise.all([load("chess"), load("chess")]);
    await load("chess");

    expect(imports).toBe(1);
  });

  it("retry a module whose chunk failed to load instead of keeping the failure", async () => {
    let imports = 0;
    const load = createDisciplineLoader({
      chess: async () => {
        imports += 1;
        if (imports === 1) throw new Error("ChunkLoadError");
        return { default: { code: "chess", slots: {} } };
      }
    });

    // A failed module is a rejection, not "no module" (`null`).
    await expect(load("chess")).rejects.toThrow("ChunkLoadError");
    await expect(load("chess")).resolves.toEqual({ code: "chess", slots: {} });
    await load("chess");

    expect(imports).toBe(2);
  });
});
