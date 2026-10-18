import { describe, expect, it } from "vitest";

import { achievementQueryKeys as keys } from "./query-keys";

describe("achievement query keys", () => {
  it.each([
    ["conditionTypes", (d: string) => keys.conditionTypes(7, d)],
    ["adminList", (d: string) => keys.adminList(7, d)],
    ["all", (d: string) => keys.all(7, d)],
    ["libraryRules", (d: string) => keys.libraryRules(7, 9, d)],
    ["libraryWorkspaces", (d: string) => keys.libraryWorkspaces(7, d)],
    ["overridesAll", (d: string) => keys.overridesAll(7, d)],
    ["entities", (d: string) => keys.entities(7, d)],
  ])("%s never shares an entry between two games", (_name, key) => {
    expect(key("overwatch")).not.toEqual(key("lol"));
    expect(key("lol")).toContain("lol");
  });

  it("keeps the authorized workspace and rule id in the id keys, which already name one game", () => {
    expect(keys.rule(7, 42)).toEqual(["admin", "achievement-rule", 7, 42]);
    expect(keys.overrides(7, 42)).toEqual(["admin", "overrides", 7, 42]);
    expect(keys.ruleUsers(7, 42)).toEqual(["admin", "achievement-rule-users", 7, 42]);
  });

  it("lets a rule mutation stale the game's list and the public lists by prefix", () => {
    const startsWith = (key: readonly unknown[], prefix: readonly unknown[]) =>
      prefix.every((part, index) => key[index] === part);
    expect(startsWith(keys.adminList(7, "lol"), keys.adminList(7, "lol"))).toBe(true);
    expect(startsWith(keys.adminList(7, "overwatch"), keys.adminList(7, "lol"))).toBe(false);
    // a file import names its own games: the workspace prefix covers every game's list
    expect(startsWith(keys.adminList(7, "lol"), keys.adminListsOf(7))).toBe(true);
    expect(startsWith(keys.adminList(8, "lol"), keys.adminListsOf(7))).toBe(false);
    expect(startsWith(keys.all(7, null), keys.publicLists())).toBe(true);
    expect(startsWith(keys.all(null, "lol"), keys.publicLists())).toBe(true);
  });
});
