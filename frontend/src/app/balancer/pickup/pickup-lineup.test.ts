import { describe, expect, it } from "vitest";

import type { CustomGamePlayer } from "@/services/custom-game.service";

import {
  averageRank,
  getLineupIssue,
  parseOutcome,
  parseVariants,
  playerLabel,
  resolveRoleOrder,
  roleOrderByStrength,
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

  it("keeps the stored selection and drops codes the balancer cannot use", () => {
    expect(resolveRoleOrder(row({ roles: ["support", "flex", "tank", "support"] }))).toEqual([
      "support",
      "tank",
    ]);
  });
});

describe("roleOrderByStrength", () => {
  it("orders the selected roles by effective rank, strongest first", () => {
    // Stored order says support-then-tank; the ranks say otherwise, and the ranks
    // are what the balancer will be handed.
    expect(
      roleOrderByStrength(
        row({ roles: ["support", "tank", "dps"], ranks: { tank: 2400, dps: 2600, support: 2500 } }),
      ),
    ).toEqual(["dps", "support", "tank"]);
  });

  it("sinks a selected role with no rank below every ranked one", () => {
    expect(roleOrderByStrength(row({ roles: ["tank", "dps"], ranks: { dps: 2600 } }))).toEqual([
      "dps",
      "tank",
    ]);
  });

  it("breaks ties in canonical order, so two hosts read the same row the same way", () => {
    expect(
      roleOrderByStrength(
        row({ roles: ["support", "dps", "tank"], ranks: { tank: 2500, dps: 2500, support: 2500 } }),
      ),
    ).toEqual(["tank", "dps", "support"]);
  });
});

describe("toggleRole", () => {
  it("adds a role and hands back the whole selection sorted by strength", () => {
    expect(toggleRole(row({ roles: ["tank"] }), "support")).toEqual(["support", "tank"]);
  });

  it("removes a role that was on", () => {
    expect(toggleRole(row({ roles: ["tank", "dps", "support"] }), "dps")).toEqual([
      "support",
      "tank",
    ]);
  });

  it("resolves an unset selection before toggling, so the write is explicit", () => {
    // `roles: null` is "not configured"; a toggle must not leave the rest of the
    // selection to a server-side default.
    expect(toggleRole(row({ roles: null }), "tank")).toEqual(["dps", "support"]);
  });

  it("never lets click order become priority order", () => {
    const afterTank = toggleRole(row({ roles: [] }), "tank");
    const afterDps = toggleRole(row({ roles: afterTank }), "dps");
    // Tank was picked first but is the weaker role, so it still sorts second.
    expect(afterDps).toEqual(["dps", "tank"]);
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
