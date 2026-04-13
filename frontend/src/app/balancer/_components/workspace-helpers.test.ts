import {
  createSyntheticApplicationFromRegistration,
  createSyntheticPlayerFromRegistration,
  getPlayerValidationIssues,
  isRegistrationIncludedInBalancer,
} from "@/app/balancer/_components/workspace-helpers";
import type { AdminRegistration, BalancerApplication, BalancerPlayerRecord } from "@/types/balancer-admin.types";

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

function createRegistration(overrides: Partial<AdminRegistration>): AdminRegistration {
  return {
    id: 10,
    tournament_id: 60,
    workspace_id: 3,
    auth_user_id: null,
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
    balancer_status: "ready",
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
