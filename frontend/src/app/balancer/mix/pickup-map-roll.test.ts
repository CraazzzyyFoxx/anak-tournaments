import { describe, expect, it } from "vitest";

import { catalogEntity, catalogMap, catalogMode } from "@/test/catalog";
import type { CatalogEntityRead } from "@/types/catalog.types";

import { rollNextMap, rollableModes } from "./pickup-map-roll";

const CONTROL = catalogMode(1, "Control");
const CLASH = catalogMode(2, "Clash");
const DEATHMATCH = catalogMode(3, "Deathmatch");

function map(id: number, mode: CatalogEntityRead, overrides: Partial<CatalogEntityRead> = {}): CatalogEntityRead {
  return catalogMap(id, mode, overrides);
}

// Three Control maps, one Clash map, one arcade-only Deathmatch map.
const CATALOGUE = [
  map(10, CONTROL),
  map(11, CONTROL),
  map(12, CONTROL),
  map(20, CLASH),
  map(30, DEATHMATCH, { attrs: { in_competitive: false } }),
];

/** A `random` that hands out the given values in order, then 0. */
function sequence(...values: number[]): () => number {
  const queue = [...values];
  return () => queue.shift() ?? 0;
}

describe("rollableModes", () => {
  it("lists only modes that have a competitive map, name-ordered", () => {
    expect(rollableModes(CATALOGUE).map((mode) => mode.name)).toEqual(["Clash", "Control"]);
  });
});

describe("a game without modes", () => {
  const LOL_MAPS = [
    catalogEntity({ id: 90, kind: "map", discipline: "lol", name: "Summoner's Rift" }),
    catalogEntity({ id: 91, kind: "map", discipline: "lol", name: "Howling Abyss" })
  ];

  it("rolls its maps directly, with no mode chips", () => {
    expect(rollableModes(LOL_MAPS)).toEqual([]);
    expect(rollNextMap(LOL_MAPS, { gamemodeId: null, playedMapIds: [], random: sequence(0, 0) })?.id).toBe(90);
    expect(rollNextMap(LOL_MAPS, { gamemodeId: null, playedMapIds: [], random: sequence(0, 0.9) })?.id).toBe(91);
    expect(rollNextMap(LOL_MAPS, { gamemodeId: null, playedMapIds: [90], random: sequence(0, 0) })?.id).toBe(91);
  });

  it("treats an absent in_competitive as competitive, and an explicit false as arcade-only", () => {
    const arcade = catalogEntity({ id: 92, kind: "map", discipline: "lol", attrs: { in_competitive: false } });
    expect(rollNextMap([arcade], { gamemodeId: null, playedMapIds: [] })).toBeNull();
    expect(rollNextMap([arcade, ...LOL_MAPS], { gamemodeId: null, playedMapIds: [] })?.id).not.toBe(92);
  });
});

describe("rollNextMap", () => {
  it("rolls the mode first, so a one-map mode is as likely as a three-map one", () => {
    // 0.6 over two modes -> Clash (index 1); over four maps it would have been
    // Control's third map (index 2) -- the very bias the two-stage roll avoids.
    const rolled = rollNextMap(CATALOGUE, { gamemodeId: null, playedMapIds: [], random: sequence(0.6, 0) });
    expect(rolled?.id).toBe(20);
  });

  it("stays inside the chosen mode", () => {
    const rolled = rollNextMap(CATALOGUE, { gamemodeId: CONTROL.id, playedMapIds: [], random: sequence(0.99) });
    expect(rolled?.id).toBe(12);
  });

  it("skips maps this mix has played while any fresh one is left, then reopens the pool", () => {
    const fresh = rollNextMap(CATALOGUE, {
      gamemodeId: CONTROL.id,
      playedMapIds: [10, 11],
      random: sequence(0),
    });
    expect(fresh?.id).toBe(12);

    const exhausted = rollNextMap(CATALOGUE, {
      gamemodeId: CONTROL.id,
      playedMapIds: [10, 11, 12],
      random: sequence(0),
    });
    expect(exhausted?.id).toBe(10);
  });

  it("drops a fully played mode from the mode roll until everything is played", () => {
    // Clash's only map is played, so 0.6 (which picked Clash above) now lands on Control.
    const rolled = rollNextMap(CATALOGUE, { gamemodeId: null, playedMapIds: [20], random: sequence(0.6, 0) });
    expect(rolled?.parent_id).toBe(CONTROL.id);
  });

  it("never rolls an arcade-only map, and returns null when nothing qualifies", () => {
    expect(rollNextMap(CATALOGUE, { gamemodeId: DEATHMATCH.id, playedMapIds: [] })).toBeNull();
    expect(rollNextMap([], { gamemodeId: null, playedMapIds: [] })).toBeNull();
  });
});
