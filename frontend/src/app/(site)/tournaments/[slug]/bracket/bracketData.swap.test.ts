import { describe, expect, it } from "vitest";

import type { Encounter } from "@/types/encounter.types";

import { swapSlotTeams } from "./bracketData";

interface SeatFixture {
  id: number;
  slot: number;
  team_id: number;
  name: string;
  seed: null;
  score: number;
  placement: null;
  active: boolean;
}

const seat = (id: number, slot: number, name: string): SeatFixture => ({
  id,
  slot,
  team_id: id,
  name,
  seed: null,
  score: 0,
  placement: null,
  active: true
});

const encounter = (id: number, teams: SeatFixture[]) => ({ id, teams }) as unknown as Encounter;

const names = (row: Encounter) => row.teams.map((entry) => `${entry.slot}:${entry.name}`);

describe("swapSlotTeams", () => {
  it("exchanges the teams of two seats in different encounters, each keeping its slot", () => {
    const rows = [
      encounter(1, [seat(1, 1, "A"), seat(2, 2, "B")]),
      encounter(2, [seat(3, 1, "C"), seat(4, 2, "D")])
    ];

    const next = swapSlotTeams(rows, { encounterId: 1, slot: 2 }, { encounterId: 2, slot: 1 });

    expect(names(next[0])).toEqual(["1:A", "2:C"]);
    expect(names(next[1])).toEqual(["1:B", "2:D"]);
  });

  it("flips the two seats of one encounter", () => {
    const rows = [encounter(1, [seat(1, 1, "A"), seat(2, 2, "B")])];

    const next = swapSlotTeams(rows, { encounterId: 1, slot: 1 }, { encounterId: 1, slot: 2 });

    expect(names(next[0])).toEqual(["1:B", "2:A"]);
  });

  it("moves a team into an empty seat and leaves none behind", () => {
    const rows = [encounter(1, [seat(1, 1, "A")]), encounter(2, [seat(2, 2, "B")])];

    const next = swapSlotTeams(rows, { encounterId: 1, slot: 1 }, { encounterId: 2, slot: 1 });

    expect(names(next[0])).toEqual([]);
    expect(names(next[1])).toEqual(["1:A", "2:B"]);
  });
});
