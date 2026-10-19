import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import * as compareUtils from "@/app/(site)/users/compare/utils";
import { getComparePageHeroModel } from "@/app/(site)/users/compare/components/compare-page-hero.model";
import * as statColumns from "@/app/(site)/users/heroes-compare/config/stat-columns";
import * as perspective from "@/app/(site)/users/components/shared/encounter-perspective";
import * as history from "@/app/(site)/users/components/tournaments/tournaments-history.helpers";
import type { CatalogEntityRead } from "@/types/catalog.types";
import type { CharacterLeaderboardEntry } from "@/types/statistics.types";
import type {
  CharacterSummary,
  EncounterWithUserStats,
  MatchWithUserStats,
  UserCharacterCompareResponse,
  UserCompareResponse,
  UserTournament
} from "@/types/user.types";

import { overperformanceBadge } from "../match/mvp";
import { LogStatsName } from "../stat-names";
import { avgMvpPlacement } from "./AvgMvpCell";
import * as characterUtils from "./utils";

/**
 * §10.2 users rows: the pre-move functions' CAPTURED outputs (`__fixtures__/pre-move`, real old-wire responses of
 * the §10.1 parity seed at aff7943fc, never edited) against the REAL native responses of the SAME seed at the
 * post-8b HEAD (`__fixtures__/post-move/users-*.json`, plus the `mvp-rank.<player>.json` user-encounter shards,
 * byte-identical at this HEAD). Same request variants and labels as the pre-move capture; the native requests
 * carry `discipline=overwatch` and the renamed routes/params (§4.3, C12). Nothing on the input side is derived from
 * an output. Everything is exact `toEqual`.
 *
 * Renames, compared through an explicit mapping (never dropped): `hero` → `character` (§4.1), `left_/right_hero_id`
 * → `left_/right_entity_id` (§4.3), a user match's `performance`/`impact_*`/`overperformance_score` → `viewer.facts`
 * and `heroes` → `viewer.characters` (§6.5 8b row), its badge → `overperformanceBadge` over `member_totals` (C22),
 * `home/away` team ids and `score` → `participants` by encounter slot (§6.1), `time` → `duration_s`, a map's
 * `gamemode_id/gamemode` → `parent_id/parent` (§4.1). The request's added `discipline` param is not a compare query
 * int (it did not exist in the pre-move request).
 *
 * Output fields that cannot be produced, dropped from the captured side only (each by its reference):
 *  - `Hero.color` (every captured hero; seed default `#ffffff`, asserted): §4.1 `HeroRead` → `CatalogEntityRead`.
 *  - a map's `in_competitive` and its mode's `description`: §4.1 `MapRead`/`GamemodeRead` → `CatalogEntityRead`.
 *  - `compare/utils` `parseRole` and `roleLabelKey` (the fixed Tank/Damage/Support vocabulary) and
 *    `tournaments-history` `roleColorVar` (`role_color`, `player_role_colors`): removed with the fixed role
 *    vocabulary (§9 5a deletion obligation "fixed role arrays/accents", Ruling 5a: family owners remove the retained
 *    fixed role-selector exports; 8b removed them in 190c8e8a1). Roles now come from the browsed game's ontology
 *    (`compareRoleFilter`, §1.5/§1.6), which has no equivalent of these fixed-token outputs.
 *
 * MISMATCH U1 (reported, awaiting a ruling — not hidden): `heroes-compare` column `per10_damage_taken` changed its
 * `barColor`/`accentColor` from the tank role token (`color-mix(... var(--aqt-tank) ...)` / `var(--aqt-tank)`) to
 * `bg-slate-400/65` / `bg-slate-400` (190c8e8a1). Pinned exactly by the "U1" test; every other column and value is
 * compared in full.
 */
const FIXTURES = path.join(__dirname, "..", "__fixtures__");
const PRE = path.join(FIXTURES, "pre-move");
const POST = path.join(FIXTURES, "post-move");
const read = (dir: string, name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
const fmt = {
  number: (value: number, options?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat("en-US", options).format(value)
};
const UNITS = { h: "h", m: "m", s: "s" };

const toJson = (value: unknown): string =>
  JSON.stringify(value, (_key, item) => {
    if (typeof item === "number" && !Number.isFinite(item)) return `__${String(item)}__`;
    if (item === undefined) return "__undefined__";
    return item;
  });
const norm = (value: unknown): unknown => JSON.parse(toJson(value));

interface Capture<T> {
  request: { method: string; path: string; query: [string, string][] };
  status: number;
  body: T;
}
type Captures<T> = Record<string, Capture<T>>;
const native = <T>(name: string): Captures<T> => read(POST, name).input_native_wire;
const ok = <T>(records: Captures<T>, test: (label: string) => boolean): [string, Capture<T>][] =>
  Object.entries(records).filter(([label, rec]) => rec.status === 200 && test(label));

const PLAYERS = ["player", "player_away", "player_event_only", "player_other", "player_removed", "player_no_member"];
const COMPARE_PLAYERS = ["player", "player_away", "player_other"];
const SCOPES = ["workspace", "workspace_other", "all"];

/** The removed-field filter of the header, applied to the captured side only. */
const HERO_COLORS = new Set<unknown>();
const removedFields = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(removedFields);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const isHero = "slug" in record && "image_path" in record && "color" in record;
    const isMap = "gamemode_id" in record && "in_competitive" in record;
    const isMode = "slug" in record && "description" in record && !isHero;
    return Object.fromEntries(
      Object.entries(record)
        .filter(([key]) => {
          if (isHero && key === "color") HERO_COLORS.add(record[key]);
          return !((isHero && key === "color") || (isMap && key === "in_competitive") || (isMode && key === "description"));
        })
        .map(([key, item]) => [key, removedFields(item)])
    );
  }
  return value;
};

describe("users/components/heroes/utils.ts → disciplines/overwatch/character/utils", () => {
  it("reproduces every captured character-stat derivation from the real native wire", () => {
    const fixture = read(PRE, "users-heroes-utils.json");
    const perResponse: Record<string, unknown> = {};
    for (const player of PLAYERS) {
      for (const [label, rec] of ok(native<{ results: CharacterSummary[] }>(`users-characters.${player}.json`), () => true)) {
        perResponse[label] = rec.body.results.map((row) => ({
          hero_id: row.character.id,
          stats: row.stats.map((stat) => {
            const reversed = characterUtils.isRevertedStat(stat.name);
            const delta = characterUtils.computeDelta(stat.avg_10, stat.avg_10_all, reversed);
            return {
              name: stat.name,
              reverted: reversed,
              overall: characterUtils.getOverall(row, stat.name as LogStatsName),
              avg10: characterUtils.statAvg10(row.stats, stat.name as LogStatsName),
              formatted_overall: characterUtils.formatStatValue(fmt, stat.name, stat.overall),
              formatted_avg10: characterUtils.formatStatValue(fmt, stat.name, stat.avg_10),
              delta,
              formatted_delta: delta == null ? null : characterUtils.formatDelta(delta),
              overall_fraction: characterUtils.toFraction(stat.overall),
              avg10_fraction: characterUtils.toFraction(stat.avg_10)
            };
          })
        }));
      }
    }
    const reverted = Object.fromEntries(Object.values(LogStatsName).map((n) => [n, characterUtils.isRevertedStat(n)]));
    expect(Object.keys(perResponse).length).toBe(18);
    expect(norm({ per_response: perResponse, isRevertedStat_by_LogStatsName: reverted })).toEqual(fixture.output);
  });
});

describe("users/compare/utils.ts + compare-page-hero.model.ts", () => {
  const RENAMED_QUERY: Record<string, string> = { left_entity_id: "left_hero_id", right_entity_id: "right_hero_id" };
  const text = (values: (number | null)[]) => values.map((v) => compareUtils.formatMetricValue(v ?? NaN));

  it.each(COMPARE_PLAYERS)("reproduces every captured compare derivation from the real native wire: %s", (player) => {
    const expectedUtils = read(PRE, `users-compare-utils.${player}.json`).output;
    const expectedModel = read(PRE, `compare-page-hero-model.${player}.json`).output;
    const utils: Record<string, unknown> = {};
    const models: Record<string, unknown> = {};
    for (const [label, rec] of ok(
      native<UserCompareResponse | UserCharacterCompareResponse>(`users-compare.${player}.json`),
      () => true
    )) {
      const isCharacter = label.includes(":compare_heroes:");
      const metrics = isCharacter
        ? (rec.body as UserCharacterCompareResponse).metrics.map((metric) => ({
            key: metric.stat,
            left: compareUtils.normalizeNumber(metric.left_value),
            right: compareUtils.normalizeNumber(metric.right_value),
            delta: compareUtils.normalizeNumber(metric.delta),
            delta_percent: compareUtils.normalizeNumber(metric.delta_percent),
            metric_text: text([metric.left_value, metric.right_value, metric.delta]),
            percent_text: compareUtils.formatPercent(metric.delta_percent)
          }))
        : (rec.body as UserCompareResponse).metrics.map((metric) => ({
            key: metric.key,
            subject: compareUtils.normalizeNumber(metric.subject_value),
            baseline: compareUtils.normalizeNumber(metric.baseline_value),
            delta: compareUtils.normalizeNumber(metric.delta),
            delta_percent: compareUtils.normalizeNumber(metric.delta_percent),
            percentile: compareUtils.normalizeNumber(metric.subject_percentile),
            metric_text: text([metric.subject_value, metric.baseline_value, metric.delta]),
            percent_text: compareUtils.formatPercent(metric.delta_percent),
            percentile_text: compareUtils.formatPercent(metric.subject_percentile),
            subject_fraction: characterUtils.toFraction(metric.subject_value)
          }));
      const characterBody = rec.body as UserCharacterCompareResponse;
      utils[label] = {
        metrics,
        map_icon: isCharacter ? compareUtils.getMapIconSrc(characterBody.map) : null,
        playtime: isCharacter
          ? {
              left: compareUtils.formatDuration(characterBody.left_playtime_seconds),
              right: compareUtils.formatDuration(characterBody.right_playtime_seconds),
              left_units: compareUtils.formatDuration(characterBody.left_playtime_seconds, UNITS)
            }
          : null,
        query_ints: Object.fromEntries(
          rec.request.query
            .filter(([key]) => key !== "discipline")
            .map(([key, value]) => [RENAMED_QUERY[key] ?? key, compareUtils.parseOptionalInt(value)])
        )
      };
      models[label] = [false, true].flatMap((isLoading) =>
        [true, false].map((hasSubject) => ({
          isLoading,
          hasSubject,
          model: getComparePageHeroModel({
            hasSubject,
            hasData: rec.body.metrics.length > 0,
            isLoading,
            scope: isCharacter ? "hero" : "overall",
            baseline: rec.body.baseline.mode,
            sampleSize: rec.body.baseline.sample_size,
            metricCount: rec.body.metrics.length
          })
        }))
      );
    }
    expect(norm({ per_response: utils })).toEqual(expectedUtils);
    expect(norm({ per_response: models })).toEqual(expectedModel);
  });

  it("keeps parseScope over the captured domain tokens (parseRole/roleLabelKey removed, see header)", () => {
    const expected = read(PRE, "users-compare-utils.tokens.json").output;
    const tokens = expected.domain_tokens as (string | null)[];
    expect(Object.fromEntries(tokens.map((t) => [String(t), compareUtils.parseScope(t)]))).toEqual(expected.parseScope);
  });
});

describe("users/heroes-compare/config/stat-columns.ts", () => {
  const expected = read(PRE, "heroes-compare-stat-columns.json").output;
  const columns = Object.values(statColumns.COL).map(({ key, labelKey, ascending, barColor, accentColor }) => ({
    key,
    labelKey,
    ascending,
    barColor,
    accentColor
  }));

  it("reproduces every captured column value from the real native character leaderboards", () => {
    const perResponse = Object.fromEntries(
      ok(native<{ results: CharacterLeaderboardEntry[] }>("users-character-leaderboard.json"), () => true).map(
        ([label, rec]) => [
          label,
          rec.body.results.map((entry) => ({
            user_id: entry.user_id,
            columns: Object.fromEntries(
              Object.values(statColumns.COL).map((col) => {
                const value = col.getValue(entry);
                return [col.key, { value, formatted: col.formatValue(value) }];
              })
            )
          }))
        ]
      )
    );
    const roles = ["Damage", "Tank", "Support", "Flex", null];
    const actual = norm({
      per_response: perResponse,
      columns,
      all_stat_option_keys: statColumns.ALL_STAT_OPTIONS.map((c) => c.key),
      NUM_COLUMNS: statColumns.NUM_COLUMNS,
      default_columns_by_role: Object.fromEntries(roles.map((r) => [String(r), statColumns.getDefaultColumnKeys(r)]))
    }) as { columns: { key: string }[] };
    const withoutU1 = (value: { columns: { key: string }[] }) => ({
      ...value,
      columns: value.columns.map((column) =>
        column.key === "per10_damage_taken" ? { ...column, barColor: "U1", accentColor: "U1" } : column
      )
    });
    expect(withoutU1(actual)).toEqual(withoutU1(expected));
  });

  it("U1 (awaiting ruling): per10_damage_taken lost its tank-role token colours", () => {
    const old = (expected.columns as { key: string; barColor: string; accentColor: string }[]).find(
      (column) => column.key === "per10_damage_taken"
    );
    const current = columns.find((column) => column.key === "per10_damage_taken");
    expect(old).toMatchObject({
      barColor: "bg-[color:color-mix(in_srgb,var(--aqt-tank)_65%,transparent)]",
      accentColor: "bg-[color:var(--aqt-tank)]"
    });
    expect(current).toMatchObject({ barColor: "bg-slate-400/65", accentColor: "bg-slate-400" });
  });
});

/** A native user match in the captured (old wire) form, through the header's mapping. */
const oldUserMatch = (match: MatchWithUserStats) => {
  const [one, two] = [...match.participants].sort((a, b) => a.slot - b.slot);
  const facts: Record<string, number | undefined> = match.viewer?.facts ?? {};
  const map: CatalogEntityRead = match.map;
  return {
    id: match.id,
    home_team_id: one?.tournament_team_id ?? null,
    away_team_id: two?.tournament_team_id ?? null,
    score: { home: one?.team_facts.score, away: two?.team_facts.score },
    time: match.duration_s,
    log_name: match.log_name,
    raw_status: match.raw_status,
    raw_available: match.raw_available,
    encounter_id: match.encounter_id,
    map_id: match.map_id,
    map_index: match.map_index,
    map: {
      id: map.id,
      gamemode_id: map.parent_id,
      name: map.name,
      image_path: map.image_path,
      ...(map.parent
        ? {
            gamemode: {
              id: map.parent.id,
              slug: map.parent.slug,
              name: map.parent.name,
              image_path: map.parent.image_path,
              aliases: map.parent.aliases
            }
          }
        : {}),
      aliases: map.aliases
    },
    performance: facts.performance ?? null,
    impact_rank: facts.impact_rank ?? null,
    impact_points: facts.impact_points ?? null,
    overperformance_score: facts.overperformance_score ?? null,
    overperformance_badge: overperformanceBadge(match),
    heroes: (match.viewer?.characters ?? []).map((character) => ({
      id: character.id,
      slug: character.slug,
      name: character.name,
      image_path: character.image_path,
      type: character.attrs.class,
      aliases: character.aliases
    }))
  };
};
const oldEncounter = (encounter: EncounterWithUserStats) => ({ ...encounter, matches: encounter.matches.map(oldUserMatch) });

describe("users/components/shared/encounter-perspective.ts", () => {
  it("reproduces every captured perspective and map result from the real native wire", () => {
    const fixture = read(PRE, "encounter-perspective.json");
    const selfIds: Record<string, { self_user_id: number }> = fixture.input_old_wire;
    const perResponse: Record<string, unknown> = {};
    for (const player of PLAYERS) {
      for (const [label, rec] of ok(
        native<{ results: EncounterWithUserStats[] }>(`mvp-rank.${player}.json`),
        (l) => l.endsWith(":encounters")
      )) {
        const selfId = selfIds[label].self_user_id;
        perResponse[label] = rec.body.results.map((enc) => {
          const own = perspective.encounterPerspective(enc, selfId);
          return {
            encounter_id: enc.id,
            default: own,
            explicit_team: perspective.encounterPerspective(enc, selfId, enc.user_team_id),
            unknown_team: perspective.encounterPerspective(enc, selfId, -1),
            map_kinds: enc.matches.map((m) => ({ match: m.id, kind: perspective.mapKind(m, own.own) }))
          };
        });
      }
    }
    expect(
      norm({ USER_ENCOUNTER_ENTITIES: perspective.USER_ENCOUNTER_ENTITIES, per_response: perResponse })
    ).toEqual(fixture.output);
  });
});

describe("users/components/tournaments/tournaments-history.helpers.ts (+ OW avgMvpPlacement)", () => {
  it("reproduces every captured grouping, aggregate, medal and stage record from the real native wire", () => {
    const fixture = read(PRE, "tournaments-history-helpers.json");
    const selfIds: Record<string, { self_user_id: number }> = fixture.input_old_wire;
    const perResponse: Record<string, unknown> = {};
    for (const player of PLAYERS) {
      for (const scope of SCOPES) {
        const records = native<UserTournament[] | EncounterWithUserStats[]>(`users-tournaments.${player}.${scope}.json`);
        for (const [label, rec] of ok(records as Captures<UserTournament[]>, (l) => l.endsWith(":tournaments"))) {
          const prefix = label.replace(/:tournaments$/, "");
          const selfId = selfIds[label].self_user_id;
          const tournaments = rec.body.map((t) => {
            const found = ok(records as Captures<EncounterWithUserStats[]>, (key) =>
              key.startsWith(`${prefix}:tournament_encounters:`)
            ).find(([, value]) => value.request.path.endsWith(`/tournaments/${t.id}/encounters`));
            return found ? { ...t, encounters: found[1].body } : t;
          });
          perResponse[label] = {
            groups: history.groupTournamentsByLeague(tournaments).map((group) => ({
              is_league: history.isLeagueGroup(group),
              entries: history.groupEntries(group).map((t) => t.id),
              rep_id: history.groupRepId(group),
              tournament_ids: history.groupTournamentIds(group),
              display_name: history.groupDisplayName(group),
              best_placement: history.groupBestPlacement(group),
              aggregate: history.groupAggregate(group),
              avg_mvp: avgMvpPlacement(history.groupEntries(group))
            })),
            tournaments: tournaments.map((t) => {
              const pct = history.mapsWinratePct(t.maps_won, t.maps_lost);
              return {
                id: t.id,
                league_key: history.leagueKey(t),
                division_label: history.divisionLabel(t),
                medal: history.placementMedal(t.placement),
                maps_winrate_pct: pct,
                winrate_color: history.winrateColor(pct),
                stages: history.groupEncountersByStage(t, selfId).map((stage) => ({
                  ...stage,
                  encounters: stage.encounters.map(oldEncounter)
                }))
              };
            })
          };
        }
      }
    }
    type Captured = { per_response: Record<string, { tournaments: Record<string, unknown>[] }>; medals: unknown };
    const captured = fixture.output as Captured;
    const withoutRoleColors = {
      per_response: Object.fromEntries(
        Object.entries(captured.per_response).map(([label, value]) => [
          label,
          {
            ...value,
            tournaments: value.tournaments.map((t) => {
              const { role_color: _role, player_role_colors: _players, ...rest } = t;
              void _role;
              void _players;
              return rest;
            })
          }
        ])
      )
    };
    expect(Object.keys(perResponse).length).toBe(18);
    expect(norm({ per_response: perResponse })).toEqual(removedFields(withoutRoleColors));
    expect(
      norm([1, 2, 3, 4, null].map((p) => [String(p), history.placementMedal(p)]))
    ).toEqual(captured.medals);
  });

  it("drops only hero colours that were the seed default", () => {
    expect([...HERO_COLORS].every((color) => color === "#ffffff")).toBe(true);
  });
});
