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
import type { Encounter, Match, MatchWithStats, NativeFact } from "@/types/encounter.types";
import type { EncounterWithUserStats } from "@/types/user.types";
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
  formatOverperformance,
  mvpRank,
  ordinal,
  overperformanceBadge,
  resolveMvpPlacement
} from "./mvp";
import { aggregateSeriesStats } from "./series";
import { owMatchView, type OwPlayer } from "./view";

/**
 * §10.2 parity: the pre-move functions' CAPTURED outputs (`__fixtures__/pre-move`, real old-wire responses of the
 * §10.1 parity seed at aff7943fc, never edited) against the REAL native responses of the SAME seed at the
 * post-cutover HEAD (`__fixtures__/post-move`, verbatim gateway bodies, no value derived from an output).
 * Everything is exact `toEqual`.
 *
 * Output fields the native contract removes. They are not produced by any moved function (each is an echo of a
 * removed wire field or an object the cutover replaced), so the captured side drops exactly these and nothing else:
 *  - `Hero.color` (inside every captured hero): §4.1, `HeroRead` → `CatalogEntityRead`, which has no colour.
 *    Every captured value is the same seed default (asserted below). `Hero.type` is compared as `attrs.class`.
 *  - `slot.match.map.in_competitive`, `slot.match.map.gamemode.description`, `slot.game.map.in_competitive`:
 *    §4.1, `MapRead{gamemode_id, gamemode}` / `GamemodeRead` → `CatalogEntityRead` (`parent_id`, `parent`).
 *  - `slot.match.home_participation` / `away_participation`: §6.1 "Removed" (`home_/away_participation`); the
 *    seats are `participants`, compared field by field through the §6.1 mapping below instead.
 *  - the `seed`/`score`/`placement`/`team` of an aggregate participation that is a RETIRED seat (`active: false`):
 *    §6.1 `MatchParticipantRead` carries no `seed`, no encounter tally and no team expansion; a live seat's are
 *    compared against the native `encounter.teams` entry of the same participation, a retired seat has none.
 *  - an aggregate participation's `team` beyond `name`/`image_url`: `OwTeam.team` (§6.5, C14 "no `team`
 *    expansion") only carries what the header draws.
 */
const FIXTURES = path.join(__dirname, "..", "__fixtures__");
const PRE = path.join(FIXTURES, "pre-move");
const POST = path.join(FIXTURES, "post-move");
const read = (dir: string, name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
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

interface PostMatchFile {
  provenance: { git_sha: string; fixture_db: string; seed_source_sha256: string };
  input_native_wire: Record<string, MatchWithStats>;
}
interface PostEncounterFile {
  provenance: { git_sha: string };
  input_native_wire: { encounter: Encounter; matches_with_stats: string[] };
}

const postMatch = (label: string): MatchWithStats =>
  (read(POST, `match-stats.${label}.json`) as PostMatchFile).input_native_wire[label];

/**
 * MISMATCH M1 (reported, awaiting a decision; not hidden): the old reader served every no-entity member stat as
 * `sum(value)::numeric(10,2)` (`get_match_observed_players`, aff7943fc), i.e. quantized to 2 decimals half away
 * from zero; the native wire serves the raw `NativeFact.value` (§6.1 `value: float`, "never recomputed"). The seed
 * holds 3-decimal facts (e.g. 0.252, 1125.002), so the old output reads 0.25 / 1125 where the native one reads the
 * stored value. This is the ONLY difference found: with exactly this quantization applied to the real native
 * no-entity facts every captured match output below is reproduced exactly. The strict, unquantized comparison is
 * pinned by the `it.fails` test, which turns red the moment the wire (or the decision) changes.
 */
const legacyQuantized = (match: MatchWithStats): MatchWithStats => ({
  ...match,
  statistics: {
    ...match.statistics,
    facts: match.statistics.facts.map((fact) =>
      fact.entity_id == null
        ? { ...fact, value: Math.sign(fact.value) * Math.round(Math.abs(fact.value) * 100 + 1e-9) / 100 }
        : fact
    )
  }
});
const postMatchLegacyPrecision = (label: string): MatchWithStats => legacyQuantized(postMatch(label));

/** The pre-move capture's object order (its capture script's `MATCH_KEYS`), which fixes aggregation order. */
const MATCH_LABELS = [
  "match",
  "match_reversed",
  "match_no_raw",
  "match_other",
  "match_hidden",
  "match_otp_1",
  "match_otp_2",
  "match_otp_3",
  "match_otp_4",
  "match_career_1",
  "match_career_2",
  "match_career_3"
];
const PLAYER_LABELS = [
  "player",
  "player_away",
  "player_event_only",
  "player_other",
  "player_removed",
  "player_no_member"
];
const SCOPES = ["workspace", "workspace_other", "all"];

/** A character as the captured output spells it (`Hero`), from the native entity; `color` has no native source. */
const oldHero = (entity: CatalogEntityRead) => ({
  id: entity.id,
  slug: entity.slug,
  name: entity.name,
  image_path: entity.image_path,
  type: entity.attrs.class,
  created_at: entity.created_at,
  updated_at: entity.updated_at
});

/** A view player in the captured observed-player form. */
const oldPlayer = (player: OwPlayer) => ({
  workspace_member_id: player.workspace_member_id,
  user_id: player.user_id,
  name: player.name,
  stats: player.stats,
  heroes: Object.fromEntries(
    Object.entries(player.heroes).map(([segment, heroes]) => [segment, heroes.map(oldHero)])
  )
});

const HERO_COLORS = new Set<unknown>();
/** The captured side of the one removed hero field (see the header): every hero object loses `color`. */
const withoutHeroColor = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutHeroColor);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const isHero = "slug" in record && "image_path" in record && "color" in record;
    return Object.fromEntries(
      Object.entries(record)
        .filter(([key]) => {
          if (isHero && key === "color") HERO_COLORS.add(record[key]);
          return !(isHero && key === "color");
        })
        .map(([key, item]) => [key, withoutHeroColor(item)])
    );
  }
  return value;
};

describe("lib/match-stats.ts → disciplines/overwatch/match/stats", () => {
  const names = Object.keys(STAT_META) as LogStatsName[];

  it("keeps the catalogue constants", () => {
    expect(
      norm({ STAT_META, GROUP_COLOR, PRESET_ORDER, COLUMN_PRESETS, COMPARISON_STATS, LEADER_STATS })
    ).toEqual(read(PRE, "match-stats.constants.json").output);
  });

  it("has every parity-fixture match, with provenance of the same seed", () => {
    const files = fs.readdirSync(POST).filter((name) => /^match-stats\.match.*\.json$/.test(name));
    expect(files.length).toBe(12);
    const pre = read(PRE, "match-stats.match.json").provenance;
    for (const file of files) {
      const { provenance } = read(POST, file) as PostMatchFile;
      expect(provenance.seed_source_sha256).toBe(pre.seed_source_sha256);
      expect(provenance.git_sha).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  const reproduce = (label: string, match: MatchWithStats) => {
    const expected = read(PRE, `match-stats.${label}.json`).output;
    const view = owMatchView(match);
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
              leader && { player: oldPlayer(leader.player), side: leader.side, value: leader.value }
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
      withoutHeroColor(expected)
    );
  };

  it.each(MATCH_LABELS)(
    "reproduces every captured match output from the real native wire (M1 quantization): %s",
    (label) => reproduce(label, postMatchLegacyPrecision(label))
  );

  // M1 pinned: the same comparison on the raw native facts is expected to differ (match_no_raw has no stats).
  it.fails("M1: the raw native facts are not the old 2-decimal values", () =>
    reproduce("match", postMatch("match"))
  );

  it("drops only a hero colour that was the seed default on every captured hero", () => {
    expect(HERO_COLORS.size === 0 || [...HERO_COLORS].every((color) => color === "#ffffff")).toBe(true);
  });
});

describe("components/match mvp-rank → disciplines/overwatch/match/mvp", () => {
  it("reproduces every captured user-match placement, medal, formatting and badge from the real native wire", () => {
    const fixture = read(PRE, "mvp-rank.json");
    const placements = new Set<number>();
    const rows = PLAYER_LABELS.flatMap((player) => {
      const { input_native_wire } = read(POST, `mvp-rank.${player}.json`) as {
        input_native_wire: Record<string, { status: number; body: { results: EncounterWithUserStats[] } }>;
      };
      return SCOPES.flatMap((scope) => {
        const source = `${player}:${scope}:encounters`;
        return input_native_wire[source].body.results.flatMap((encounter) =>
          encounter.matches.map((match) => {
            const facts = match.viewer?.facts ?? {};
            const placement = resolveMvpPlacement(match.viewer?.facts);
            if (placement != null) placements.add(placement);
            return {
              source,
              match_id: match.id,
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
          })
        );
      });
    });
    const ordinals = Object.fromEntries(
      [...placements].sort((a, b) => a - b).map((n) => [n, ordinal(n)])
    );
    expect(rows.length).toBe(76);
    expect(norm({ rows, ordinals })).toEqual(fixture.output);
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

/** The captured `slot.match` echo of a native match header, through the §6.1 mapping. */
const oldMatchHeader = (match: Match) => {
  // The old `home`/`away` followed the observation's historical encounter slots 1 and 2, never the log's source order.
  const [first, second] = [...match.participants].sort((a, b) => a.slot - b.slot);
  const header = {
    id: match.id,
    workspace_id: match.workspace_id,
    discipline: match.discipline,
    home_team_id: first?.tournament_team_id ?? null,
    away_team_id: second?.tournament_team_id ?? null,
    score: { home: first?.team_facts.score, away: second?.team_facts.score },
    time: match.duration_s,
    log_name: match.log_name,
    raw_status: match.raw_status,
    raw_available: match.raw_available,
    encounter_id: match.encounter_id,
    map_id: match.map_id,
    map_index: match.map_index
  };
  // The encounter wire omits null fields (as the old one did): an absent key, not an `undefined` value.
  return Object.fromEntries(Object.entries(header).filter(([, value]) => value !== undefined));
};

/** A native map as the captured `MapRead` spells it, `gamemode_id`/`gamemode` being `parent_id`/`parent` (§4.1). */
const oldMap = (map: CatalogEntityRead | null, withMode: boolean) =>
  map && {
    id: map.id,
    gamemode_id: map.parent_id,
    name: map.name,
    image_path: map.image_path,
    ...(withMode && map.parent
      ? {
          gamemode: {
            id: map.parent.id,
            slug: map.parent.slug,
            name: map.parent.name,
            image_path: map.parent.image_path
          }
        }
      : {})
  };

const REMOVED_MAP_FIELDS = ["in_competitive"] as const;
const dropKeys = (value: Record<string, unknown> | null, keys: readonly string[]) =>
  value && Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

describe("lib/encounter/detail.ts → generic detail + overwatch series", () => {
  const files = fs.readdirSync(POST).filter((name) => /^encounter-detail\..*\.json$/.test(name));
  it("has the parity fixture's encounters", () => expect(files.length).toBe(6));

  it.each(files)("reproduces every captured encounter output from the real native wire: %s", (file) => {
    const input = (read(POST, file) as PostEncounterFile).input_native_wire;
    const encounter = input.encounter;
    const withStats = input.matches_with_stats.map(postMatchLegacyPrecision);
    const [label, expected] = Object.entries(read(PRE, file).output)[0] as [
      string,
      Record<string, unknown>
    ];
    expect(file).toBe(`encounter-detail.${label}.json`);

    const seconds = getSeriesSeconds(encounter);
    const aggregate = aggregateSeriesStats(withStats);
    const seats = new Map(withStats.flatMap((m) => m.encounter?.teams ?? []).map((seat) => [seat.id, seat]));

    const actual = {
      encounter_id: encounter.id,
      match_ids_with_stats: withStats.map((m) => m.id),
      seat_scores: encounter.matches.map((m) => ({ match: m.id, ...(encounterSeatScore(m, encounter) ?? {}) })),
      series_slots: buildSeriesSlots(encounter).map((slot) => ({
        ...slot,
        game:
          slot.game && {
            ...slot.game,
            map: oldMap(slot.game.map, false)
          },
        match: slot.match && { ...oldMatchHeader(slot.match), map: oldMap(slot.match.map, true) }
      })),
      map_wins: countMapWins(encounter),
      verdict: getSeriesVerdict(encounter),
      series_seconds: seconds,
      series_clock: formatSeriesClock(seconds, { h: "h", m: "m", s: "s" }),
      closeness: formatCloseness(encounter.closeness),
      aggregate_series_stats: aggregate && {
        participations: aggregate.participations.map((p) => {
          const seat = seats.get(p.id);
          return {
            id: p.id,
            slot: p.slot,
            team_id: p.team_id,
            name: p.name,
            ...(seat ? { seed: seat.seed, score: seat.score, placement: seat.placement } : {}),
            active: p.live,
            ...(seat?.team ? { team: { name: p.team?.name, image_url: p.team?.image_url } } : {}),
            players: p.players.map(oldPlayer),
            meta: p.meta
          };
        }),
        mapsCounted: aggregate.mapsCounted,
        round: aggregate.round
      }
    };

    type Slot = {
      game: { map: Record<string, unknown> | null } | null;
      match: Record<string, unknown> & { map: Record<string, unknown> | null } | null;
    } & Record<string, unknown>;
    type Aggregate = { participations: Record<string, unknown>[] } & Record<string, unknown>;
    const capturedAggregate = expected.aggregate_series_stats as Aggregate | null;
    const captured = {
      ...expected,
      series_slots: (expected.series_slots as Slot[]).map((slot) => ({
        ...slot,
        game:
          slot.game && {
            ...slot.game,
            map: dropKeys(slot.game.map, REMOVED_MAP_FIELDS)
          },
        match:
          slot.match &&
          (() => {
            const { home_participation, away_participation, ...match } = slot.match!;
            void home_participation;
            void away_participation;
            const map = dropKeys(match.map, REMOVED_MAP_FIELDS) as
              | (Record<string, unknown> & { gamemode?: Record<string, unknown> })
              | null;
            return {
              ...match,
              map: map && {
                ...map,
                ...(map.gamemode ? { gamemode: dropKeys(map.gamemode, ["description"]) } : {})
              }
            };
          })()
      })),
      aggregate_series_stats: capturedAggregate && {
        ...capturedAggregate,
        participations: capturedAggregate.participations.map((p) => {
          const live = p.active === true;
          const team = p.team as { name: string; image_url: string | null } | null;
          const { seed, score, placement, team: _team, ...rest } = p;
          void _team;
          return {
            ...rest,
            ...(live ? { seed, score, placement } : {}),
            ...(live && team ? { team: { name: team.name, image_url: team.image_url } } : {})
          };
        })
      }
    };
    expect(norm(actual)).toEqual(withoutHeroColor(norm(captured)));
  });
});
