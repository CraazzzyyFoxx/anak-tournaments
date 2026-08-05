/**
 * TS half of the effective-rank parity check, for both every-role modes
 * (`all_roles` and `forced`).
 *
 * The rule lives in two languages -- `flattenRolesToMaxRank` here and
 * `_map_registration` in balancer-service -- because the balancer payload is
 * assembled on the client while the draft is seeded on the server, with no
 * shared module between them. That duplication is the accepted cost of the
 * current architecture, so it is pinned rather than trusted: both sides read the
 * same fixtures and must agree.
 *
 * Python half: backend/balancer-service/tests/test_forced_flex_parity.py
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { flattenRolesToMaxRank } from "@/app/balancer/components/workspace-helpers";
import { DEFAULT_DIVISION_GRID } from "@/lib/division-grid";
import type { AdminRegistrationRole, BalancerRoleCode } from "@/types/balancer-admin.types";

interface FixtureRole {
  role: BalancerRoleCode;
  rank_value: number | null;
  ow_rank_value: number | null;
  is_active: boolean;
}

interface FixtureCase {
  name: string;
  roles: FixtureRole[];
  expected: { eff_rank: number | null; eff_ow_rank: number | null };
}

const FIXTURES: { cases: FixtureCase[] } = JSON.parse(
  readFileSync(
    join(process.cwd(), "..", "docs", "superpowers", "fixtures", "forced-flex-eff-rank.json"),
    "utf-8",
  ),
);

function toRegistrationRole(role: FixtureRole, index: number): AdminRegistrationRole {
  return {
    role: role.role,
    subrole: null,
    is_primary: true,
    priority: index,
    rank_value: role.rank_value,
    is_active: role.is_active,
    ow_rank_value: role.ow_rank_value,
  };
}

describe("forced-flex effective rank parity (TS side)", () => {
  it("loads the shared fixtures", () => {
    expect(FIXTURES.cases.length).toBeGreaterThan(0);
  });

  for (const testCase of FIXTURES.cases) {
    it(`${testCase.name}: every role carries eff_rank`, () => {
      const entries = flattenRolesToMaxRank(testCase.roles.map(toRegistrationRole), DEFAULT_DIVISION_GRID);

      expect(entries.length).toBe(3);
      expect(entries.map((entry) => entry.rank_value)).toEqual([
        testCase.expected.eff_rank,
        testCase.expected.eff_rank,
        testCase.expected.eff_rank,
      ]);
    });

    it(`${testCase.name}: is_active tracks whether a rank exists`, () => {
      const entries = flattenRolesToMaxRank(testCase.roles.map(toRegistrationRole), DEFAULT_DIVISION_GRID);

      const expected = testCase.expected.eff_rank !== null;
      expect(entries.every((entry) => entry.is_active === expected)).toBe(true);
    });

    it(`${testCase.name}: eff_ow_rank is carried exactly once`, () => {
      const entries = flattenRolesToMaxRank(testCase.roles.map(toRegistrationRole), DEFAULT_DIVISION_GRID);

      const carried = entries.map((entry) => entry.ow_rank_value).filter((value) => value !== null);
      if (testCase.expected.eff_ow_rank === null) {
        expect(carried.length).toBe(0);
      } else {
        expect(carried).toEqual([testCase.expected.eff_ow_rank]);
      }
    });
  }
});
