import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildSeriesSlots,
  countMapWins,
  encounterSeatScore,
  formatCloseness,
  formatSeriesClock,
  getSeriesSeconds,
  getSeriesVerdict
} from "@/lib/encounter/detail";
import type { CatalogEntityRead } from "@/types/catalog.types";
import type {
  Encounter,
  Match,
  MatchParticipant,
  MatchWithStats,
  NativeFact
} from "@/types/encounter.types";
import type { MatchWithUserStats } from "@/types/user.types";
import { LogStatsName } from "@/types/stats.types";

import {
  COLUMN_PRESETS,
  COMPARISON_STATS,
  GROUP_COLOR,
  LEADER_STATS,
  PRESET_ORDER,
  STAT_META,
  activePlayers,
  availableRounds,
  columnMaxima,
  findLeader,
  formatStat,
  playerStat,
  resolveMatchMvpPlacement,
  teamTotal
} from "./stats";
import {
  BADGE_THRESHOLD,
  formatOverperformance,
  mvpRank,
  ordinal,
  overperformanceBadge,
  resolveMvpPlacement
} from "./mvp";
import { aggregateSeriesStats } from "./series";
import { owMatchView, type OwPlayer } from "./view";

/**
 * §10.2: the pre-move functions' captured outputs (real old-wire responses of the parity fixture, taken at
 * aff7943fc) against the same seed's NATIVE shape. The native input is the documented projection of the old
 * response (members = observed players, facts = their per-segment stats, `hero_time_played` entity facts above
 * the module's minute for their heroes, `score` team facts = the old two-sided score); outputs are compared with
 * exact `toEqual` and never edited. Fields the old wire carried that the native one does not (and the captured
 * output echoes: a seat's `seed`/`placement`/`team`, a slot's full old match/map objects) are projected to what
 * they identify on both sides.
 */
const DIR = path.join(__dirname, "..", "__fixtures__", "pre-move");
const load = (name: string) => JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
const fmt = {
  number: (value: number, options?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat("en-US", options).format(value)
};

const toJson = (value: unknown): string =>
  JSON.stringify(value, (_key, item) => {
    if (typeof item === "number" && !Number.isFinite(item)) return `__${String(item)}__`;
    if (item === undefined) return "__undefined__";
    return item;
  });
const norm = (value: unknown): unknown => JSON.parse(toJson(value));

interface OldHero {
  id: number;
  slug: string;
  name: string;
  image_path: string;
  type: string;
  color: string;
  created_at: string;
  updated_at: string | null;
}
interface OldPlayer {
  workspace_member_id: number;
  user_id: number;
  name: string;
  stats: Record<string, Record<string, number>>;
  heroes: Record<string, OldHero[]>;
}
interface OldParticipation {
  id: number;
  slot: number;
  team_id: number | null;
  name: string;
  players?: OldPlayer[];
}
interface OldMatch {
  id: number;
  workspace_id: number;
  discipline: string;
  score: { home: number; away: number };
  time: number | null;
  log_name: string | null;
  raw_status: Match["raw_status"];
  raw_available: boolean;
  encounter_id: number;
  map_id: number;
  map_index: number | null;
  home_participation: OldParticipation;
  away_participation: OldParticipation;
}

const header = (old: OldMatch): Match => {
  const participants: MatchParticipant[] = [old.home_participation, old.away_participation].map(
    (seat, index) => ({
      encounter_team_id: seat.id,
      slot: seat.slot,
      source_position: index,
      tournament_team_id: seat.team_id,
      name: seat.name,
      result: null,
      team_facts: { score: index === 0 ? old.score.home : old.score.away }
    })
  );
  return {
    id: old.id,
    // The old wire carried no timestamps: fixed values, `played_at` NULL (upload time).
    created_at: "2026-01-02T12:00:00Z",
    updated_at: null,
    played_at: null,
    workspace_id: old.workspace_id,
    discipline: old.discipline,
    encounter_id: old.encounter_id,
    encounter_game_id: null,
    map_index: old.map_index,
    map_id: old.map_id,
    map: null,
    encounter: null,
    duration_s: old.time,
    log_name: old.log_name,
    raw_status: old.raw_status,
    raw_available: old.raw_available,
    participants
  };
};

const nativeMatch = (old: OldMatch): MatchWithStats => {
  const members: MatchWithStats["statistics"]["members"] = [];
  const facts: NativeFact[] = [];
  const entities = new Map<number, CatalogEntityRead>();
  const segments = new Set<number>();
  for (const seat of [old.home_participation, old.away_participation]) {
    for (const player of seat.players ?? []) {
      members.push({
        encounter_team_id: seat.id,
        workspace_member_id: player.workspace_member_id,
        player_id: player.user_id,
        handle_snapshot: player.name,
        observed_role: null
      });
      const fact = (segment: number, stat_code: string, value: number, entity_id: number | null) =>
        facts.push({
          encounter_team_id: seat.id,
          workspace_member_id: player.workspace_member_id,
          entity_id,
          segment,
          stat_code,
          value
        });
      for (const [segment, row] of Object.entries(player.stats)) {
        if (Number(segment) > 0) segments.add(Number(segment));
        for (const [code, value] of Object.entries(row)) fact(Number(segment), code, value, null);
      }
      for (const [segment, heroes] of Object.entries(player.heroes)) {
        for (const hero of heroes) {
          fact(Number(segment), "hero_time_played", 61, hero.id);
          entities.set(hero.id, {
            id: hero.id,
            discipline: old.discipline,
            kind: "character",
            slug: hero.slug,
            name: hero.name,
            image_path: hero.image_path,
            parent_id: null,
            parent: null,
            attrs: { class: hero.type, color: hero.color },
            active: true,
            aliases: [],
            created_at: hero.created_at,
            updated_at: hero.updated_at
          });
        }
      }
    }
  }
  return {
    ...header(old),
    statistics: {
      members,
      segments: [...segments]
        .sort((a, b) => a - b)
        .map((segment) => ({ segment, kind: "round", attrs: {} })),
      facts,
      entities: [...entities.values()]
    }
  };
};

/** A view player back in the old observed-player form (a character as the old `Hero`). */
const legacyPlayer = (player: OwPlayer) => ({
  workspace_member_id: player.workspace_member_id,
  user_id: player.user_id,
  name: player.name,
  stats: player.stats,
  heroes: Object.fromEntries(
    Object.entries(player.heroes).map(([segment, heroes]) => [
      segment,
      heroes.map((entity) => ({
        id: entity.id,
        slug: entity.slug,
        name: entity.name,
        image_path: entity.image_path ?? "",
        type: entity.attrs.class,
        color: entity.attrs.color || "#ffffff",
        created_at: entity.created_at,
        updated_at: entity.updated_at
      }))
    ])
  )
});

describe("lib/match-stats.ts → disciplines/overwatch/match/stats", () => {
  const names = Object.keys(STAT_META) as LogStatsName[];

  it("keeps the catalogue constants", () => {
    expect(
      norm({ STAT_META, GROUP_COLOR, PRESET_ORDER, COLUMN_PRESETS, COMPARISON_STATS, LEADER_STATS })
    ).toEqual(load("match-stats.constants.json").output);
  });

  const files = fs.readdirSync(DIR).filter((name) => /^match-stats\.match.*\.json$/.test(name));
  it("has the parity fixture's matches", () => expect(files.length).toBe(12));

  it.each(files)("reproduces every captured match output from the native shape: %s", (file) => {
    const fixture = load(file);
    const [label, old] = Object.entries(fixture.input_old_wire)[0] as [string, OldMatch];
    const view = owMatchView(nativeMatch(old));
    expect(view).not.toBeNull();
    const { home, away } = view!;
    const rounds = availableRounds(home, away);
    const byRound: Record<number, unknown> = {};
    for (const round of rounds) {
      const rows = (team: typeof home) =>
        activePlayers(team, round).map((player) => ({
          workspace_member_id: player.workspace_member_id,
          mvp: resolveMatchMvpPlacement(player, round),
          stats: Object.fromEntries(
            names.map((name) => {
              const value = playerStat(player, round, name);
              return [name, { value, formatted: formatStat(name, value, fmt) }];
            })
          )
        }));
      byRound[round] = {
        home_players: rows(home),
        away_players: rows(away),
        team_totals: {
          home: Object.fromEntries(names.map((n) => [n, teamTotal(home, round, n)])),
          away: Object.fromEntries(names.map((n) => [n, teamTotal(away, round, n)]))
        },
        column_maxima: Object.fromEntries(
          Object.entries(COLUMN_PRESETS).map(([preset, cols]) => [
            preset,
            columnMaxima(home, away, round, cols)
          ])
        ),
        leaders: Object.fromEntries(
          LEADER_STATS.map((name) => {
            const leader = findLeader(home, away, round, name);
            return [
              name,
              leader && {
                player: legacyPlayer(leader.player),
                side: leader.side,
                value: leader.value
              }
            ];
          })
        ),
        formatted_absent: [
          formatStat(LogStatsName.Eliminations, null, fmt),
          formatStat(LogStatsName.Eliminations, undefined, fmt)
        ]
      };
    }
    expect(norm({ [label]: { available_rounds: rounds, by_round: byRound } })).toEqual(
      fixture.output
    );
  });
});

describe("components/match mvp-rank → disciplines/overwatch/match/mvp", () => {
  it("reproduces every captured user-match placement, medal, formatting and badge from native facts", () => {
    const fixture = load("mvp-rank.json");
    type Row = {
      source: string;
      match_id: number;
      performance: number | null;
      impact_rank: number | null;
      impact_points: number | null;
      overperformance_score: number | null;
      overperformance_badge: boolean;
    };
    const rows: Row[] = fixture.input_old_wire.user_encounter_matches;
    expect(rows.length).toBe(76);

    const placements = new Set<number>();
    const actual = rows.map((row) => {
      const facts: Record<string, number> = {};
      for (const code of [
        "performance",
        "impact_rank",
        "impact_points",
        "overperformance_score"
      ] as const) {
        if (row[code] != null) facts[code] = row[code] as number;
      }
      // The old wire carried only the badge: whoever outranked the viewer is the member that makes it false.
      const total = (member: number, value: number): NativeFact => ({
        encounter_team_id: 1,
        workspace_member_id: member,
        entity_id: null,
        segment: 0,
        stat_code: "overperformance_score",
        value
      });
      const score = row.overperformance_score;
      const member_totals =
        score == null
          ? []
          : [
              total(1, score),
              total(2, score - 1),
              ...(!row.overperformance_badge && score >= BADGE_THRESHOLD
                ? [total(3, score + 1)]
                : [])
            ];
      const match = {
        viewer: { encounter_team_id: 1, workspace_member_id: 1, facts, characters: [] },
        member_totals
      } as unknown as MatchWithUserStats;
      const placement = resolveMvpPlacement(match.viewer?.facts);
      if (placement != null) placements.add(placement);
      return {
        source: row.source,
        match_id: row.match_id,
        performance: facts.performance ?? null,
        impact_rank: facts.impact_rank ?? null,
        impact_points: facts.impact_points ?? null,
        overperformance_score: facts.overperformance_score ?? null,
        overperformance_badge: overperformanceBadge(match),
        placement,
        rank: mvpRank(facts.performance ?? null),
        rank_of_placement: mvpRank(placement),
        overperformance: formatOverperformance(facts.overperformance_score)
      };
    });
    const ordinals = Object.fromEntries(
      [...placements].sort((a, b) => a - b).map((n) => [n, ordinal(n)])
    );
    expect(norm({ rows: actual, ordinals })).toEqual(fixture.output);
  });

  it("ranks the badge over every member, not only the viewer", () => {
    const total = (member: number, value: number): NativeFact => ({
      encounter_team_id: 1,
      workspace_member_id: member,
      entity_id: null,
      segment: 0,
      stat_code: "overperformance_score",
      value
    });
    const viewer = {
      encounter_team_id: 1,
      workspace_member_id: 1,
      characters: [],
      facts: { overperformance_score: 3 }
    };
    expect(overperformanceBadge({ viewer, member_totals: [total(1, 3), total(2, 3)] })).toBe(true); // ties share rank 1
    expect(overperformanceBadge({ viewer, member_totals: [total(1, 3), total(2, 3.5)] })).toBe(
      false
    );
    expect(
      overperformanceBadge({
        viewer: { ...viewer, facts: { overperformance_score: 1.9 } },
        member_totals: [total(1, 1.9)]
      })
    ).toBe(false);
    expect(overperformanceBadge({ viewer: null, member_totals: [] })).toBe(false);
  });
});

describe("lib/encounter/detail.ts → generic detail + overwatch series", () => {
  const files = fs.readdirSync(DIR).filter((name) => /^encounter-detail\..*\.json$/.test(name));
  it("has the parity fixture's encounters", () => expect(files.length).toBe(6));

  it.each(files)("reproduces every captured encounter output from the native shape: %s", (file) => {
    const fixture = load(file);
    const [label, expected] = Object.entries(fixture.output)[0] as [
      string,
      Record<string, unknown>
    ];
    const oldEncounter = fixture.input_old_wire.encounter as Encounter & { matches: unknown[] };
    const encounter = {
      ...oldEncounter,
      matches: (oldEncounter.matches as OldMatch[]).map(header)
    } as Encounter;
    const withStats = (fixture.input_old_wire.matches_with_stats as OldMatch[]).map(nativeMatch);

    const seconds = getSeriesSeconds(encounter);
    const aggregate = aggregateSeriesStats(withStats);
    const actual = {
      encounter_id: encounter.id,
      match_ids_with_stats: withStats.map((m) => m.id),
      seat_scores: encounter.matches.map((m) => ({
        match: m.id,
        ...(encounterSeatScore(m, encounter) ?? {})
      })),
      series_slots: buildSeriesSlots(encounter).map((slot) => ({
        ...slot,
        game: slot.game && { ...slot.game, map: slot.game.map?.id ?? null },
        match: slot.match?.id ?? null
      })),
      map_wins: countMapWins(encounter),
      verdict: getSeriesVerdict(encounter),
      series_seconds: seconds,
      series_clock: formatSeriesClock(seconds, { h: "h", m: "m", s: "s" }),
      closeness: formatCloseness(encounter.closeness),
      aggregate_series_stats: aggregate && {
        participations: aggregate.participations.map((p) => ({
          id: p.id,
          slot: p.slot,
          team_id: p.team_id,
          name: p.name,
          players: p.players.map(legacyPlayer),
          meta: p.meta
        })),
        mapsCounted: aggregate.mapsCounted,
        round: aggregate.round
      }
    };

    type Slot = { game: { map: { id: number } | null } | null; match: { id: number } | null };
    type Aggregate = { participations: Record<string, unknown>[] } | null;
    const captured = {
      ...expected,
      series_slots: (expected.series_slots as Slot[]).map((slot) => ({
        ...slot,
        game: slot.game && { ...slot.game, map: slot.game.map?.id ?? null },
        match: slot.match?.id ?? null
      })),
      aggregate_series_stats: (expected.aggregate_series_stats as Aggregate) && {
        ...(expected.aggregate_series_stats as object),
        participations: (
          expected.aggregate_series_stats as NonNullable<Aggregate>
        ).participations.map((p) => ({
          id: p.id,
          slot: p.slot,
          team_id: p.team_id,
          name: p.name,
          players: p.players,
          meta: p.meta
        }))
      }
    };
    expect(label).toBeTruthy();
    expect(norm(actual)).toEqual(norm(captured));
  });
});
