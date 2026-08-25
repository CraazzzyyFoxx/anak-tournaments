import { describe, expect, it } from "vitest";

import type { CustomGamePlayer } from "@/services/custom-game.service";

import {
  averageRank,
  getLineupIssue,
  moveRole,
  parseOutcome,
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
    roles: null,
    ranks: { tank: 2400, dps: 2600, support: 2500 },
    rank_sources: { tank: "workspace", dps: "workspace", support: "workspace" },
    author_ranks: {},
    ...overrides,
  };
}

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

describe("parseOutcome", () => {
  it("reads a recorded winner and a recorded draw apart from an open mix", () => {
    expect(parseOutcome({ winner: 2 })).toEqual({ winner: 2 });
    expect(parseOutcome({ winner: null })).toEqual({ winner: null });
    expect(parseOutcome(null)).toBeNull();
  });

  it("treats an unrecognised payload as no result rather than throwing", () => {
    expect(parseOutcome({})).toBeNull();
    expect(parseOutcome({ winner: "team one" })).toBeNull();
    expect(parseOutcome("draw")).toBeNull();
  });
});

describe("resolveRoleOrder", () => {
  it("expands an unset role list to the ranked roles the balancer would use", () => {
    expect(resolveRoleOrder(row({ roles: null, ranks: { dps: 2600, support: 2500 } }))).toEqual([
      "dps",
      "support",
    ]);
  });

  it("keeps the host's stored order and drops codes the balancer cannot use", () => {
    expect(resolveRoleOrder(row({ roles: ["support", "flex", "tank", "support"] }))).toEqual([
      "support",
      "tank",
    ]);
  });
});

describe("toggleRole", () => {
  it("appends a new role as the lowest priority", () => {
    expect(toggleRole(["tank"], "support")).toEqual(["tank", "support"]);
  });

  it("removes a role that was on, leaving the rest in order", () => {
    expect(toggleRole(["tank", "dps", "support"], "dps")).toEqual(["tank", "support"]);
  });
});

describe("moveRole", () => {
  it("swaps a role with its neighbour", () => {
    expect(moveRole(["tank", "dps", "support"], "support", -1)).toEqual(["tank", "support", "dps"]);
  });

  it("is a no-op at the ends and for roles that are off", () => {
    const order = ["tank", "dps"] as const;
    expect(moveRole([...order], "tank", -1)).toEqual(["tank", "dps"]);
    expect(moveRole([...order], "dps", 1)).toEqual(["tank", "dps"]);
    expect(moveRole([...order], "support", -1)).toEqual(["tank", "dps"]);
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
              Tank: [{ uuid: "7", name: "karin", assigned_rating: 2900, role_preferences: ["Tank"] }],
            },
          },
          { id: 2, name: "Tolgrn", average_mmr: 2950, roster: { Support: [{ uuid: "9", name: "Tolgrn" }] } },
        ],
        statistics: { composite_score: 0.87, mmr_std_dev: 12.34, max_total_rating_gap: 150, off_role_count: 1 },
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
      teams: [{ roster: { Support: [{ uuid: "1", name: "Flexy", is_flex: true, role_preferences: ["Tank"] }] } }],
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
    const variants = parseVariants({ teams: [{ roster: { tank: [{ uuid: "7", name: "karin" }] } }] });
    expect(variants).toHaveLength(1);
    expect(variants[0].teams[0].seats[0].role).toBe("tank");
  });

  it("degrades to an empty list instead of throwing on an unknown shape", () => {
    expect(parseVariants(null)).toEqual([]);
    expect(parseVariants({ teams: "nope" })).toEqual([]);
    expect(parseVariants({ variants: [{ teams: [{ roster: [{ uuid: "7" }] }] }] })[0].teams).toEqual([]);
  });
});

describe("playerLabel", () => {
  it("prefers a display name, then the tag, then the id", () => {
    expect(playerLabel(row({ display_name: "Aria" }))).toBe("Aria");
    expect(playerLabel(row({ display_name: null }))).toBe("Aria#1111");
    expect(playerLabel(row({ display_name: null, battle_tag: null }))).toBe("#7");
  });
});
