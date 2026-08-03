import { describe, expect, test } from "vitest";

import {
  allowedMatchesSubTab,
  allowedTab,
  isMatchesSubTab,
  isTabKey,
  MATCHES_DEFAULT_SUB_TAB,
  MATCHES_SUB_TAB_KEYS,
  TAB_KEYS,
  type MatchesSubTab,
  type TabKey
} from "./tab-guards";

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

describe("matches sub-tabs", () => {
  test("the landing segment is a real sub-tab", () => {
    // The bare /matches path and every rejected segment redirect here, so a
    // typo in the constant would send both into a 404 loop.
    expect(MATCHES_SUB_TAB_KEYS).toContain(MATCHES_DEFAULT_SUB_TAB);
  });

  test.each<MatchesSubTab>([...MATCHES_SUB_TAB_KEYS])(
    "%s needs match.read and nothing more",
    (tab) => {
      expect(allowedMatchesSubTab(tab, { canReadMatch: true })).toBe(true);
      expect(allowedMatchesSubTab(tab, { canReadMatch: false })).toBe(false);
    }
  );

  test("isMatchesSubTab rejects the parent tab and unknown segments", () => {
    // "matches" is the parent, not a sub-tab: accepting it would make
    // /matches/matches resolve instead of redirecting.
    expect(isMatchesSubTab("matches")).toBe(false);
    expect(isMatchesSubTab("results")).toBe(true);
    expect(isMatchesSubTab("reports")).toBe(true);
    expect(isMatchesSubTab("logs")).toBe(true);
    expect(isMatchesSubTab("maps")).toBe(false);
    expect(isMatchesSubTab("")).toBe(false);
  });

  test("logs stays a top-level key so its permanent redirect resolves", () => {
    // It is gone from the tab bar but the old /logs path still exists and 308s;
    // dropping the key would make the shell bounce that request to overview
    // before the redirect could run.
    expect(isTabKey("logs")).toBe(true);
  });
});
