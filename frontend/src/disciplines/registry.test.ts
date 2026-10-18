import { describe, expect, it } from "vitest";

import { createDisciplineLoader } from "./registry/create";
import { loadAdminUI } from "./registry/admin";
import { loadPregameUI } from "./registry/pregame";
import { loadRankUI } from "./registry/rank";

const FAMILIES = { rank: loadRankUI, pregame: loadPregameUI, admin: loadAdminUI };

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
    const slotsOf = async (load: typeof loadRankUI | typeof loadPregameUI | typeof loadAdminUI) =>
      Object.keys((await load("overwatch"))?.slots ?? {}).sort();

    expect(loadRankUI("overwatch")).toBe(loadRankUI("overwatch"));
    expect(await slotsOf(loadRankUI)).toEqual(["rankHistory"]);
    expect(await slotsOf(loadPregameUI)).toEqual(["pregameCharacterBans"]);
    expect(await slotsOf(loadAdminUI)).toEqual(["nativeRankEditor", "rankMapping"]);
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
});
