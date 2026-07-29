import { describe, expect, test } from "vitest";

import { allowedTab, isTabKey, TAB_KEYS, type TabKey } from "./tab-guards";

const NO_PERMS = {
  canUpdateTournament: false,
  canUpdateEncounter: false,
  canTeamRead: false,
  teamFormation: "balancer"
} as const;

const ALL_PERMS = {
  canUpdateTournament: true,
  canUpdateEncounter: true,
  canTeamRead: true,
  teamFormation: "draft"
} as const;

describe("allowedTab", () => {
  // Table derived from the pre-T5 conditional tab render of [id]/page.tsx:
  // settings ← canUpdateTournament, veto ← canUpdateEncounter,
  // draft ← team_formation === "draft"; registration ← team.read (D16).
  test.each<[TabKey, boolean]>([
    ["overview", true],
    ["teams", true],
    ["stages", true],
    ["matches", true],
    ["logs", true],
    ["settings", false],
    ["veto", false],
    ["registration", false],
    ["draft", false]
  ])("without permissions: %s → %s", (tab, expected) => {
    expect(allowedTab(tab, NO_PERMS)).toBe(expected);
  });

  test("every tab is allowed with full permissions on a draft tournament", () => {
    for (const tab of TAB_KEYS) {
      expect(allowedTab(tab, ALL_PERMS)).toBe(true);
    }
  });

  test("settings follows canUpdateTournament alone", () => {
    expect(allowedTab("settings", { ...NO_PERMS, canUpdateTournament: true })).toBe(true);
    expect(allowedTab("settings", { ...ALL_PERMS, canUpdateTournament: false })).toBe(false);
  });

  test("veto follows canUpdateEncounter alone", () => {
    expect(allowedTab("veto", { ...NO_PERMS, canUpdateEncounter: true })).toBe(true);
    expect(allowedTab("veto", { ...ALL_PERMS, canUpdateEncounter: false })).toBe(false);
  });

  test("registration follows canTeamRead alone", () => {
    expect(allowedTab("registration", { ...NO_PERMS, canTeamRead: true })).toBe(true);
    expect(allowedTab("registration", { ...ALL_PERMS, canTeamRead: false })).toBe(false);
  });

  test("draft follows team formation, not permissions", () => {
    expect(allowedTab("draft", { ...NO_PERMS, teamFormation: "draft" })).toBe(true);
    expect(allowedTab("draft", { ...ALL_PERMS, teamFormation: "balancer" })).toBe(false);
  });
});

describe("isTabKey", () => {
  test("accepts known tabs and rejects arbitrary segments", () => {
    expect(isTabKey("overview")).toBe(true);
    expect(isTabKey("settings")).toBe(true);
    expect(isTabKey("rank-autofill")).toBe(false);
    expect(isTabKey("")).toBe(false);
  });
});
