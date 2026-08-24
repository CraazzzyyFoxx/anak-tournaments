import { describe, expect, it } from "vitest";

import type { CustomGamePlayer } from "@/services/custom-game.service";

import {
  averageRank,
  getLineupIssue,
  groupTeams,
  moveRole,
  parseAssignedRoles,
  playerLabel,
  resolveRoleOrder,
  sortLineup,
  summarizeLineup,
  toggleRole,
} from "./pickup-lineup";

function row(overrides: Partial<CustomGamePlayer> = {}): CustomGamePlayer {
  return {
    id: 1,
    workspace_player_id: 7,
    display_name: null,
    battle_tag: "Aria#1111",
    rank_value: null,
    team_index: null,
    sort_order: 0,
    is_active: true,
    roles: null,
    ranks: { tank: 2400, dps: 2600, support: 2500 },
    ...overrides,
  };
}

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
        row({ workspace_player_id: 1 }),
        row({ workspace_player_id: 2, is_active: false }),
        row({ workspace_player_id: 3, roles: [] }),
      ]),
    ).toEqual({ total: 3, active: 2, benched: 1, blocking: 1 });
  });
});

describe("sortLineup", () => {
  it("floats active players above benched ones, then keeps the host order", () => {
    const rows = [
      row({ workspace_player_id: 1, sort_order: 2 }),
      row({ workspace_player_id: 2, sort_order: 0, is_active: false }),
      row({ workspace_player_id: 3, sort_order: 1 }),
    ];
    expect(sortLineup(rows).map((item) => item.workspace_player_id)).toEqual([3, 1, 2]);
  });
});

describe("groupTeams", () => {
  it("builds teams from team_index and skips unassigned rows", () => {
    const teams = groupTeams([
      row({ workspace_player_id: 1, team_index: 1, roles: ["tank"], ranks: { tank: 2000 } }),
      row({ workspace_player_id: 2, team_index: 0, roles: ["tank"], ranks: { tank: 3000 } }),
      row({ workspace_player_id: 3, team_index: null }),
    ]);
    expect(teams.map((team) => team.index)).toEqual([0, 1]);
    expect(teams[0].players.map((item) => item.workspace_player_id)).toEqual([2]);
    expect(teams[0].averageRank).toBe(3000);
  });
});

describe("parseAssignedRoles", () => {
  it("reads the solver's canonical role names off the first variant", () => {
    expect(
      parseAssignedRoles({
        variants: [
          {
            teams: [
              { roster: { Tank: [{ uuid: "7" }], Damage: [{ uuid: "8" }, { uuid: "9" }] } },
              { roster: { Support: [{ uuid: "10" }] } },
            ],
          },
        ],
      }),
    ).toEqual({ "7": "tank", "8": "dps", "9": "dps", "10": "support" });
  });

  it("reads a payload stored without a variants wrapper", () => {
    expect(parseAssignedRoles({ teams: [{ roster: { tank: [{ uuid: "7" }] } }] })).toEqual({
      "7": "tank",
    });
  });

  it("degrades to an empty map instead of throwing on an unknown shape", () => {
    expect(parseAssignedRoles(null)).toEqual({});
    expect(parseAssignedRoles({ teams: "nope" })).toEqual({});
    expect(parseAssignedRoles({ teams: [{ roster: [{ uuid: "7" }] }] })).toEqual({});
  });
});

describe("playerLabel", () => {
  it("prefers a display name, then the tag, then the id", () => {
    expect(playerLabel(row({ display_name: "Aria" }))).toBe("Aria");
    expect(playerLabel(row({ display_name: null }))).toBe("Aria#1111");
    expect(playerLabel(row({ display_name: null, battle_tag: null }))).toBe("#7");
  });
});
