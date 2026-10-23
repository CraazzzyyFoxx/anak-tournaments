import { describe, expect, it } from "vitest";

import {
  balanceBucketKeys,
  canPlayerPlayRole,
  deriveRoleDiscomfort,
  moveBalancePlayer,
  resolveBalanceDropTarget,
  rosterCapacity,
  type BalanceDropTarget,
} from "@/components/balancer/balance-editor-helpers";
import {
  calculateOffRoleCountFromPayload,
  calculateTeamDiscomfortFromPayload,
  calculateTeamVarianceFromPayload,
} from "@/components/balancer/balancer-page-helpers";
import { LOL_METADATA, OW_METADATA } from "@/test/discipline-metadata";
import type {
  BalancerRosterKey,
  InternalBalancePayload,
  InternalBalancePlayer,
} from "@/types/balancer-admin.types";

function makePlayer(overrides: Partial<InternalBalancePlayer> = {}): InternalBalancePlayer {
  return {
    uuid: "1",
    name: "Player",
    assigned_rating: 3000,
    role_preferences: ["tank"],
    all_ratings: { tank: 3000 },
    is_flex: false,
    role_discomfort: 0,
    ...overrides,
  };
}

const OW_BUCKETS = ["tank", "damage", "support", "flex"];

/** Every team carries every bucket of the base set (as a loaded payload does), plus whatever its roster fields. */
function makePayload(
  teamRosters: Array<Partial<Record<BalancerRosterKey, InternalBalancePlayer[]>>>,
  baseBuckets: string[] = OW_BUCKETS,
): InternalBalancePayload {
  return {
    teams: teamRosters.map((roster, index) => ({
      id: index + 1,
      name: `Team ${index + 1}`,
      average_mmr: 0,
      rating_variance: 0,
      total_discomfort: 0,
      max_discomfort: 0,
      roster: { ...Object.fromEntries(baseBuckets.map((bucket) => [bucket, []])), ...roster },
    })),
    statistics: {},
    benched_players: [],
  };
}

describe("canPlayerPlayRole", () => {
  it("returns true for a role the player has a positive rating for", () => {
    const player = makePlayer({ all_ratings: { tank: 3000, damage: 2800 } });
    expect(canPlayerPlayRole(player, "tank")).toBe(true);
    expect(canPlayerPlayRole(player, "damage")).toBe(true);
  });

  it("returns false for a role the player has no rating for", () => {
    const player = makePlayer({ all_ratings: { damage: 2800, support: 2700 } });
    expect(canPlayerPlayRole(player, "tank")).toBe(false);
  });

  it("treats a zero rating as not playable", () => {
    const player = makePlayer({ all_ratings: { tank: 0, damage: 2800 } });
    expect(canPlayerPlayRole(player, "tank")).toBe(false);
  });

  it("falls back to role_preferences when all_ratings is missing", () => {
    const player = makePlayer({ all_ratings: undefined, role_preferences: ["damage", "support"] });
    expect(canPlayerPlayRole(player, "damage")).toBe(true);
    expect(canPlayerPlayRole(player, "tank")).toBe(false);
  });
});

describe("moveBalancePlayer role validation", () => {
  it("rejects moving a player into a role they cannot play", () => {
    const support = makePlayer({
      uuid: "10",
      role_preferences: ["support"],
      all_ratings: { support: 2700 },
    });
    const payload = makePayload([{ support: [support] }, {}]);
    const target: BalanceDropTarget = { kind: "role-container", teamIndex: 1, roleKey: "tank" };

    expect(moveBalancePlayer(payload, "10", target)).toBeNull();
  });

  it("allows moving a player into a role they can play", () => {
    const flexTank = makePlayer({
      uuid: "11",
      role_preferences: ["damage", "tank"],
      all_ratings: { damage: 2900, tank: 2800 },
    });
    // Team 0 fields a tank seat, so the shape has one and team 1's is free.
    const payload = makePayload([{ tank: [makePlayer({ uuid: "12" })], damage: [flexTank] }, {}]);
    const target: BalanceDropTarget = { kind: "role-container", teamIndex: 1, roleKey: "tank" };

    const next = moveBalancePlayer(payload, "11", target);
    expect(next).not.toBeNull();
    expect(next?.teams[1].roster.tank.length).toBe(1);
    expect(next?.teams[0].roster.damage.length).toBe(0);
  });

  it("rejects a swap when the displaced player cannot play the source role", () => {
    // dragged: damage main being dropped onto an occupied tank slot (can play tank)
    const draggedDamage = makePlayer({
      uuid: "20",
      role_preferences: ["damage", "tank"],
      all_ratings: { damage: 2900, tank: 2800 },
    });
    // occupant: pure tank who cannot play damage -> swap into damage is illegal
    const occupantTank = makePlayer({
      uuid: "21",
      role_preferences: ["tank"],
      all_ratings: { tank: 3100 },
    });
    const payload = makePayload([{ damage: [draggedDamage] }, { tank: [occupantTank] }]);
    const target: BalanceDropTarget = {
      kind: "player-row",
      teamIndex: 1,
      roleKey: "tank",
      playerIndex: 0,
      playerId: "21",
    };

    expect(moveBalancePlayer(payload, "20", target)).toBeNull();
  });

  it("allows a swap when both players can play the swapped roles", () => {
    const draggedDamage = makePlayer({
      uuid: "30",
      role_preferences: ["damage", "tank"],
      all_ratings: { damage: 2900, tank: 2800 },
    });
    const occupantFlex = makePlayer({
      uuid: "31",
      role_preferences: ["tank", "damage"],
      all_ratings: { tank: 3100, damage: 3000 },
    });
    const payload = makePayload([{ damage: [draggedDamage] }, { tank: [occupantFlex] }]);
    const target: BalanceDropTarget = {
      kind: "player-row",
      teamIndex: 1,
      roleKey: "tank",
      playerIndex: 0,
      playerId: "31",
    };

    const next = moveBalancePlayer(payload, "30", target);
    expect(next).not.toBeNull();
    expect(next?.teams[1].roster.tank[0]?.uuid).toBe("30");
    expect(next?.teams[0].roster.damage[0]?.uuid).toBe("31");
  });

  it("allows reordering within the same role bucket regardless of other roles", () => {
    const a = makePlayer({ uuid: "40", role_preferences: ["damage"], all_ratings: { damage: 2900 } });
    const b = makePlayer({ uuid: "41", role_preferences: ["damage"], all_ratings: { damage: 2800 } });
    const payload = makePayload([{ damage: [a, b] }]);
    const target: BalanceDropTarget = {
      kind: "player-row",
      teamIndex: 0,
      roleKey: "damage",
      playerIndex: 0,
      playerId: "40",
    };

    const next = moveBalancePlayer(payload, "41", target);
    expect(next).not.toBeNull();
    expect(next?.teams[0].roster.damage[0]?.uuid).toBe("41");
  });
});

describe("rosterCapacity", () => {
  it("reads the shape off the fullest team, flex bucket included", () => {
    const payload = makePayload([
      { tank: [makePlayer({ uuid: "1" })], flex: [makePlayer({ uuid: "2" }), makePlayer({ uuid: "3" })] },
      { tank: [makePlayer({ uuid: "4" })], flex: [makePlayer({ uuid: "5" })] },
    ]);
    expect(rosterCapacity(payload)).toEqual({ tank: 1, damage: 0, support: 0, flex: 2 });
  });

  it("lets a flex-rated player move into a free flex seat", () => {
    const mover = makePlayer({ uuid: "9", all_ratings: { damage: 2500, flex: 2500 } });
    const payload = makePayload([
      { flex: [mover, makePlayer({ uuid: "1" })] },
      { flex: [makePlayer({ uuid: "2" })] },
    ]);
    const next = moveBalancePlayer(payload, "9", { kind: "role-container", teamIndex: 1, roleKey: "flex" });
    expect(next?.teams[1].roster.flex.map((player) => player.uuid)).toEqual(["2", "9"]);
  });

  it("counts the buckets of any game the payload carries", () => {
    const payload = makePayload(
      [{ top: [makePlayer({ uuid: "1" })], jungle: [makePlayer({ uuid: "2" })] }, { top: [makePlayer({ uuid: "3" })] }],
      [],
    );
    expect(rosterCapacity(payload)).toEqual({ top: 1, jungle: 1 });
  });
});

describe("a League balance", () => {
  const seat = (uuid: string, ratings: Record<string, number>) =>
    makePlayer({
      uuid,
      role_preferences: Object.keys(ratings),
      all_ratings: ratings,
      assigned_rating: Object.values(ratings)[0],
    });
  const LEAGUE_BUCKETS = ["top", "jungle", "mid", "bot", "support"];

  it("moves a player into a position they can play and re-rates them there", () => {
    const flexTop = seat("a", { top: 2000, jungle: 1900 });
    const payload = makePayload(
      [{ top: [flexTop], jungle: [seat("b", { jungle: 2100 })] }, { top: [seat("c", { top: 2200 })] }],
      LEAGUE_BUCKETS,
    );

    const next = moveBalancePlayer(payload, "a", { kind: "role-container", teamIndex: 1, roleKey: "jungle" });

    expect(next?.teams[1].roster.jungle.map((player) => player.uuid)).toEqual(["a"]);
    expect(next?.teams[1].roster.jungle[0].assigned_rating).toBe(1900);
    expect(next?.teams[0].roster.top).toEqual([]);
  });

  it("rejects a position the player has no rating for", () => {
    const payload = makePayload(
      [{ top: [seat("a", { top: 2000 })], jungle: [seat("b", { jungle: 2100 })] }, { top: [seat("c", { top: 2200 })] }],
      LEAGUE_BUCKETS,
    );

    expect(
      moveBalancePlayer(payload, "a", { kind: "role-container", teamIndex: 1, roleKey: "jungle" }),
    ).toBeNull();
  });

  it("counts a player seated off their first position, on any bucket", () => {
    const payload = makePayload(
      [{ top: [seat("a", { top: 2000 })], jungle: [seat("b", { top: 2100, jungle: 1900 })] }],
      LEAGUE_BUCKETS,
    );

    expect(calculateOffRoleCountFromPayload(payload.teams[0])).toBe(1);
  });
});

describe("balanceBucketKeys", () => {
  const seats = (uuid: string) => [makePlayer({ uuid })];

  it("shows only the buckets some team has seats in, in the owner game's role order", () => {
    // A 1-2-2 shape has no open row; declared order, not the payload's.
    const payload = makePayload([{ support: seats("1"), damage: seats("2"), tank: seats("3") }]);

    expect(balanceBucketKeys(payload, OW_METADATA)).toEqual(["tank", "damage", "support"]);
  });

  it("orders League's positions by its own declaration, an unknown bucket before the open slot", () => {
    const payload = makePayload(
      [{ flex: seats("1"), retired: seats("2"), bot: seats("3"), top: seats("4") }],
      [],
    );

    expect(balanceBucketKeys(payload, LOL_METADATA)).toEqual(["top", "bot", "retired", "flex"]);
  });

  it("keeps the payload's own order, open slot last, while the ontology loads", () => {
    const payload = makePayload([{ flex: seats("1"), bot: seats("2"), top: seats("3") }], []);

    expect(balanceBucketKeys(payload, null)).toEqual(["bot", "top", "flex"]);
  });
});

describe("resolveBalanceDropTarget", () => {
  it("reads a role container id for any game's slot code", () => {
    expect(resolveBalanceDropTarget("1:jungle", null)).toEqual({
      kind: "role-container",
      teamIndex: 1,
      roleKey: "jungle",
    });
    expect(resolveBalanceDropTarget("0:flex", null)).toEqual({
      kind: "role-container",
      teamIndex: 0,
      roleKey: "flex",
    });
  });

  it("does not mistake a row or insert-slot id for a container", () => {
    expect(resolveBalanceDropTarget("player-row:1:jungle:5", null)).toBeNull();
    expect(resolveBalanceDropTarget("player-slot:1:jungle:2", null)).toBeNull();
  });
});

describe("deriveRoleDiscomfort", () => {
  it("returns 0 for a flex player on a playable role", () => {
    const player = makePlayer({ is_flex: true, all_ratings: { tank: 3000, damage: 2900 } });
    expect(deriveRoleDiscomfort(player, "damage")).toBe(0);
  });

  it("returns 0 for the primary role and 100 per preference step", () => {
    const player = makePlayer({
      is_flex: false,
      role_preferences: ["tank", "damage", "support"],
      all_ratings: { tank: 3000, damage: 2900, support: 2800 },
    });
    expect(deriveRoleDiscomfort(player, "tank")).toBe(0);
    expect(deriveRoleDiscomfort(player, "damage")).toBe(100);
    expect(deriveRoleDiscomfort(player, "support")).toBe(200);
  });

  it("returns 1000 for a playable off-preference role, 5000 for an unplayable role", () => {
    const player = makePlayer({
      is_flex: false,
      role_preferences: ["damage"],
      all_ratings: { damage: 2900, support: 2700 },
    });
    expect(deriveRoleDiscomfort(player, "support")).toBe(1000);
    expect(deriveRoleDiscomfort(player, "tank")).toBe(5000);
  });
});

describe("moveBalancePlayer rank + discomfort recompute", () => {
  it("re-rates the player for the new role and keeps original preference order", () => {
    const damage = makePlayer({
      uuid: "50",
      role_preferences: ["damage", "tank"],
      all_ratings: { damage: 2900, tank: 2800 },
      all_discomforts: { damage: 0, tank: 100 },
      assigned_rating: 2900,
      role_discomfort: 0,
    });
    const payload = makePayload([{ tank: [makePlayer({ uuid: "52" })], damage: [damage] }, {}]);
    const target: BalanceDropTarget = { kind: "role-container", teamIndex: 1, roleKey: "tank" };

    const next = moveBalancePlayer(payload, "50", target);
    expect(next).not.toBeNull();
    const moved = next?.teams[1].roster.tank[0];
    expect(moved?.assigned_rating).toBe(2800);
    expect(moved?.role_discomfort).toBe(100);
    // Preferences are NOT reordered (true primary remains first).
    expect(moved?.role_preferences).toEqual(["damage", "tank"]);
    expect(next?.teams[1].average_mmr).toBeCloseTo(2800, 5);
    expect(next?.teams[0].average_mmr).toBeCloseTo(makePlayer().assigned_rating, 5);
  });

  it("derives discomfort when all_discomforts is absent (legacy payload)", () => {
    const damage = makePlayer({
      uuid: "51",
      role_preferences: ["damage"],
      all_ratings: { damage: 2900, tank: 2800 },
      all_discomforts: undefined,
      assigned_rating: 2900,
    });
    const payload = makePayload([{ tank: [makePlayer({ uuid: "53" })], damage: [damage] }, {}]);
    const target: BalanceDropTarget = { kind: "role-container", teamIndex: 1, roleKey: "tank" };

    const next = moveBalancePlayer(payload, "51", target);
    const moved = next?.teams[1].roster.tank[0];
    expect(moved?.assigned_rating).toBe(2800);
    expect(moved?.role_discomfort).toBe(1000); // playable off-preference
  });
});

describe("team variance + discomfort recompute", () => {
  it("computes sample stdev of assigned ratings and discomfort total/max", () => {
    const payload = makePayload([
      {
        tank: [makePlayer({ uuid: "60", assigned_rating: 3000, role_discomfort: 0 })],
        damage: [
          makePlayer({ uuid: "61", assigned_rating: 2800, role_discomfort: 0 }),
          makePlayer({ uuid: "62", assigned_rating: 2600, role_discomfort: 100 }),
        ],
        support: [
          makePlayer({ uuid: "63", assigned_rating: 2700, role_discomfort: 0 }),
          makePlayer({ uuid: "64", assigned_rating: 2500, role_discomfort: 1000 }),
        ],
      },
    ]);
    const team = payload.teams[0];

    // ratings [3000,2800,2600,2700,2500], mean 2720, sample variance 37000 -> stdev ~192.354
    expect(calculateTeamVarianceFromPayload(team)).toBeCloseTo(192.35, 1);

    const discomfort = calculateTeamDiscomfortFromPayload(team);
    expect(discomfort.total).toBe(1100);
    expect(discomfort.max).toBe(1000);
  });

  it("returns 0 variance for a single-player team", () => {
    const payload = makePayload([{ tank: [makePlayer({ uuid: "70", assigned_rating: 3000 })] }]);
    expect(calculateTeamVarianceFromPayload(payload.teams[0])).toBe(0);
  });

  it("counts a player in any bucket of any game", () => {
    const payload = makePayload(
      [{ top: [makePlayer({ uuid: "1", assigned_rating: 1800 })], mid: [makePlayer({ uuid: "2", assigned_rating: 2000 })] }],
      [],
    );
    expect(calculateTeamVarianceFromPayload(payload.teams[0])).toBeCloseTo(141.42, 1);
  });
});
