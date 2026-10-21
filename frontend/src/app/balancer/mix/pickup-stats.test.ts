import { describe, expect, it } from "vitest";

import type { MixFormEntry, MixMemberStats, MixOutcome, MixStatsResponse } from "@/services/custom-game.service";

import { formatRecord, formatStreak, mergeMixStats, sinceFor } from "./pickup-stats";

/** Results newest first, each with the given global match id: sources interleave by these ids. */
function form(outcomes: MixOutcome[], ids: number[]): MixFormEntry[] {
  return outcomes.map((outcome, index) => ({
    outcome,
    match_id: ids[index],
    played_at: new Date(Date.UTC(2026, 0, 31) - ids.length + index).toISOString(),
  }));
}

function member(overrides: Partial<MixMemberStats> = {}): MixMemberStats {
  return {
    workspace_member_id: 1,
    display_name: "Aria",
    identity: { provider: "battlenet", handle: "Aria#1111" },
    games: 10,
    wins: 6,
    losses: 4,
    draws: 0,
    win_rate: 0.6,
    streak: 2,
    last_played_at: "2026-01-05T20:00:00Z",
    player_id: 100,
    form: [],
    by_role: { tank: { games: 10, wins: 6, losses: 4, draws: 0 } },
    ...overrides,
  };
}

function source(workspaceId: number, members: MixMemberStats[]): { workspaceId: number; stats: MixStatsResponse } {
  return { workspaceId, stats: { since: null, members, mixes: 0, matches: 0 } };
}

describe("sinceFor", () => {
  it("counts a window back from now, not from a calendar boundary", () => {
    const now = new Date("2026-01-10T13:45:00.000Z");

    expect(sinceFor("7d", now)).toBe("2026-01-03T13:45:00.000Z");
    expect(sinceFor("30d", now)).toBe("2025-12-11T13:45:00.000Z");
  });

  it("filters nothing for all time", () => {
    expect(sinceFor("all", new Date("2026-01-10T13:45:00.000Z"))).toBeNull();
  });
});

describe("mergeMixStats", () => {
  it("joins one player's records from two communities into one row", () => {
    const [player] = mergeMixStats([
      source(1, [member({ workspace_member_id: 5, games: 10, wins: 6, losses: 4, display_name: "aria" })]),
      source(2, [member({ workspace_member_id: 9, games: 6, wins: 2, losses: 3, draws: 1, display_name: "Ari" })]),
    ]);

    expect(player).toMatchObject({ key: "p:100", games: 16, wins: 8, losses: 7, draws: 1, winRate: 0.5 });
    expect(player.byRole).toEqual({ tank: { games: 20, wins: 12, losses: 8, draws: 0 } });
  });

  it("keeps a member who no longer resolves to a player apart from everyone else", () => {
    const players = mergeMixStats([
      source(1, [member({ workspace_member_id: 5, player_id: null })]),
      source(2, [member({ workspace_member_id: 5, player_id: null })]),
    ]);

    expect(players.map((player) => player.key).sort()).toEqual(["m:1:5", "m:2:5"]);
  });

  it("names a player by their handle, else by the nickname of the community they played most in", () => {
    const [tagged] = mergeMixStats([
      source(1, [member({ games: 9, identity: null, display_name: "big" })]),
      source(2, [member({ games: 2, identity: { provider: "battlenet", handle: "Aria#1111" }, display_name: "x" })]),
    ]);
    expect(tagged.name).toBe("Aria#1111");

    const [nicknamed] = mergeMixStats([
      source(1, [member({ games: 2, identity: null, display_name: "small" })]),
      source(2, [member({ games: 9, identity: null, display_name: "big" })]),
    ]);
    expect(nicknamed.name).toBe("big");
  });

  it("ranks by wins, then win rate, then games", () => {
    const players = mergeMixStats([
      source(1, [
        member({ player_id: 1, wins: 5, games: 10 }),
        member({ player_id: 2, wins: 5, games: 8 }),
        member({ player_id: 3, wins: 7, games: 20 }),
      ]),
    ]);

    expect(players.map((player) => player.playerId)).toEqual([3, 2, 1]);
  });

  it("keeps the server's streak for one community and counts a joined one from the merged form", () => {
    const [single] = mergeMixStats([source(1, [member({ streak: 14, form: form(Array(10).fill("win"), [...Array(10).keys()].map((i) => 50 - i)) })])]);
    expect(single).toMatchObject({ streak: 14, streakOpen: false });

    // Community 2 holds the newest results (ids 90, 80); community 1's two wins came before them.
    const [joined] = mergeMixStats([
      source(1, [member({ games: 5, streak: 2, form: form(["win", "win"], [70, 60]) })]),
      source(2, [member({ games: 5, streak: -2, form: form(["loss", "loss"], [90, 80]) })]),
    ]);
    expect(joined.form).toEqual(["loss", "loss", "win", "win"]);
    expect(joined).toMatchObject({ streak: -2, streakOpen: false });
  });

  it("marks a joined run that fills the whole form window as possibly longer", () => {
    const ids = (from: number) => [...Array(10).keys()].map((i) => from - i * 2);
    const [joined] = mergeMixStats([
      source(1, [member({ games: 12, streak: 12, form: form(Array(10).fill("win"), ids(100)) })]),
      source(2, [member({ games: 12, streak: 12, form: form(Array(10).fill("win"), ids(99)) })]),
    ]);

    expect(joined).toMatchObject({ streak: 10, streakOpen: true });
    expect(formatStreak(joined.streak, joined.streakOpen)).toBe("W10+");
  });
});

describe("formatStreak", () => {
  it("reads a run as its direction and length", () => {
    expect(formatStreak(3)).toBe("W3");
    expect(formatStreak(-2)).toBe("L2");
  });

  it("has nothing to show once a run is broken", () => {
    expect(formatStreak(0)).toBeNull();
  });
});

describe("formatRecord", () => {
  it("names draws only when there are some", () => {
    expect(formatRecord(member({ wins: 12, losses: 8, draws: 0 }))).toBe("12–8");
    expect(formatRecord(member({ wins: 12, losses: 8, draws: 1 }))).toBe("12–8–1");
  });
});
