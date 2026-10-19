import { describe, expect, it } from "vitest";

import type { EncounterWithUserStats } from "@/types/user.types";

import { encounterPerspective, mapKind } from "./encounter-perspective";

interface SeatFixture {
  id: number;
  slot: number;
  team_id: number | null;
  name: string;
  score: number;
  placement: null;
  players: { id: number; user_id: number; role: null; name: string }[];
}

const seat = (slot: number, teamId: number | null, score: number, userIds: number[] = []): SeatFixture => ({
  id: slot,
  slot,
  team_id: teamId,
  name: `T${slot}`,
  score,
  placement: null,
  players: userIds.map((userId) => ({ id: userId, user_id: userId, role: null, name: `P${userId}` }))
});

const encounter = (teams: SeatFixture[], userTeamId: number | null = null) =>
  ({ teams, user_team_id: userTeamId }) as unknown as EncounterWithUserStats;

describe("encounterPerspective", () => {
  it("finds the viewer's seat by the source team, in any slot", () => {
    const view = encounterPerspective(encounter([seat(1, 10, 0), seat(2, 20, 2)]), 7, 20);

    expect(view.own?.slot).toBe(2);
    expect(view.opponent?.slot).toBe(1);
    expect([view.userScore, view.oppScore, view.kind]).toEqual([2, 0, "win"]);
  });

  it("prefers the explicit team over the read's user_team_id, then falls back to the roster", () => {
    const rows = [seat(1, 10, 1, [7]), seat(2, 20, 3)];

    expect(encounterPerspective(encounter(rows, 20), 7, 10).own?.slot).toBe(1);
    expect(encounterPerspective(encounter(rows, 20), 7).own?.slot).toBe(2);
    expect(encounterPerspective(encounter(rows), 7).own?.slot).toBe(1);
  });

  it("reads a drawn series as a draw", () => {
    expect(encounterPerspective(encounter([seat(1, 10, 1), seat(2, 20, 1)]), 7, 10).kind).toBe("draw");
  });
});

describe("mapKind", () => {
  const participant = (encounter_team_id: number, score?: number) => ({
    encounter_team_id,
    team_facts: score == null ? {} : { score }
  });
  const logOf = (...participants: ReturnType<typeof participant>[]) =>
    ({ participants }) as unknown as Parameters<typeof mapKind>[0];

  it("reads the viewer's own participation, whichever side the log listed first", () => {
    const own = seat(2, 20, 0);

    expect(mapKind(logOf(participant(2, 3), participant(1, 1)), own)).toBe("win");
    expect(mapKind(logOf(participant(1, 3), participant(2, 1)), own)).toBe("loss");
    expect(mapKind(logOf(participant(1, 2), participant(2, 2)), own)).toBe("draw");
  });

  it("compares against the best of several opponents", () => {
    expect(mapKind(logOf(participant(1, 2), participant(2, 3), participant(3, 5)), seat(2, 20, 0))).toBe("loss");
  });

  it("is a draw when the viewer has no seat in the match or a score was not recorded", () => {
    expect(mapKind(logOf(participant(1, 3), participant(2, 1)), null)).toBe("draw");
    expect(mapKind(logOf(participant(1, 3), participant(2)), seat(1, 10, 0))).toBe("draw");
  });
});
