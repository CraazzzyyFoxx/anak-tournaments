import { describe, expect, it } from "vitest";

import type { Encounter } from "@/types/encounter.types";
import { getEncounterState, getEncounterWinner } from "@/lib/encounter/status";
import {
  DEFAULT_FILTERS,
  filtersToApiFilters,
  filtersToSearchParams,
  formatDuration,
  normalizeEncounterFilters,
} from "./encounters.helpers";

function seats(one: number, two: number): Encounter["teams"] {
  return [
    { id: 1, slot: 1, team_id: 1, name: "A", seed: null, score: one, placement: null, active: true },
    { id: 2, slot: 2, team_id: 2, name: "B", seed: null, score: two, placement: null, active: true }
  ];
}

function encounter(overrides: Partial<Encounter>): Encounter {
  return {
    id: 1,
    created_at: new Date("2026-05-01T12:00:00Z"),
    updated_at: null,
    name: "A vs B",
    slot_count: 2,
    round: 1,
    best_of: 3,
    tournament_id: 1,
    stage_id: null,
    stage_item_id: null,
    challonge_id: null,
    status: "open",
    closeness: null,
    has_logs: false,
    result_status: "none",
    result_source: null,
    result_version: 0,
    scheduled_at: null,
    started_at: null,
    ended_at: null,
    current_map_index: null,
    confirmed_at: null,
    played_at: null,
    is_live: false,
    matches: [],
    games: [],
    teams: seats(0, 0),
    tournament: null as never,
    stage: null,
    stage_item: null,
    ...overrides,
  };
}

describe("encounters helpers", () => {
  it("normalizes URL filters with stable defaults", () => {
    expect(
      normalizeEncounterFilters({
        search: "final",
        best_of: "5",
        has_logs: "true",
        scope: "my_team",
        sort: "closeness",
      }),
    ).toEqual({
      ...DEFAULT_FILTERS,
      query: "final",
      best_of: 5,
      has_logs: true,
      scope: "my_team",
      sort: "closeness",
    });
  });

  it("serializes only non-default query parameters", () => {
    const params = filtersToSearchParams(
      {
        ...DEFAULT_FILTERS,
        query: "wis",
        best_of: 5,
        has_logs: true,
      },
      3,
    );

    expect(params.toString()).toBe("search=wis&page=3&best_of=5&has_logs=true");
  });

  it("maps UI sort keys to backend sort columns, each in its own direction", () => {
    const api = (sort: (typeof DEFAULT_FILTERS)["sort"]) => {
      const { sort: column, order } = filtersToApiFilters({ ...DEFAULT_FILTERS, sort });
      return [column, order];
    };
    expect(api("date")).toEqual(["played_at", "desc"]);
    expect(api("closeness")).toEqual(["closeness", "desc"]);
    expect(api("upcoming")).toEqual(["scheduled_at", "asc"]);
  });

  it("labels live, upcoming, and final encounters", () => {
    const now = new Date("2026-05-18T12:00:00Z");

    expect(getEncounterState(encounter({ is_live: true }), now)).toBe("Live");
    // Live is the server's call: a start stamp alone does not make one.
    expect(getEncounterState(encounter({ started_at: "2026-05-18T11:00:00Z" }), now)).toBe("Open");
    expect(getEncounterState(encounter({ scheduled_at: "2026-05-18T13:00:00Z" }), now)).toBe(
      "Upcoming"
    );
    expect(getEncounterState(encounter({ status: "completed" }), now)).toBe("Final");
  });

  it("resolves a winner only once the series is completed", () => {
    expect(getEncounterWinner(encounter({ teams: seats(2, 1) }))).toBeNull();
    expect(getEncounterWinner(encounter({ status: "completed", teams: seats(2, 1) }))).toBe(1);
    expect(getEncounterWinner(encounter({ status: "completed", teams: seats(1, 2) }))).toBe(2);
    expect(getEncounterWinner(encounter({ status: "completed", teams: seats(2, 2) }))).toBeNull();
  });

  it("formats aggregate seconds for pulse cards", () => {
    expect(formatDuration(2520)).toBe("42m");
    expect(formatDuration(4500)).toBe("1h 15m");
  });
});
