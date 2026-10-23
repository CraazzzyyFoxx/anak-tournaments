import { describe, expect, it } from "vitest";

import { native, norm, ok, PLAYERS, PRE, read } from "@/test/users-parity";
import type { CharacterLeaderboardEntry } from "@/types/statistics.types";
import type { CharacterSummary } from "@/types/user.types";

import { LogStatsName } from "../stat-names";
import * as statColumns from "./compare/stat-columns";
import * as characterUtils from "./utils";

/** §10.2 users rows, the Overwatch module's half (fixtures, renames and dropped fields: `@/test/users-parity`). */
const fmt = {
  number: (value: number, options?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat("en-US", options).format(value)
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

describe("users/heroes-compare/config/stat-columns.ts → disciplines/overwatch/character/compare/stat-columns", () => {
  const expected = read(PRE, "heroes-compare-stat-columns.json").output;
  const columns = Object.values(statColumns.COL).map(({ key, labelKey, ascending }) => ({ key, labelKey, ascending }));

  type Parity = {
    columns: { key: string; labelKey: string; ascending: boolean }[];
    per_response: Record<string, { columns: Record<string, { formatted?: string }> }[]>;
  };

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
    }) as Parity;
    // The board went monochrome after the move: a column no longer carries its own bar and accent colours, so the
    // captured ones (U1's included) are no longer the contract.
    const withoutColours = (value: Parity) => ({
      ...value,
      columns: value.columns.map(({ key, labelKey, ascending }) => ({ key, labelKey, ascending }))
    });
    // Fixed after the move: accuracy is a fraction on the wire and the pre-move board printed 0.5 as "0.5%".
    // stat-columns.test.ts pins the corrected text, so the captured strings are no longer the contract.
    const withoutAccuracyText = (value: Parity) => {
      const copy = norm(value) as Parity;
      for (const rows of Object.values(copy.per_response)) {
        for (const row of rows) {
          delete row.columns.avg_weapon_accuracy.formatted;
          delete row.columns.avg_crit_accuracy.formatted;
        }
      }
      return copy;
    };
    const comparable = (value: Parity) => withoutColours(withoutAccuracyText(value));
    expect(comparable(actual)).toEqual(comparable(expected));
  });
});
