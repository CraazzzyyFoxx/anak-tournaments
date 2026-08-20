import { describe, expect, it } from "bun:test";
import { LogStatsName } from "@/types/stats.types";
import { resolveMatchMvpPlacement } from "@/utils/matchStats";
import type { PlayerWithStats } from "@/types/team.types";

const playerWith = (stats: Partial<Record<LogStatsName, number>>): PlayerWithStats =>
  ({
    stats: { 0: stats as Record<LogStatsName, number> },
    heroes: {}
  }) as PlayerWithStats;

describe("resolveMatchMvpPlacement", () => {
  it("prefers impact_rank over legacy performance", () => {
    const player = playerWith({ [LogStatsName.ImpactRank]: 2, [LogStatsName.Performance]: 1 });
    expect(resolveMatchMvpPlacement(player, 0)).toBe(2);
  });

  it("falls back to performance when impact_rank is absent (legacy match)", () => {
    const player = playerWith({ [LogStatsName.Performance]: 3 });
    expect(resolveMatchMvpPlacement(player, 0)).toBe(3);
  });

  it("returns null when neither stat exists for the round", () => {
    const player = playerWith({});
    expect(resolveMatchMvpPlacement(player, 0)).toBeNull();
  });

  it("returns null for a round the player has no stats row for", () => {
    const player = playerWith({ [LogStatsName.Performance]: 1 });
    expect(resolveMatchMvpPlacement(player, 1)).toBeNull();
  });
});
