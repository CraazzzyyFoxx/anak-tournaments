// The achievement registry's own half of the condition builder. The tree ↔
// flat-graph conversion it used to own now lives in
// `components/rule-builder/rule-tree.test.ts`, shared with the pick-ban
// constructor, and how a node reads now lives in
// `lib/achievements/condition-text.test.ts`, shared with the public pages.
// What is left here is the palette the editor offers.
import { describe, expect, it } from "vitest";

import { createSidebarGroups, defaultLeafOf, filterPaletteByConditions } from "./condition-flow.model";

const SIDEBAR_GROUPS = createSidebarGroups((key) => key);

describe("the palette offers the engine's nodes", () => {
  it("names every leaf item with a registered type", () => {
    const leaves = SIDEBAR_GROUPS.flatMap((group) =>
      group.items.filter((item) => item.type === "leaf")
    );

    expect(leaves.length).toBeGreaterThan(0);
    expect(leaves.every((item) => (item.leafType ?? "") !== "")).toBe(true);
  });

  it("opens with the three logical operators, which every tree needs", () => {
    expect(SIDEBAR_GROUPS[0].items.map((item) => item.logicalOp)).toEqual(["AND", "OR", "NOT"]);
  });
});

describe("the palette follows a game's registry", () => {
  const other = { label: "Other", labelFor: (type: string) => type };

  it("drops static nodes the registry did not return, empty groups and keeps the logical operators", () => {
    const groups = filterPaletteByConditions(SIDEBAR_GROUPS, new Set(["match_win"]), other);
    const leaves = groups.flatMap((group) => group.items.filter((item) => item.type === "leaf").map((item) => item.leafType));
    expect(leaves).toEqual(["match_win"]);
    expect(groups.map((group) => group.label)).toEqual(["logic", "match"]);
  });

  it("lists a registry node the static palette lacks under a trailing group", () => {
    const groups = filterPaletteByConditions(SIDEBAR_GROUPS, new Set(["match_win", "lol_cs"]), other);
    expect(groups.at(-1)).toMatchObject({ label: "Other", items: [{ leafType: "lol_cs" }] });
  });

  it("offers no node but the operators for a game without conditions", () => {
    const groups = filterPaletteByConditions(SIDEBAR_GROUPS, new Set(), other);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.every((item) => item.type === "logical")).toBe(true);
  });

  it("starts from the preferred leaf only when the game has it, and from nothing for an empty game", () => {
    expect(defaultLeafOf(["lol_cs", "match_win"], "match_win")).toBe("match_win");
    expect(defaultLeafOf(["lol_cs"], "match_win")).toBe("lol_cs");
    expect(defaultLeafOf([], "match_win")).toBeNull();
  });
});
