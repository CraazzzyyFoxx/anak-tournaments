import { describe, expect, it } from "vitest";

import type { Encounter } from "@/types/encounter.types";
import { getEncounterState, getEncounterWinner } from "@/lib/encounter/status";
import { formatterFor } from "@/lib/datetime/formatter";
import {
  aggregateFilters,
  DEFAULT_FILTERS,
  filtersToApiFilters,
  filtersToSearchParams,
  formatSeriesLength,
  hasActiveFilters,
  readEncountersUrl,
  savedViewState
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
    workspace_id: 1,
    discipline: "overwatch",
    name: "A vs B",
    slot_count: 2,
    scoring_preset: "wins",
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
    is_final: false,
    matches: [],
    games: [],
    teams: seats(0, 0),
    tournament: null as never,
    stage: null,
    stage_item: null,
    ...overrides
  };
}

describe("the encounters URL", () => {
  it("reads filters, page and view, ignoring what it does not know", () => {
    expect(
      readEncountersUrl({
        search: "final",
        best_of: "5",
        has_logs: "true",
        is_upset: "true",
        is_final: "false",
        scope: "my_team",
        sort: "closeness",
        page: "3",
        view: "insights",
        status: "bogus",
        utm_source: "x"
      })
    ).toEqual({
      page: 3,
      view: "insights",
      filters: {
        ...DEFAULT_FILTERS,
        query: "final",
        best_of: 5,
        has_logs: true,
        is_upset: true,
        scope: "my_team",
        sort: "closeness"
      }
    });
    expect(readEncountersUrl({ page: "-2", view: "grid" })).toEqual({ page: 1, view: "list", filters: DEFAULT_FILTERS });
  });

  it("lands old links on the «Предстоят» segment: the retired upcoming sort and the open/pending chips", () => {
    expect(readEncountersUrl({ sort: "upcoming" }).filters).toEqual({ ...DEFAULT_FILTERS, status: "upcoming" });
    expect(readEncountersUrl({ status: "open" }).filters.status).toBe("upcoming");
    expect(readEncountersUrl({ status: "pending" }).filters.status).toBe("upcoming");
    // An explicit segment wins over the retired sort.
    expect(readEncountersUrl({ status: "completed", sort: "upcoming" }).filters.status).toBe("completed");
  });

  it("writes only what differs from the defaults, the view last", () => {
    const params = filtersToSearchParams(
      { ...DEFAULT_FILTERS, query: "wis", best_of: 5, is_final: true, status: "live" },
      3,
      "insights"
    );
    expect(params.toString()).toBe("search=wis&page=3&best_of=5&status=live&is_final=true&view=insights");
    expect(filtersToSearchParams(DEFAULT_FILTERS, 1, "list").toString()).toBe("");
  });
});

describe("the encounters reads", () => {
  it("orders by the sort select, except «Предстоят», which always reads soonest first", () => {
    const order = (filters: Partial<typeof DEFAULT_FILTERS>) => {
      const { sort, order: direction } = filtersToApiFilters({ ...DEFAULT_FILTERS, ...filters });
      return [sort, direction];
    };
    expect(order({ sort: "date" })).toEqual(["played_at", "desc"]);
    expect(order({ sort: "closeness" })).toEqual(["closeness", "desc"]);
    expect(order({ sort: "closeness", status: "upcoming" })).toEqual(["scheduled_at", "asc"]);
  });

  it("asks the aggregates only what narrows, so no filters is the hero's request", () => {
    expect(aggregateFilters({ ...DEFAULT_FILTERS, sort: "closeness" })).toEqual({});
    expect(aggregateFilters({ ...DEFAULT_FILTERS, status: "live", is_upset: true, scope: "my_team" })).toEqual({
      status: "live",
      is_upset: true,
      scope: "my_team"
    });
  });

  it("reads a saved view the way it reads a URL, an old upcoming sort included", () => {
    expect(savedViewState({ query: "cup", best_of: 3, has_logs: false, sort: "upcoming" as never })).toEqual({
      ...DEFAULT_FILTERS,
      query: "cup",
      best_of: 3,
      status: "upcoming"
    });
  });

  it("counts the status as narrowing, the order not", () => {
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, sort: "closeness" })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, status: "completed" })).toBe(true);
  });
});

describe("encounter state", () => {
  it("labels live, upcoming, and final encounters", () => {
    const now = new Date("2026-05-18T12:00:00Z");

    expect(getEncounterState(encounter({ is_live: true }), now)).toBe("Live");
    // Live is the server's call: a start stamp alone does not make one.
    expect(getEncounterState(encounter({ started_at: "2026-05-18T11:00:00Z" }), now)).toBe("Open");
    expect(getEncounterState(encounter({ scheduled_at: "2026-05-18T13:00:00Z" }), now)).toBe("Upcoming");
    expect(getEncounterState(encounter({ status: "completed" }), now)).toBe("Final");
  });

  it("resolves a winner only once the series is completed", () => {
    expect(getEncounterWinner(encounter({ teams: seats(2, 1) }))).toBeNull();
    expect(getEncounterWinner(encounter({ status: "completed", teams: seats(2, 1) }))).toBe(1);
    expect(getEncounterWinner(encounter({ status: "completed", teams: seats(1, 2) }))).toBe(2);
    expect(getEncounterWinner(encounter({ status: "completed", teams: seats(2, 2) }))).toBeNull();
  });
});

it("states a series length in the locale's own units", () => {
  expect(formatSeriesLength(formatterFor("en", "UTC"), 2520)).toBe("42 min");
  expect(formatSeriesLength(formatterFor("en", "UTC"), 4500)).toBe("1.3 hr");
  expect(formatSeriesLength(formatterFor("ru", "UTC"), 2520)).toBe("42 мин");
});
