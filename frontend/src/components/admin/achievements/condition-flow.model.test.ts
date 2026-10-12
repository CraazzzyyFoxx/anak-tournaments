// The achievement registry's own half of the condition builder. The tree ↔
// flat-graph conversion it used to own now lives in
// `components/rule-builder/rule-tree.test.ts`, shared with the pick-ban
// constructor, and how a node reads now lives in
// `lib/achievements/condition-text.test.ts`, shared with the public pages.
// What is left here is the palette the editor offers.
import { describe, expect, it } from "vitest";

import { createSidebarGroups } from "./condition-flow.model";

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
