import { describe, expect, it } from "vitest";

import type { Encounter, Match, MatchWithStats } from "@/types/encounter.types";
import type { PlayerWithStats, TeamWithStats } from "@/types/team.types";
import { LogStatsName } from "@/types/stats.types";
import {
  aggregateSeriesStats,
  buildSeriesSlots,
  countMapWins,
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

function match(id: number, home: number, away: number, time: number | null = 600): Match {
  return {
    id,
    created_at: new Date(0),
    updated_at: null,
    home_team_id: 1,
    away_team_id: 2,
    score: { home, away },
    time,
    encounter_id: 10,
    map_id: id,
    log_name: null,
    source: "log_parser",
    code: null,
    map: null,
    home_team: null,
    away_team: null,
    encounter: null
  };
}

function encounter(overrides: Partial<Encounter> = {}): Encounter {
  return {
    id: 10,
    created_at: new Date(0),
    updated_at: null,
    name: "A vs B",
    slot_count: 2,
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
  // The lobby put the encounter's slot-2 team first: the log's home is team 2.
  const flipped = (id: number, home: number, away: number): Match => ({
    ...match(id, home, away),
    home_team_id: 2,
    away_team_id: 1
  });

  it("turns a log recorded with the sides flipped around", () => {
    const slots = buildSeriesSlots(encounter({ best_of: 1, matches: [flipped(1, 0, 3)] }));
    expect(slots[0].parsedScore).toEqual({ one: 3, two: 0 });
    expect(slots[0].winner).toBe(1);
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
    expect(slots.slice(0, 3).map((slot) => slot.winner)).toEqual([1, 1, 1]);
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
          { ...match(8, 9, 9), map_id: 21, map_index: 1 }
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

// ─── aggregateSeriesStats ───────────────────────────────────────────────────

function player(
  id: number,
  stats: Partial<Record<LogStatsName, number>>,
  heroIds: number[]
): PlayerWithStats {
  return {
    id,
    created_at: new Date(0),
    updated_at: null,
    name: `P${id}#1`,
    rank: 3000,
    division: 3,
    role: { dimension: "player_role", role: "damage" },
    tournament_id: 3,
    user_id: id,
    team_id: 1,
    is_newcomer: false,
    is_newcomer_role: false,
    is_substitution: false,
    related_player_id: null,
    user: null,
    stats: { 0: stats } as PlayerWithStats["stats"],
    heroes: { 0: heroIds.map((heroId) => ({ id: heroId })) } as unknown as PlayerWithStats["heroes"]
  } as PlayerWithStats;
}

function team(id: number, name: string, players: PlayerWithStats[]): TeamWithStats {
  return {
    id,
    created_at: new Date(0),
    updated_at: null,
    name,
    avg_sr: 3000,
    total_sr: 15000,
    captain_id: null,
    tournament_id: 3,
    players,
    tournament: null,
    placement: null,
    group: null
  } as unknown as TeamWithStats;
}

function statMatch(
  id: number,
  home: TeamWithStats,
  away: TeamWithStats,
  score = { home: 2, away: 1 }
): MatchWithStats {
  return { ...match(id, score.home, score.away), rounds: 1, home_team: home, away_team: away };
}

describe("aggregateSeriesStats", () => {
  it("sums additive stats across maps and counts maps played per player", () => {
    const mapOne = statMatch(
      1,
      team(1, "A", [
        player(11, { [LogStatsName.Eliminations]: 10, [LogStatsName.Deaths]: 2 }, [100])
      ]),
      team(2, "B", [player(21, { [LogStatsName.Eliminations]: 4 }, [200])])
    );
    const mapTwo = statMatch(
      2,
      team(1, "A", [
        player(11, { [LogStatsName.Eliminations]: 6, [LogStatsName.Deaths]: 3 }, [101])
      ]),
      team(2, "B", [player(21, { [LogStatsName.Eliminations]: 5 }, [200])])
    );

    const result = aggregateSeriesStats([mapOne, mapTwo], { teams: duelOf(0, 0) });
    expect(result).not.toBeNull();
    const row = result!.one.players[0].stats[0];
    expect(row[LogStatsName.Eliminations]).toBe(16);
    expect(row[LogStatsName.Deaths]).toBe(5);
    expect(result!.meta[11].mapsPlayed).toBe(2);
    expect(result!.mapsCounted).toBe(2);
    expect(result!.round).toBe(0);
  });

  it("unions heroes across maps without duplicating a repeated pick", () => {
    const result = aggregateSeriesStats(
      [
        statMatch(
          1,
          team(1, "A", [player(11, {}, [100, 101])]),
          team(2, "B", [player(21, {}, [200])])
        ),
        statMatch(
          2,
          team(1, "A", [player(11, {}, [101, 102])]),
          team(2, "B", [player(21, {}, [200])])
        )
      ],
      { teams: duelOf(0, 0) }
    );
    const heroes = result!.one.players[0].heroes[0] as { id: number }[];
    expect(heroes.map((hero) => hero.id).sort()).toEqual([100, 101, 102]);
  });

  it("recomputes ratio stats from summed components rather than averaging maps", () => {
    // Map 1: 10 elims / 2 deaths (kd 5). Map 2: 0 elims / 8 deaths (kd 0).
    // Averaging per-map kd gives 2.5; the series truth is 10/10 = 1.
    const result = aggregateSeriesStats(
      [
        statMatch(
          1,
          team(1, "A", [
            player(
              11,
              {
                [LogStatsName.Eliminations]: 10,
                [LogStatsName.Deaths]: 2,
                [LogStatsName.Assists]: 4,
                [LogStatsName.KD]: 5
              },
              [100]
            )
          ]),
          team(2, "B", [player(21, {}, [200])])
        ),
        statMatch(
          2,
          team(1, "A", [
            player(
              11,
              {
                [LogStatsName.Eliminations]: 0,
                [LogStatsName.Deaths]: 8,
                [LogStatsName.Assists]: 2,
                [LogStatsName.KD]: 0
              },
              [100]
            )
          ]),
          team(2, "B", [player(21, {}, [200])])
        )
      ],
      { teams: duelOf(0, 0) }
    );
    const row = result!.one.players[0].stats[0];
    expect(row[LogStatsName.KD]).toBe(1);
    expect(row[LogStatsName.KDA]).toBeCloseTo(1.6, 5);
  });

  it("keeps the best single-map multikill instead of summing it", () => {
    const result = aggregateSeriesStats(
      [
        statMatch(
          1,
          team(1, "A", [player(11, { [LogStatsName.MultikillBest]: 4 }, [100])]),
          team(2, "B", [player(21, {}, [200])])
        ),
        statMatch(
          2,
          team(1, "A", [player(11, { [LogStatsName.MultikillBest]: 3 }, [100])]),
          team(2, "B", [player(21, {}, [200])])
        )
      ],
      { teams: duelOf(0, 0) }
    );
    expect(result!.one.players[0].stats[0][LogStatsName.MultikillBest]).toBe(4);
  });

  it("derives accuracy from shot counts and omits it when nothing was fired", () => {
    const result = aggregateSeriesStats(
      [
        statMatch(
          1,
          team(1, "A", [
            player(
              11,
              {
                [LogStatsName.ShotsFired]: 100,
                [LogStatsName.ShotsHit]: 40,
                [LogStatsName.CriticalHits]: 10
              },
              [100]
            ),
            player(12, { [LogStatsName.Eliminations]: 3 }, [110])
          ]),
          team(2, "B", [player(21, {}, [200])])
        ),
        statMatch(
          2,
          team(1, "A", [
            player(11, { [LogStatsName.ShotsFired]: 100, [LogStatsName.ShotsHit]: 20 }, [100]),
            player(12, { [LogStatsName.Eliminations]: 2 }, [110])
          ]),
          team(2, "B", [player(21, {}, [200])])
        )
      ],
      { teams: duelOf(0, 0) }
    );
    const shooter = result!.one.players.find((entry) => entry.id === 11)!.stats[0];
    const abstainer = result!.one.players.find((entry) => entry.id === 12)!.stats[0];
    expect(shooter[LogStatsName.WeaponAccuracy]).toBeCloseTo(0.3, 5);
    expect(shooter[LogStatsName.CriticalHitAccuracy]).toBeCloseTo(10 / 60, 5);
    expect(abstainer[LogStatsName.WeaponAccuracy]).toBeUndefined();
  });

  it("drops model-only stats no series value can be derived for", () => {
    const result = aggregateSeriesStats(
      [
        statMatch(
          1,
          team(1, "A", [
            player(11, { [LogStatsName.ImpactPoints]: 42, [LogStatsName.ImpactRank]: 1 }, [100])
          ]),
          team(2, "B", [player(21, {}, [200])])
        )
      ],
      { teams: duelOf(0, 0) }
    );
    const row = result!.one.players[0].stats[0];
    expect(row[LogStatsName.ImpactPoints]).toBeUndefined();
    expect(row[LogStatsName.ImpactRank]).toBeUndefined();
  });

  it("ranks series MVPs across both rosters by summed performance points", () => {
    const strong = player(11, { [LogStatsName.Eliminations]: 30 }, [100]);
    const weak = player(12, { [LogStatsName.Eliminations]: 1 }, [110]);
    const middle = player(21, { [LogStatsName.Eliminations]: 10 }, [200]);
    const result = aggregateSeriesStats(
      [statMatch(1, team(1, "A", [strong, weak]), team(2, "B", [middle]))],
      { teams: duelOf(0, 0) }
    );
    expect(result!.meta[11].seriesPlacement).toBe(1);
    expect(result!.meta[21].seriesPlacement).toBe(2);
    expect(result!.meta[12].seriesPlacement).toBe(3);
    expect(
      result!.one.players.find((entry) => entry.id === 11)!.stats[0][LogStatsName.Performance]
    ).toBe(1);
  });

  it("assigns sides by team id even when a map records them flipped", () => {
    const home = team(1, "A", [player(11, { [LogStatsName.Eliminations]: 7 }, [100])]);
    const away = team(2, "B", [player(21, { [LogStatsName.Eliminations]: 3 }, [200])]);
    const result = aggregateSeriesStats([statMatch(1, home, away), statMatch(2, away, home)], {
      teams: duelOf(0, 0)
    });
    expect(result!.one.name).toBe("A");
    expect(result!.one.players[0].stats[0][LogStatsName.Eliminations]).toBe(14);
    expect(result!.two.players[0].stats[0][LogStatsName.Eliminations]).toBe(6);
  });

  it("does not count a rostered player who never fielded a hero as having played", () => {
    const result = aggregateSeriesStats(
      [
        statMatch(
          1,
          team(1, "A", [player(11, { [LogStatsName.Eliminations]: 5 }, [100]), player(12, {}, [])]),
          team(2, "B", [player(21, {}, [200])])
        )
      ],
      { teams: duelOf(0, 0) }
    );
    expect(result!.meta[11].mapsPlayed).toBe(1);
    expect(result!.meta[12].mapsPlayed).toBe(0);
    expect(result!.meta[12].seriesPlacement).toBeNull();
  });

  it("returns null when neither side of the encounter appears in the loaded maps", () => {
    const result = aggregateSeriesStats(
      [statMatch(1, team(7, "X", [player(11, {}, [100])]), team(8, "Y", [player(21, {}, [200])]))],
      { teams: duelOf(0, 0) }
    );
    expect(result).toBeNull();
  });
});
