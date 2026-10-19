import { describe, expect, it } from "vitest";

import type { StatDefinition } from "@/types/discipline.types";
import type { MatchWithStats, NativeFact } from "@/types/encounter.types";

import { buildMatchTable, buildSeriesTable, matchSegments } from "./table";

const def = (
  code: string,
  aggregation: string,
  sort_order: number,
  active = true
): StatDefinition =>
  ({
    id: sort_order,
    code,
    name: code,
    value_format: "integer",
    aggregation,
    group: null,
    active,
    sort_order
  }) as StatDefinition;

const DEFS = [
  def("kills", "sum", 2),
  def("score", "sum", 1),
  def("rank", "last", 3),
  def("retired", "sum", 4, false),
  def("unseen", "sum", 5)
];

const fact = (
  team: number,
  member: number | null,
  segment: number,
  stat_code: string,
  value: number,
  entity_id: number | null = null
): NativeFact => ({
  encounter_team_id: team,
  workspace_member_id: member,
  entity_id,
  segment,
  stat_code,
  value
});

/** Three participants (a lobby), one with no source team and one event-only member. */
function lobby(overrides: Partial<MatchWithStats> = {}): MatchWithStats {
  const participant = (id: number, slot: number, source: number | null) => ({
    encounter_team_id: id,
    slot,
    source_position: 3 - slot,
    tournament_team_id: source,
    name: `T${id}`,
    result: null,
    team_facts: id === 3 ? {} : { score: id }
  });
  return {
    id: 5,
    created_at: "2026-01-01T00:00:00Z",
    played_at: null,
    encounter: null,
    participants: [participant(1, 1, 11), participant(2, 2, 12), participant(3, 3, null)],
    statistics: {
      members: [
        {
          encounter_team_id: 1,
          workspace_member_id: 10,
          player_id: 1,
          handle_snapshot: "Ann#1",
          observed_role: null
        },
        {
          encounter_team_id: 2,
          workspace_member_id: 20,
          player_id: 2,
          handle_snapshot: "Bob#2",
          observed_role: null
        },
        {
          encounter_team_id: 3,
          workspace_member_id: 30,
          player_id: 3,
          handle_snapshot: "Cy#3",
          observed_role: null
        },
        {
          encounter_team_id: 3,
          workspace_member_id: 31,
          player_id: 4,
          handle_snapshot: "Event only#4",
          observed_role: null
        }
      ],
      segments: [
        { segment: 2, kind: "round", attrs: {} },
        { segment: 1, kind: "round", attrs: {} }
      ],
      facts: [
        fact(1, 10, 0, "kills", 7),
        fact(1, 10, 0, "kills", 99, 500), // per-character row: never added to the member total
        fact(1, 10, 1, "kills", 3),
        fact(1, null, 0, "score", 1), // a team fact is not a member row
        fact(2, 20, 0, "kills", 0), // zero is a value
        fact(3, 30, 0, "retired", 4)
      ],
      entities: []
    },
    ...overrides
  } as unknown as MatchWithStats;
}

describe("buildMatchTable", () => {
  it("lists every participant and member (event-only included) with exactly the member-grain whole-match facts", () => {
    const table = buildMatchTable(lobby(), DEFS, 0);
    expect(
      table.sections.map((section) => [section.name, section.rows.map((row) => row.name)])
    ).toEqual([
      ["T1", ["Ann#1"]],
      ["T2", ["Bob#2"]],
      ["T3", ["Cy#3", "Event only#4"]]
    ]);
    expect(table.sections[0].rows[0].values).toEqual({ kills: 7 });
    expect(table.sections[1].rows[0].values).toEqual({ kills: 0 });
    expect(table.sections[2].rows[1].values).toEqual({});
    expect(table.sections[2].encounterTeamId).toBe(3);
    expect(table.sections[0].teamFacts).toEqual({ score: 1 });
  });

  it("columns are the declared stats someone observed, in declared order, retired ones included", () => {
    expect(buildMatchTable(lobby(), DEFS, 0).columns.map((column) => column.code)).toEqual([
      "kills",
      "retired"
    ]);
  });

  it("a child segment lists only the members it has values for, and segments are ordered", () => {
    const match = lobby();
    expect(matchSegments(match)).toEqual([0, 1, 2]);
    const table = buildMatchTable(match, DEFS, 1);
    expect(table.sections.map((section) => section.rows.map((row) => row.values))).toEqual([
      [{ kills: 3 }],
      [],
      []
    ]);
  });
});

describe("buildSeriesTable", () => {
  const at = (
    id: number,
    played_at: string | null,
    created_at: string,
    kills: number,
    rank: number
  ) =>
    ({
      ...lobby(),
      id,
      played_at,
      created_at,
      statistics: {
        ...lobby().statistics,
        facts: [fact(1, 10, 0, "kills", kills), fact(1, 10, 0, "rank", rank)]
      }
    }) as MatchWithStats;

  it("folds each stat by its own aggregation; `last` follows played_at ?? created_at, then id", () => {
    const table = buildSeriesTable(
      [
        at(2, null, "2026-03-01T00:00:00Z", 4, 2), // upload time is the fallback
        at(1, "2026-02-01T00:00:00Z", "2026-05-01T00:00:00Z", 6, 9),
        at(3, "2026-03-01T00:00:00Z", "2026-03-01T00:00:00Z", 1, 5) // same instant as #2: the higher id is later
      ],
      DEFS
    );
    const ann = table.sections[0].rows[0];
    expect(ann.values).toEqual({ kills: 11, rank: 5 });
    expect(ann.mapsPlayed).toBe(3);
    expect(table.columns.map((column) => column.code)).toEqual(["kills", "rank"]);
  });

  it("keeps participations apart by encounter_team_id and members that observed nothing as rows", () => {
    const table = buildSeriesTable([at(1, null, "2026-01-01T00:00:00Z", 1, 1)], DEFS);
    expect(table.sections.map((section) => section.encounterTeamId)).toEqual([1, 2, 3]);
    expect(table.sections[2].rows.map((row) => [row.name, row.values])).toEqual([
      ["Cy#3", {}],
      ["Event only#4", {}]
    ]);
  });
});
