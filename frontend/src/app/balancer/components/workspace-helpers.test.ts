import {
  derivePoolLane,
  formatBattleTagsForClipboard,
  formatSmurfCount,
  getRegistrationBattleTags,
  getPoolDropPatch,
  type PlayerValidationState,
  type PoolLane,
} from "@/app/balancer/components/balancer-page-helpers";
import {
  convertBalanceResponseToInternalPayload,
  createSyntheticApplicationFromRegistration,
  createSyntheticPlayerFromRegistration,
  getPlayerValidationIssues,
  isRegistrationIncludedInBalancer,
  ratesByMaxRank,
  type PlayerValidationIssue,
} from "@/app/balancer/components/workspace-helpers";
import type {
  AdminRegistration,
  AdminRegistrationRole,
  BalancerApplication,
  BalancerPlayerRecord,
  BuiltInFieldConfig,
} from "@/types/balancer-admin.types";
import type { BalanceResponse, PlayerData } from "@/types/balancer.types";
import { DEFAULT_DIVISION_GRID } from "@/lib/division-grid";
import type { StatusMeta, StatusScope } from "@/types/registration.types";

type TestFunction = () => void | Promise<void>;
type Expectation<T> = {
  toBe: (expected: T) => void;
  toEqual: (expected: unknown) => void;
  toBeNull: () => void;
  toBeUndefined: () => void;
};

declare const describe: (name: string, fn: TestFunction) => void;
declare const it: {
  (name: string, fn: TestFunction): void;
  each<TArgs extends readonly unknown[]>(cases: readonly TArgs[]): (name: string, fn: (...args: TArgs) => void | Promise<void>) => void;
};
declare const expect: <T>(actual: T) => Expectation<T>;

function createPlayer(overrides: Partial<BalancerPlayerRecord>): BalancerPlayerRecord {
  return {
    id: 1,
    tournament_id: 60,
    application_id: 10,
    battle_tag: "player#1234",
    battle_tag_normalized: "player#1234",
    user_id: 1,
    role_entries_json: [],
    is_flex: false,
    is_in_pool: true,
    admin_notes: null,
    ...overrides,
  };
}

function createApplication(overrides: Partial<BalancerApplication>): BalancerApplication {
  return {
    id: 10,
    tournament_id: 60,
    tournament_sheet_id: 1,
    battle_tag: "player#1234",
    battle_tag_normalized: "player#1234",
    smurf_tags_json: [],
    twitch_nick: null,
    discord_nick: null,
    stream_pov: false,
    last_tournament_text: null,
    primary_role: "support",
    additional_roles_json: ["dps"],
    notes: null,
    submitted_at: null,
    synced_at: "2026-03-14T00:00:00Z",
    is_active: true,
    player: null,
    ...overrides,
  };
}

function createStatusMeta(value: string, scope: StatusScope, name: string): StatusMeta {
  return {
    value,
    scope,
    is_builtin: true,
    kind: "builtin",
    is_override: false,
    can_edit: false,
    can_delete: false,
    can_reset: false,
    icon_slug: null,
    icon_color: null,
    name,
    description: null,
  };
}

function createRegistration(overrides: Partial<AdminRegistration> = {}): AdminRegistration {
  return {
    id: 10,
    tournament_id: 60,
    workspace_id: 3,
    user_id: 1,
    display_name: "Player",
    battle_tag: "player#1234",
    battle_tag_normalized: "player#1234",
    source: "manual",
    source_record_key: null,
    smurf_tags_json: [],
    discord_nick: null,
    twitch_nick: null,
    stream_pov: false,
    roles: [
      {
        role: "support",
        subrole: null,
        is_primary: true,
        priority: 0,
        rank_value: 900,
        is_active: true,
      },
      {
        role: "dps",
        subrole: null,
        is_primary: false,
        priority: 1,
        rank_value: 700,
        is_active: true,
      },
    ],
    notes: null,
    admin_notes: null,
    custom_fields_json: null,
    is_flex: false,
    status: "approved",
    status_meta: createStatusMeta("approved", "registration", "Approved"),
    balancer_status: "ready",
    balancer_status_meta: createStatusMeta("ready", "balancer", "Ready"),
    exclude_from_balancer: false,
    exclude_reason: null,
    checked_in: false,
    checked_in_at: null,
    checked_in_by_username: null,
    deleted_at: null,
    submitted_at: null,
    reviewed_at: null,
    reviewed_by_username: null,
    balancer_profile_overridden_at: null,
    ...overrides,
  };
}

describe("getPlayerValidationIssues", () => {
  it("does not flag support main-heal plus dps as mismatch", () => {
    const player = createPlayer({
      role_entries_json: [
        {
          role: "support",
          subtype: "main_heal",
          priority: 1,
          division_number: 12,
          rank_value: 900,
          is_active: true,
        },
        {
          role: "dps",
          subtype: null,
          priority: 2,
          division_number: 14,
          rank_value: 700,
          is_active: true,
        },
      ],
    });
    const application = createApplication({
      primary_role: "support",
      additional_roles_json: ["dps"],
    });

    const issues = getPlayerValidationIssues(player, application);

    expect(issues.find((issue) => issue.code === "application_role_mismatch")).toBeUndefined();
  });

  it("does not flag missing optional secondary role when primary role matches", () => {
    const player = createPlayer({
      role_entries_json: [
        {
          role: "dps",
          subtype: "hitscan",
          priority: 1,
          division_number: 12,
          rank_value: 900,
          is_active: true,
        },
      ],
    });
    const application = createApplication({
      primary_role: "dps",
      additional_roles_json: ["support"],
    });

    const issues = getPlayerValidationIssues(player, application);

    expect(issues.find((issue) => issue.code === "application_role_mismatch")).toBeUndefined();
  });

  it("does not flag flex secondary subrole gaps as mismatch when main roles match", () => {
    const player = createPlayer({
      role_entries_json: [
        {
          role: "support",
          subtype: "main_heal",
          priority: 1,
          division_number: 12,
          rank_value: 900,
          is_active: true,
        },
        {
          role: "dps",
          subtype: null,
          priority: 2,
          division_number: 14,
          rank_value: 700,
          is_active: true,
        },
      ],
      is_flex: true,
    });
    const application = createApplication({
      primary_role: "support",
      additional_roles_json: ["dps"],
    });

    const issues = getPlayerValidationIssues(player, application);

    expect(issues.find((issue) => issue.code === "application_role_mismatch")).toBeUndefined();
  });

  it("emits a rank-delta warning for every role that exceeds the threshold", () => {
    const player = createPlayer({
      role_entries_json: [
        { role: "support", subtype: null, priority: 0, division_number: null, rank_value: 900, is_active: true, ow_rank_value: 2000 },
        { role: "dps", subtype: null, priority: 1, division_number: null, rank_value: 700, is_active: true, ow_rank_value: 1900 },
      ],
    });

    const issues = getPlayerValidationIssues(player, null, { rank_delta_threshold: 100 });
    const deltaIssues = issues.filter(
      (issue): issue is Extract<PlayerValidationIssue, { code: "rank_delta_warning" }> =>
        issue.code === "rank_delta_warning",
    );

    expect(deltaIssues.length).toBe(2);
    // Worst delta first: dps (Δ1200) before support (Δ1100).
    expect(deltaIssues.map((issue) => issue.role).join(",")).toBe("dps,support");
  });
});

describe("pool lane helpers", () => {
  function createState(playerOverrides: Partial<BalancerPlayerRecord>, issues: PlayerValidationState["issues"] = []): PlayerValidationState {
    return {
      player: createPlayer(playerOverrides),
      issues,
    };
  }

  it.each([
    ["excluded", createState({ is_in_pool: false })],
    ["needs_fix", createState({ is_in_pool: true }, [{ code: "missing_ranked_role", message: "No ranked roles configured" }])],
    ["ready", createState({ is_in_pool: true })],
  ] satisfies Array<[PoolLane, PlayerValidationState]>)("derives %s from pool membership and validation issues", (expectedLane, state) => {
    expect(derivePoolLane(state)).toBe(expectedLane);
  });

  it.each([
    ["excluded", false],
    ["needs_fix", true],
    ["ready", true],
  ] satisfies Array<[PoolLane, boolean]>)("maps a drop into %s to the correct pool membership patch", (targetLane, expectedInPool) => {
    expect(getPoolDropPatch(targetLane)).toEqual({ is_in_pool: expectedInPool });
  });

  it("auto-classifies an included roleless player back into Need Fix", () => {
    const patch = getPoolDropPatch("ready");
    const player = createPlayer({ is_in_pool: patch.is_in_pool });

    expect(derivePoolLane({ player, issues: getPlayerValidationIssues(player, null) })).toBe("needs_fix");
  });

  it("auto-classifies an included valid player into Ready", () => {
    const patch = getPoolDropPatch("needs_fix");
    const player = createPlayer({
      is_in_pool: patch.is_in_pool,
      role_entries_json: [
        {
          role: "support",
          subtype: null,
          priority: 1,
          division_number: 12,
          rank_value: 900,
          is_active: true,
        },
      ],
    });

    expect(derivePoolLane({ player, issues: getPlayerValidationIssues(player, null) })).toBe("ready");
  });

  it("keeps a player whose only issue is a rank-delta warning in Ready", () => {
    const player = createPlayer({
      role_entries_json: [
        { role: "support", subtype: null, priority: 1, division_number: 12, rank_value: 900, is_active: true, ow_rank_value: 2000 },
      ],
    });
    const issues = getPlayerValidationIssues(player, null, { rank_delta_threshold: 100 });

    // The advisory rank-delta chip is still emitted as informational context...
    expect(issues.some((issue) => issue.code === "rank_delta_warning")).toBe(true);
    // ...but a rank delta on its own must not push the player into Need Fix.
    expect(derivePoolLane({ player, issues })).toBe("ready");
  });

  it("still routes a rank-delta player into Need Fix when a blocking issue is also present", () => {
    const player = createPlayer({
      role_entries_json: [
        { role: "support", subtype: null, priority: 1, division_number: 12, rank_value: 900, is_active: true, ow_rank_value: 2000 },
      ],
    });
    const application = createApplication({ primary_role: "tank", additional_roles_json: [] });
    const issues = getPlayerValidationIssues(player, application, { rank_delta_threshold: 100 });

    expect(issues.some((issue) => issue.code === "rank_delta_warning")).toBe(true);
    expect(issues.some((issue) => issue.code === "application_role_mismatch")).toBe(true);
    expect(derivePoolLane({ player, issues })).toBe("needs_fix");
  });
});

describe("battle tag clipboard helpers", () => {
  it("returns the primary BattleTag followed by unique non-empty smurf tags", () => {
    const registration = createRegistration({
      battle_tag: "Main#1111",
      smurf_tags_json: ["Alt#2222", " ", "Main#1111", "alt#2222", "Pocket#3333"],
    });

    expect(getRegistrationBattleTags(registration, "Fallback#0000")).toEqual([
      "Main#1111",
      "Alt#2222",
      "Pocket#3333",
    ]);
  });

  it("falls back to the player BattleTag and formats tags for clipboard", () => {
    const registration = createRegistration({
      battle_tag: null,
      smurf_tags_json: ["Practice#4444"],
    });

    const battleTags = getRegistrationBattleTags(registration, "Player#1234");

    expect(battleTags).toEqual(["Player#1234", "Practice#4444"]);
    expect(formatBattleTagsForClipboard(battleTags)).toBe("Player#1234\nPractice#4444");
  });

  it("formats smurf count labels for collapsed UI", () => {
    expect(formatSmurfCount(1)).toBe("1 smurf");
    expect(formatSmurfCount(3)).toBe("3 smurfs");
  });
});

describe("synthetic registration helpers", () => {
  it("keeps incomplete approved non-excluded registrations in the pool", () => {
    const registration = createRegistration({
      balancer_status: "incomplete",
      exclude_from_balancer: false,
    });

    expect(isRegistrationIncludedInBalancer(registration)).toBe(true);

    const player = createSyntheticPlayerFromRegistration(registration);

    expect(player.is_in_pool).toBe(true);
  });

  it("excludes registrations marked out of balancer even if status is ready", () => {
    const registration = createRegistration({
      balancer_status: "ready",
      exclude_from_balancer: true,
    });

    expect(isRegistrationIncludedInBalancer(registration)).toBe(false);

    const player = createSyntheticPlayerFromRegistration(registration);

    expect(player.is_in_pool).toBe(false);
  });

  it("derives flex only when all roles are primary", () => {
    const flexRegistration = createRegistration({
      roles: [
        {
          role: "tank",
          subrole: null,
          is_primary: true,
          priority: 0,
          rank_value: 1100,
          is_active: true,
        },
        {
          role: "support",
          subrole: null,
          is_primary: true,
          priority: 1,
          rank_value: 1200,
          is_active: true,
        },
      ],
    });
    const strictRegistration = createRegistration();

    expect(createSyntheticPlayerFromRegistration(flexRegistration).is_flex).toBe(true);
    expect(createSyntheticPlayerFromRegistration(strictRegistration).is_flex).toBe(false);
  });

  it("builds flex applications without a primary role", () => {
    const registration = createRegistration({
      roles: [
        {
          role: "tank",
          subrole: null,
          is_primary: true,
          priority: 0,
          rank_value: 1100,
          is_active: true,
        },
        {
          role: "support",
          subrole: null,
          is_primary: true,
          priority: 1,
          rank_value: 1200,
          is_active: true,
        },
      ],
    });

    const player = createSyntheticPlayerFromRegistration(registration);
    const application = createSyntheticApplicationFromRegistration(registration, player);

    expect(application.primary_role).toBeNull();
    expect(application.additional_roles_json).toEqual(["tank", "support"]);
    expect(application.player).toBe(player);
  });
});

describe("every-role effective ranks", () => {
  const role = (
    roleCode: "tank" | "dps" | "support",
    rank: number | null,
    ow: number | null = null,
    extra: { is_active?: boolean; subrole?: string | null; priority?: number } = {},
  ): AdminRegistrationRole => ({
    role: roleCode,
    subrole: extra.subrole ?? null,
    is_primary: true,
    priority: extra.priority ?? 0,
    rank_value: rank,
    is_active: extra.is_active ?? true,
    ow_rank_value: ow,
  });

  const flattened = (roles: AdminRegistrationRole[]) =>
    createSyntheticPlayerFromRegistration(createRegistration({ roles }), DEFAULT_DIVISION_GRID, {
      allRoles: true,
    });

  it("applies the max rank to all three roles", () => {
    const player = flattened([role("dps", 3900), role("support", 2400, null, { priority: 1 })]);

    expect(player.role_entries_json.map((entry) => entry.role)).toEqual(["tank", "dps", "support"]);
    expect(player.role_entries_json.every((entry) => entry.rank_value === 3900)).toBe(true);
  });

  it("covers the unranked roles from a single ranked one", () => {
    const player = flattened([role("dps", 3900)]);

    expect(player.role_entries_json.every((entry) => entry.rank_value === 3900)).toBe(true);
    expect(player.role_entries_json.every((entry) => entry.is_active)).toBe(true);
  });

  it("attaches the effective OW rank to the role that produced it", () => {
    // Replicating it across all three would emit the same rank_delta_warning
    // three times; leaving it per-role would compare an effective rank against
    // an unrelated role's OW rank. One comparison, one carrier.
    const player = flattened([role("dps", 3900, 4100), role("support", 2400, 2000, { priority: 1 })]);

    const owByRole: Record<string, number | null> = Object.fromEntries(
      player.role_entries_json.map((entry) => [entry.role, entry.ow_rank_value]),
    );
    expect(owByRole.dps).toBe(4100);
    expect(owByRole.support).toBeNull();
    expect(owByRole.tank).toBeNull();
  });

  it("yields one rank-delta chip instead of three", () => {
    const player = flattened([role("dps", 3900, 4400), role("support", 2400, 2000, { priority: 1 })]);

    const issues = getPlayerValidationIssues(player, null, { rank_delta_threshold: 300 });

    expect(issues.filter((issue) => issue.code === "rank_delta_warning").length).toBe(1);
  });

  it("keeps a within-threshold delta silent", () => {
    const player = flattened([role("dps", 3900, 4100), role("support", 2400, 2000, { priority: 1 })]);

    const issues = getPlayerValidationIssues(player, null, { rank_delta_threshold: 300 });

    expect(issues.length).toBe(0);
  });

  it("counts an inactive role's rank and makes the role playable", () => {
    const player = flattened([role("tank", 3100, null, { is_active: false })]);

    expect(player.role_entries_json.every((entry) => entry.rank_value === 3100)).toBe(true);
    expect(player.role_entries_json.every((entry) => entry.is_active)).toBe(true);
  });

  it("leaves a rankless registration out of the pool without disabling its roles", () => {
    const player = flattened([role("dps", null)]);

    expect(player.role_entries_json.every((entry) => entry.rank_value === null)).toBe(true);
    // The roles stay playable — the mode says so, and the autofill that fills the
    // ranks only looks at active roles. The missing rank is what keeps the player
    // out of a balance run.
    expect(player.role_entries_json.every((entry) => entry.is_active)).toBe(true);
    expect(
      getPlayerValidationIssues(player, null).some((issue) => issue.code === "missing_ranked_role"),
    ).toBe(true);
  });

  it("keeps each role's own specialization", () => {
    const player = flattened([
      role("dps", 3900, null, { subrole: "hitscan" }),
      role("support", 2400, null, { subrole: "main_heal", priority: 1 }),
    ]);

    const subtypeByRole: Record<string, string | null> = Object.fromEntries(
      player.role_entries_json.map((entry) => [entry.role, entry.subtype]),
    );
    expect(subtypeByRole.dps).toBe("hitscan");
    expect(subtypeByRole.support).toBe("main_heal");
    expect(subtypeByRole.tank).toBeNull();
  });

  it("changes nothing when the mode is optional", () => {
    const roles = [role("dps", 3900, 4100), role("support", 2400, 2000, { priority: 1 })];
    const registration = createRegistration({ roles });

    const player = createSyntheticPlayerFromRegistration(registration);

    expect(player.role_entries_json.map((entry) => entry.rank_value)).toEqual([3900, 2400]);
    expect(player.role_entries_json.map((entry) => entry.ow_rank_value)).toEqual([4100, 2000]);
  });
});

describe("ratesByMaxRank", () => {
  const config = (overrides: Partial<BuiltInFieldConfig> = {}): BuiltInFieldConfig =>
    ({ enabled: true, required: false, ...overrides }) as BuiltInFieldConfig;

  it("is on for all_roles and forced", () => {
    expect(ratesByMaxRank(config({ mode: "all_roles" }))).toBe(true);
    expect(ratesByMaxRank(config({ mode: "forced" }))).toBe(true);
  });

  it("is off for optional and for an absent mode", () => {
    expect(ratesByMaxRank(config({ mode: "optional" }))).toBe(false);
    expect(ratesByMaxRank(config())).toBe(false);
  });

  it("is off for a disabled field whatever the stored mode", () => {
    // Disabling the field bans flex outright, so a stale mode must not survive it.
    expect(ratesByMaxRank(config({ enabled: false, mode: "forced" }))).toBe(false);
  });

  it("fails closed on an unreadable config", () => {
    // The caller passes a query result: guessing an every-role mode while the
    // form is still loading would inflate every player's effective rank.
    expect(ratesByMaxRank(undefined)).toBe(false);
    expect(ratesByMaxRank(null)).toBe(false);
  });
});

describe("convertBalanceResponseToInternalPayload", () => {
  const player = (overrides: Partial<PlayerData> = {}): PlayerData => ({
    uuid: "p1",
    name: "player#1234",
    assigned_rating: 3000,
    role_discomfort: 0,
    is_captain: false,
    role_preferences: ["tank", "dps"],
    all_ratings: { tank: 3000, dps: 2800 },
    all_discomforts: { tank: 0, dps: 100, support: 5000 },
    ...overrides,
  });

  const response = (roster: Record<string, PlayerData[]>): BalanceResponse =>
    ({
      teams: [
        {
          id: 1,
          name: "player#1234",
          average_mmr: 3000,
          rating_variance: 0,
          total_discomfort: 0,
          max_discomfort: 0,
          roster,
        },
      ],
      statistics: {},
    }) as unknown as BalanceResponse;

  it("re-keys the solver's canonical roster codes onto the editor's buckets", () => {
    // The solver keys the response by the tournament roster shape's slot codes,
    // so a run whose roster arrives as tank/dps/support must still land in the
    // Tank/Damage/Support buckets the editor and result_json use.
    const payload = convertBalanceResponseToInternalPayload(
      response({ tank: [player({ uuid: "t" })], dps: [player({ uuid: "d" })], support: [player({ uuid: "s" })] }),
    );

    const roster = payload.teams[0].roster;
    expect(roster.Tank.map((entry) => entry.uuid)).toEqual(["t"]);
    expect(roster.Damage.map((entry) => entry.uuid)).toEqual(["d"]);
    expect(roster.Support.map((entry) => entry.uuid)).toEqual(["s"]);
  });

  it("re-keys the per-role player maps the editor compares against roster keys", () => {
    const payload = convertBalanceResponseToInternalPayload(response({ tank: [player()] }));

    const entry = payload.teams[0].roster.Tank[0];
    expect(entry.role_preferences).toEqual(["Tank", "Damage"]);
    expect(entry.all_ratings).toEqual({ Tank: 3000, Damage: 2800 });
    expect(entry.all_discomforts).toEqual({ Tank: 0, Damage: 100, Support: 5000 });
  });

  it("keeps display-name payloads unchanged", () => {
    // Saved balances and pre-roster-shape runs carry the display names already.
    const legacy = player({
      role_preferences: ["Damage"],
      all_ratings: { Damage: 2800 },
      all_discomforts: { Damage: 0 },
    });

    const payload = convertBalanceResponseToInternalPayload(response({ Damage: [legacy] }));

    const entry = payload.teams[0].roster.Damage[0];
    expect(entry.role_preferences).toEqual(["Damage"]);
    expect(entry.all_ratings).toEqual({ Damage: 2800 });
  });

  it("normalizes benched players the same way", () => {
    const benched = { ...response({}), benched_players: [player({ uuid: "b" })] };

    const payload = convertBalanceResponseToInternalPayload(benched);

    expect(payload.benched_players?.[0].all_ratings).toEqual({ Tank: 3000, Damage: 2800 });
  });
});
