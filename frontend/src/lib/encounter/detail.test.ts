import { describe, expect, it } from "vitest";

import type { Encounter, Match } from "@/types/encounter.types";
import {
  buildSeriesSlots,
  countMapWins,
  encounterSeatScore,
  formatCloseness,
  formatSeriesClock,
  getSeriesSeconds,
  getSeriesVerdict
} from "@/lib/encounter/detail";
import { duelWinner } from "@/lib/encounter/seats";

/** The encounter's two seats (participations 1 and 2, teams 1 and 2), with a standing each. */
function duelOf(scoreOne: number, scoreTwo: number): Encounter["teams"] {
  return [
    { id: 1, slot: 1, team_id: 1, name: "A", seed: null, score: scoreOne, placement: null, active: true },
    { id: 2, slot: 2, team_id: 2, name: "B", seed: null, score: scoreTwo, placement: null, active: true }
  ];
}

/** A parsed map: participations 1 and 2 (the encounter's seats) with the log's observed scores, `time` seconds long. */
function match(id: number, home: number, away: number, time: number | null = 600): Match {
  return {
    id,
    created_at: "1970-01-01T00:00:00Z",
    updated_at: null,
    played_at: null,
    workspace_id: 1,
    discipline: "overwatch",
    encounter_id: 10,
    encounter_game_id: null,
    map_index: id,
    map_id: id,
    map: null,
    encounter: null,
    duration_s: time,
    log_name: null,
    raw_status: null,
    raw_available: false,
    participants: [
      { encounter_team_id: 1, slot: 1, source_position: 0, tournament_team_id: 1, name: "A", result: null, team_facts: { score: home } },
      { encounter_team_id: 2, slot: 2, source_position: 1, tournament_team_id: 2, name: "B", result: null, team_facts: { score: away } }
    ]
  };
}

function encounter(overrides: Partial<Encounter> = {}): Encounter {
  return {
    id: 10,
    created_at: new Date(0),
    updated_at: null,
    name: "A vs B",
    slot_count: 2,
    scoring_preset: "wins",
    round: 1,
    best_of: 5,
    tournament_id: 3,
    stage_id: null,
    stage_item_id: null,
    challonge_id: null,
    status: "completed",
    closeness: null,
    has_logs: false,
    result_status: "none",
    scheduled_at: null,
    started_at: null,
    ended_at: null,
    current_map_index: null,
    confirmed_at: null,
    result_source: null,
    result_version: 0,
    matches: [],
    games: [],
    teams: duelOf(0, 0),
    tournament: {} as Encounter["tournament"],
    ...overrides
  };
}

describe("duelWinner", () => {
  it("names the higher score's slot and treats a level map as drawn", () => {
    expect(duelWinner({ one: 2, two: 1 })).toBe(1);
    expect(duelWinner({ one: 1, two: 2 })).toBe(2);
    expect(duelWinner({ one: 1, two: 1 })).toBeNull();
  });
});

describe("parsed scores from the encounter's seats", () => {
  // The lobby put the encounter's slot-2 team first: the log lists participation 2 first.
  const flipped = (id: number, home: number, away: number): Match => {
    const base = match(id, away, home);
    // Participation 2 is listed first and scored `home`; participation 1 scored `away`.
    return { ...base, participants: [...base.participants].reverse().map((p, i) => ({ ...p, source_position: i })) };
  };

  it("turns a log recorded with the sides flipped around", () => {
    expect(encounterSeatScore(flipped(1, 0, 3), encounter())).toEqual({ one: 3, two: 0 });
  });

  it("counts a flipped log's map for the seat that actually won it", () => {
    expect(
      countMapWins(encounter({ matches: [flipped(1, 0, 3), match(2, 2, 1), flipped(3, 2, 1)] }))
    ).toEqual({ one: 2, two: 1, drawn: 0 });
  });
});

describe("buildSeriesSlots", () => {
  it("pads unplayed slots up to the format so a 3-0 Bo5 still shows five", () => {
    const slots = buildSeriesSlots(
      encounter({ best_of: 5, matches: [match(1, 2, 0), match(2, 2, 1), match(3, 3, 2)] })
    );
    expect(slots).toHaveLength(5);
    expect(slots.map((slot) => slot.index)).toEqual([1, 2, 3, 4, 5]);
    expect(slots.slice(0, 3).map((slot) => slot.parsedScore)).toEqual([
      { one: 2, two: 0 }, { one: 2, two: 1 }, { one: 3, two: 2 }
    ]);
    expect(slots.every((slot) => slot.winner === null)).toBe(true);
    expect(slots[3].match).toBeNull();
    expect(slots[4].match).toBeNull();
  });

  it("never truncates maps that exceed the declared format", () => {
    const slots = buildSeriesSlots(
      encounter({ best_of: 1, matches: [match(1, 2, 0), match(2, 0, 2), match(3, 2, 1)] })
    );
    expect(slots).toHaveLength(3);
    expect(slots.every((slot) => slot.match !== null)).toBe(true);
  });

  it("does not create slots from the array order or count of unbound history", () => {
    const matches = [7, 8, 9].map((id) => ({
      ...match(id, 2, 1),
      map_id: 21,
      map_index: null
    }));
    const value = encounter({ best_of: 1, matches });
    const slots = buildSeriesSlots(value);
    expect(slots).toHaveLength(1);
    expect(slots[0].match).toBeNull();
    expect(countMapWins(value)).toEqual({ one: 3, two: 0, drawn: 0 });
    expect(getSeriesSeconds(value)).toBe(1800);
    expect(value.matches.map((row) => row.id)).toEqual([7, 8, 9]);
  });

  it("keeps sparse proven positions without filling gaps from historical rows", () => {
    const slots = buildSeriesSlots(encounter({
      best_of: 1,
      matches: [
        { ...match(7, 2, 1), map_id: 21, map_index: null },
        { ...match(8, 1, 2), map_id: 21, map_index: 3 }
      ]
    }));
    expect(slots.map((slot) => slot.match?.id)).toEqual([undefined, undefined, 8]);
  });

  it("marks the live map only while the series is unfinished", () => {
    const live = buildSeriesSlots(
      encounter({
        status: "pending",
        current_map_index: 1,
        matches: [match(1, 2, 0), match(2, 0, 0)]
      })
    );
    expect(live.map((slot) => slot.isLive)).toEqual([false, true, false, false, false]);

    const done = buildSeriesSlots(
      encounter({ status: "completed", current_map_index: 1, matches: [match(1, 2, 0)] })
    );
    expect(done.some((slot) => slot.isLive)).toBe(false);
  });

  it("attaches the parsed log to the position it names, and scores from the game", () => {
    // Two contracts for one position: the accepted score decides the map, the
    // parsed log is a separate fact — and a series that plays one map twice
    // would otherwise print the first play's log on the second.
    const slots = buildSeriesSlots(
      encounter({
        best_of: 3,
        matches: [
          { ...match(7, 9, 9), map_id: 21, map_index: 2 },
          { ...match(8, 9, 9), map_id: 21, map_index: 1 },
          { ...match(9, 2, 1), map_id: 21, map_index: null },
          { ...match(10, 1, 2), map_id: 21, map_index: null }
        ],
        games: [
          {
            id: 1,
            position: 1,
            map_id: 21,
            map: null,
            state: "confirmed",
            result_source: "captain_agreement",
            result_version: 1,
            confirmed_at: null,
            teams: [
              { encounter_team_id: 1, score: 2, placement: null, column_values: {}, starting_side: null, replay_code: null },
              { encounter_team_id: 2, score: 1, placement: null, column_values: {}, starting_side: null, replay_code: null }
            ]
          },
          {
            id: 2,
            position: 2,
            map_id: 21,
            map: null,
            state: "awaiting_result",
            result_source: null,
            result_version: 1,
            confirmed_at: null,
            teams: []
          }
        ]
      })
    );
    expect(slots.map((slot) => slot.match?.id)).toEqual([8, 7, undefined]);
    // The 9:9 logs decide nothing: only the game's accepted score does.
    expect(slots.map((slot) => slot.winner)).toEqual([1, null, null]);
  });

  it("keeps the map of a position that has no parsed log yet", () => {
    // A picked position names its map long before a log exists, so the row can
    // still be titled and pictured.
    const slots = buildSeriesSlots(
      encounter({
        best_of: 1,
        matches: [],
        games: [
          {
            id: 1,
            position: 1,
            map_id: 21,
            map: { id: 21, name: "Ilios", image_path: "/ilios.jpg" } as Encounter["games"][number]["map"],
            state: "awaiting_result",
            result_source: null,
            result_version: 0,
            confirmed_at: null,
            teams: []
          }
        ]
      })
    );
    expect(slots[0].match).toBeNull();
    expect(slots[0].game?.map?.name).toBe("Ilios");
  });
});

describe("countMapWins", () => {
  it("counts wins per seat and drawn maps separately", () => {
    expect(
      countMapWins(encounter({ matches: [match(1, 2, 0), match(2, 1, 2), match(3, 1, 1)] }))
    ).toEqual({ one: 1, two: 1, drawn: 1 });
  });
});

describe("getSeriesVerdict", () => {
  it("withholds a winner until the series is completed", () => {
    expect(getSeriesVerdict(encounter({ status: "pending", teams: duelOf(1, 0) }))).toEqual(
      {
        outcome: "unplayed",
        winner: null,
        loser: null
      }
    );
  });

  it("names winner and loser once completed", () => {
    expect(getSeriesVerdict(encounter({ teams: duelOf(3, 1) }))).toEqual({
      outcome: "win",
      winner: 1,
      loser: 2
    });
    expect(getSeriesVerdict(encounter({ teams: duelOf(1, 3) }))).toEqual({
      outcome: "win",
      winner: 2,
      loser: 1
    });
  });

  it("reports a completed level series as a draw", () => {
    expect(getSeriesVerdict(encounter({ teams: duelOf(2, 2) })).outcome).toBe("draw");
  });
});

describe("getSeriesSeconds", () => {
  it("sums reported map times and returns null when none reported", () => {
    expect(
      getSeriesSeconds(encounter({ matches: [match(1, 2, 0, 600), match(2, 2, 1, 725)] }))
    ).toBe(1325);
    expect(
      getSeriesSeconds(encounter({ matches: [match(1, 2, 0, null), match(2, 2, 1, null)] }))
    ).toBeNull();
    expect(getSeriesSeconds(encounter({ matches: [] }))).toBeNull();
  });
});

describe("formatSeriesClock", () => {
  const units = { h: "h", m: "m", s: "s" };

  it("scales the unit set to the magnitude and zero-pads the tail", () => {
    expect(formatSeriesClock(48, units)).toBe("48s");
    expect(formatSeriesClock(725, units)).toBe("12m 05s");
    expect(formatSeriesClock(3870, units)).toBe("1h 04m 30s");
  });

  it("uses the caller's localized units", () => {
    expect(formatSeriesClock(725, { h: "ч", m: "м", s: "с" })).toBe("12м 05с");
  });

  it("returns null for absent or non-positive input", () => {
    expect(formatSeriesClock(null, units)).toBeNull();
    expect(formatSeriesClock(0, units)).toBeNull();
    expect(formatSeriesClock(Number.NaN, units)).toBeNull();
  });
});

describe("formatCloseness", () => {
  it("renders the 0..1 fraction as whole percent", () => {
    expect(formatCloseness(0.72)).toBe("72%");
    expect(formatCloseness(0)).toBe("0%");
    expect(formatCloseness(null)).toBeNull();
  });
});
