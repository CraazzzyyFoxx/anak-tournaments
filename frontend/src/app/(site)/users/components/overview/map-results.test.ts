import { describe, expect, it } from "vitest";

import { tournamentMapPips } from "@/app/(site)/users/components/overview/map-results";
import type { EncounterWithUserStats } from "@/types/user.types";

/** The viewer's team is `userTeamId`; the log's `home_team_id` is whichever team the uploader listed first. */
const encounter = (
  id: number,
  userTeamId: number,
  homeTeamId: number,
  maps: Array<{ home: number; away: number }>
): EncounterWithUserStats =>
  ({
    id,
    user_team_id: userTeamId,
    teams: [
      { id: id * 100 + 1, slot: 1, team_id: userTeamId, name: "Us", score: 0, placement: null, players: [] },
      { id: id * 100 + 2, slot: 2, team_id: 999, name: "Them", score: 0, placement: null, players: [] }
    ],
    matches: maps.map((score, index) => ({
      id: id * 10 + index,
      home_team_id: homeTeamId,
      score,
      map_id: index + 1
    }))
  }) as EncounterWithUserStats;

describe("tournamentMapPips", () => {
  it("returns null when no maps were recorded", () => {
    expect(tournamentMapPips([encounter(1, 1, 1, [])], 7)).toBeNull();
  });

  it("keeps series order and reads scores from the viewer's side", () => {
    const pips = tournamentMapPips(
      [
        encounter(1, 10, 10, [
          { home: 2, away: 0 },
          { home: 0, away: 1 }
        ]),
        encounter(2, 10, 999, [{ home: 1, away: 1 }, { home: 0, away: 2 }])
      ],
      7
    );
    expect(pips).toEqual(["win", "loss", "draw", "win"]);
  });
});
