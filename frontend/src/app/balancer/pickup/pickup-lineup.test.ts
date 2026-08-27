import { describe, expect, it } from "vitest";

import type { CustomGamePlayer, RotationRecommendation } from "@/services/custom-game.service";

import {
  averageRank,
  computeRotationHintPatches,
  getLineupIssue,
  parsePointsPerWin,
  parseVariants,
  playerLabel,
  resolveRoleOrder,
  sortLineup,
  summarizeLineup,
  summarizeRoleSupply,
  toggleRole,
} from "./pickup-lineup";

function row(overrides: Partial<CustomGamePlayer> = {}): CustomGamePlayer {
  return {
    id: 1,
    workspace_member_id: 7,
    display_name: null,
    battle_tag: "Aria#1111",
    team_index: null,
    sort_order: 0,
    is_active: true,
    must_play: false,
    roles: null,
    ranks: { tank: 2400, dps: 2600, support: 2500 },
    rank_sources: { tank: "workspace", dps: "workspace", support: "workspace" },
    author_ranks: {},
    ...overrides,
  };
}

function hint(overrides: Partial<RotationRecommendation> = {}): RotationRecommendation {
  return {
    workspace_member_id: 7,
    status: "neutral",
    reason: "",
    consecutive_sat: 0,
    consecutive_played: 0,
    games_played: 0,
    ...overrides,
  };
}

describe("computeRotationHintPatches", () => {
  it("seats a benched member who is owed a seat directly into Must Play", () => {
    const patches = computeRotationHintPatches(
      [row({ is_active: false, must_play: false })],
      [hint({ status: "must_play" })],
    );
    expect(patches).toEqual([{ workspaceMemberId: 7, patch: { is_active: true, must_play: true } }]);
  });

  it("pins an already-active pool member who is owed a seat into Must Play", () => {
    const patches = computeRotationHintPatches(
      [row({ is_active: true, must_play: false })],
      [hint({ status: "must_play" })],
    );
    expect(patches).toEqual([{ workspaceMemberId: 7, patch: { is_active: true, must_play: true } }]);
  });

  it("leaves an already-pinned must_play member untouched", () => {
    const patches = computeRotationHintPatches(
      [row({ is_active: true, must_play: true })],
      [hint({ status: "must_play" })],
    );
    expect(patches).toEqual([]);
  });

  it("benches an active member who should rest, exactly like a manual drop into Benched", () => {
    const patches = computeRotationHintPatches(
      [row({ is_active: true, must_play: false })],
      [hint({ status: "should_rest" })],
    );
    expect(patches).toEqual([{ workspaceMemberId: 7, patch: { is_active: false, must_play: false } }]);
  });

  it("clears a stale host pin when benching a should_rest member", () => {
    const patches = computeRotationHintPatches(
      [row({ is_active: true, must_play: true })],
      [hint({ status: "should_rest" })],
    );
    expect(patches).toEqual([{ workspaceMemberId: 7, patch: { is_active: false, must_play: false } }]);
  });

  it("leaves an already-benched should_rest member untouched", () => {
    const patches = computeRotationHintPatches(
      [row({ is_active: false, must_play: false })],
      [hint({ status: "should_rest" })],
    );
    expect(patches).toEqual([]);
  });

  it("never patches a neutral verdict", () => {
    const patches = computeRotationHintPatches(
      [row({ is_active: false })],
      [hint({ status: "neutral" })],
    );
    expect(patches).toEqual([]);
  });

  it("skips a member with no hint at all", () => {
    const patches = computeRotationHintPatches([row({ workspace_member_id: 9, is_active: false })], []);
    expect(patches).toEqual([]);
  });

  it("applies only the rows that actually need to change, across a mixed pool", () => {
    const rows = [
      row({ workspace_member_id: 1, is_active: false }), // owed a seat
      row({ workspace_member_id: 2, is_active: true }), // should rest
      row({ workspace_member_id: 3, is_active: true }), // neutral, no change
    ];
    const recommendations = [
      hint({ workspace_member_id: 1, status: "must_play" }),
      hint({ workspace_member_id: 2, status: "should_rest" }),
      hint({ workspace_member_id: 3, status: "neutral" }),
    ];
    expect(computeRotationHintPatches(rows, recommendations)).toEqual([
      { workspaceMemberId: 1, patch: { is_active: true, must_play: true } },
      { workspaceMemberId: 2, patch: { is_active: false, must_play: false } },
    ]);
  });
});

describe("summarizeRoleSupply", () => {
  it("counts a player once per role they both picked and are ranked for", () => {
    expect(
      summarizeRoleSupply([
        row({ workspace_member_id: 1, roles: ["tank", "dps"] }),
        row({ workspace_member_id: 2, roles: ["support"] }),
      ]),
    ).toEqual([
      { role: "tank", supply: 1, need: 2, short: 1 },
      { role: "dps", supply: 1, need: 4, short: 3 },
      { role: "support", supply: 1, need: 4, short: 3 },
    ]);
  });

  it("does not count a selected role the player has no rank for", () => {
    // The balance refuses to seat it, so it is not supply however lit the chip is.
    const supply = summarizeRoleSupply([row({ roles: ["tank"], ranks: { dps: 2600 } })]);
    expect(supply.find((entry) => entry.role === "tank")).toEqual({
      role: "tank",
      supply: 0,
      need: 2,
      short: 2,
    });
  });

  it("ignores benched players entirely", () => {
    const supply = summarizeRoleSupply([row({ is_active: false, roles: ["tank"] })]);
    expect(supply.every((entry) => entry.supply === 0)).toBe(true);
  });

  it("never reports a negative shortfall once a role is oversupplied", () => {
    const rows = Array.from({ length: 5 }, (_unused, index) =>
      row({ workspace_member_id: index + 1, roles: ["tank"] }),
    );
    expect(summarizeRoleSupply(rows)[0]).toEqual({ role: "tank", supply: 5, need: 2, short: 0 });
  });
});

describe("parsePointsPerWin", () => {
  it("reads the configured points-per-win, ignoring a disabled/absent knob", () => {
    expect(parsePointsPerWin({ points_per_win: 25 })).toBe(25);
    expect(parsePointsPerWin({ points_per_win: 0 })).toBeNull();
    expect(parsePointsPerWin(null)).toBeNull();
    expect(parsePointsPerWin({})).toBeNull();
  });

  it("rejects a non-integer or negative value rather than throwing", () => {
    expect(parsePointsPerWin({ points_per_win: 2.5 })).toBeNull();
    expect(parsePointsPerWin({ points_per_win: -10 })).toBeNull();
    expect(parsePointsPerWin({ points_per_win: "25" })).toBeNull();
  });
});

describe("resolveRoleOrder", () => {
  it("expands an unset role list to the ranked roles the balancer would use", () => {
    expect(resolveRoleOrder(row({ roles: null, ranks: { dps: 2600, support: 2500 } }))).toEqual([
      "dps",
      "support",
    ]);
  });

  it("keeps the stored selection and drops codes the balancer cannot use", () => {
    expect(resolveRoleOrder(row({ roles: ["support", "flex", "tank", "support"] }))).toEqual([
      "support",
      "tank",
    ]);
  });
});

describe("toggleRole", () => {
  it("appends a role that was off to the end of the order", () => {
    expect(toggleRole(["tank"], "support")).toEqual(["tank", "support"]);
  });

  it("removes a role that was on, leaving the rest of the order untouched", () => {
    expect(toggleRole(["tank", "dps", "support"], "dps")).toEqual(["tank", "support"]);
  });

  it("never resorts the roles it did not touch", () => {
    const afterTank = toggleRole([], "tank");
    const afterDps = toggleRole(afterTank, "dps");
    // Tank was picked first, so it stays first however the ranks compare.
    expect(afterDps).toEqual(["tank", "dps"]);
  });
});

describe("getLineupIssue", () => {
  it("stays silent for a benched player, whatever their setup", () => {
    expect(getLineupIssue(row({ is_active: false, roles: [], ranks: {} }))).toBeNull();
  });

  it("flags an active player whose selected roles have no rank", () => {
    expect(getLineupIssue(row({ roles: ["tank"], ranks: { dps: 2600 } }))).toBe("no_rank");
  });

  it("flags an active player with every role switched off", () => {
    expect(getLineupIssue(row({ roles: [] }))).toBe("no_role");
  });

  it("passes a player with one ranked role", () => {
    expect(getLineupIssue(row({ roles: ["dps"], ranks: { dps: 2600 } }))).toBeNull();
  });
});

describe("averageRank", () => {
  it("averages only the roles the player will be assigned", () => {
    expect(averageRank(row({ roles: ["tank"], ranks: { tank: 2400, dps: 3000 } }))).toBe(2400);
  });

  it("has no value when nothing is ranked", () => {
    expect(averageRank(row({ roles: ["tank"], ranks: {} }))).toBeNull();
  });
});

describe("summarizeLineup", () => {
  it("counts participation and blockers separately from membership", () => {
    expect(
      summarizeLineup([
        row({ workspace_member_id: 1 }),
        row({ workspace_member_id: 2, is_active: false }),
        row({ workspace_member_id: 3, roles: [] }),
      ]),
    ).toEqual({ total: 3, active: 2, benched: 1, blocking: 1 });
  });
});

describe("sortLineup", () => {
  it("floats active players above benched ones, then keeps the host order", () => {
    const rows = [
      row({ workspace_member_id: 1, sort_order: 2 }),
      row({ workspace_member_id: 2, sort_order: 0, is_active: false }),
      row({ workspace_member_id: 3, sort_order: 1 }),
    ];
    expect(sortLineup(rows).map((item) => item.workspace_member_id)).toEqual([3, 1, 2]);
  });
});

describe("parseVariants", () => {
  const payload = {
    variants: [
      {
        teams: [
          {
            id: 1,
            name: "karin",
            average_mmr: 3000,
            total_rating: 15000,
            roster: {
              Damage: [
                {
                  uuid: "8",
                  name: "DemonDimon",
                  assigned_rating: 4100,
                  is_flex: false,
                  role_preferences: ["Tank", "Damage"],
                },
              ],
              Tank: [
                { uuid: "7", name: "karin", assigned_rating: 2900, role_preferences: ["Tank"] },
              ],
            },
          },
          {
            id: 2,
            name: "Tolgrn",
            average_mmr: 2950,
            roster: { Support: [{ uuid: "9", name: "Tolgrn" }] },
          },
        ],
        statistics: {
          composite_score: 0.87,
          mmr_std_dev: 12.34,
          max_total_rating_gap: 150,
          off_role_count: 1,
        },
        benched_players: [{ uuid: "10", name: "Egor" }],
      },
      { teams: [] },
    ],
  };

  it("returns one entry per solver option", () => {
    expect(parseVariants(payload)).toHaveLength(2);
  });

  it("flattens role buckets into seats in canonical role order", () => {
    const [first] = parseVariants(payload);
    expect(first.teams[0].seats.map((seat) => [seat.role, seat.name])).toEqual([
      ["tank", "karin"],
      ["dps", "DemonDimon"],
    ]);
    expect(first.teams[0].seats[0].rating).toBe(2900);
    expect(first.teams[0].averageRank).toBe(3000);
  });

  it("marks a seat off-role only when it is not the player's first choice", () => {
    const [first] = parseVariants(payload);
    const seats = first.teams[0].seats;
    expect(seats.find((seat) => seat.name === "karin")?.offRole).toBe(false);
    expect(seats.find((seat) => seat.name === "DemonDimon")?.offRole).toBe(true);
  });

  it("never marks a flex player off-role", () => {
    const [variant] = parseVariants({
      teams: [
        {
          roster: {
            Support: [{ uuid: "1", name: "Flexy", is_flex: true, role_preferences: ["Tank"] }],
          },
        },
      ],
    });
    expect(variant.teams[0].seats[0].offRole).toBe(false);
    expect(variant.teams[0].seats[0].isFlex).toBe(true);
  });

  it("carries the stats and the benched names the pager shows", () => {
    const [first] = parseVariants(payload);
    expect(first.stats).toEqual({
      compositeScore: 0.87,
      mmrStdDev: 12.34,
      ratingGap: 150,
      offRoleCount: 1,
      benchedCount: 1,
    });
    expect(first.benched).toEqual(["Egor"]);
  });

  it("reads a payload stored without a variants wrapper", () => {
    const variants = parseVariants({
      teams: [{ roster: { tank: [{ uuid: "7", name: "karin" }] } }],
    });
    expect(variants).toHaveLength(1);
    expect(variants[0].teams[0].seats[0].role).toBe("tank");
  });

  it("degrades to an empty list instead of throwing on an unknown shape", () => {
    expect(parseVariants(null)).toEqual([]);
    expect(parseVariants({ teams: "nope" })).toEqual([]);
    expect(
      parseVariants({ variants: [{ teams: [{ roster: [{ uuid: "7" }] }] }] })[0].teams,
    ).toEqual([]);
  });
});

describe("playerLabel", () => {
  it("prefers a display name, then the tag, then the id", () => {
    expect(playerLabel(row({ display_name: "Aria" }))).toBe("Aria");
    expect(playerLabel(row({ display_name: null }))).toBe("Aria#1111");
    expect(playerLabel(row({ display_name: null, battle_tag: null }))).toBe("#7");
  });
});
