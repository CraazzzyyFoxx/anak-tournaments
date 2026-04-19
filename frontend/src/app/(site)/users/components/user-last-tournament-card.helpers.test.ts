import { describe, expect, it } from "bun:test";

import { getLastTournamentGridVersion } from "@/app/(site)/users/components/user-last-tournament-card.helpers";
import type { DivisionGridVersion } from "@/types/workspace.types";
import type { Tournament } from "@/types/tournament.types";

const buildTournament = (
  id: number,
  divisionGridVersion: DivisionGridVersion | null
): Tournament =>
  ({
    id,
    division_grid_version: divisionGridVersion
  }) as Tournament;

describe("getLastTournamentGridVersion", () => {
  it("returns the selected tournament grid version instead of falling back to another source", () => {
    const targetGridVersion = {
      id: 77,
      tiers: [
        {
          number: 4,
          name: "Division 4",
          rank_min: 1200,
          rank_max: 1299,
          icon_url: "https://example.com/division-4.png"
        }
      ]
    } as DivisionGridVersion;

    const tournaments = [
      buildTournament(10, null),
      buildTournament(11, targetGridVersion)
    ];

    expect(getLastTournamentGridVersion(11, tournaments)).toBe(targetGridVersion);
  });

  it("returns null when the selected tournament has no division grid version", () => {
    const tournaments = [buildTournament(11, null)];

    expect(getLastTournamentGridVersion(11, tournaments)).toBeNull();
  });
});
