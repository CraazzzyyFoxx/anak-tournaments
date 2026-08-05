import { describe, expect, it } from "vitest";

import type { AdminRegistration } from "@/types/balancer-admin.types";
import type { CustomFieldDefinition } from "@/types/registration.types";

import { buildBalancerRegistrationColumns } from "./balancerRegistrationColumns";

const CUSTOM_FIELDS: CustomFieldDefinition[] = [
  { key: "vk", label: "VK profile", type: "text", required: false, options: null },
  { key: "rules", label: "Read the rules", type: "checkbox", required: true, options: null },
];

function registration(overrides: Partial<AdminRegistration> = {}): AdminRegistration {
  return {
    id: 1,
    battle_tag: "Player#1234",
    display_name: "Player",
    discord_nick: "player",
    twitch_nick: "player_tv",
    boosty_nick: "player_boosty",
    smurf_tags_json: [],
    custom_fields_json: null,
    source: "manual",
    source_record_key: null,
    ...overrides,
  } as unknown as AdminRegistration;
}

describe("balancer registration column model", () => {
  it("builds one column per custom-field definition", () => {
    // The admin table rendered no custom fields at all: an organizer could read
    // an answer nowhere and fix it nowhere.
    const ids = buildBalancerRegistrationColumns(undefined, false, false, CUSTOM_FIELDS).map(
      (column) => column.id,
    );

    expect(ids).toContain("custom_vk");
    expect(ids).toContain("custom_rules");
  });

  it("reads the stored answer for its own definition", () => {
    const [vk] = buildBalancerRegistrationColumns(undefined, false, false, CUSTOM_FIELDS).filter(
      (column) => column.id === "custom_vk",
    );

    const value = vk.searchValue?.(registration({ custom_fields_json: { vk: "vk.com/player" } }));
    expect(value).toBe("vk.com/player");
  });

  it("adds no custom columns when the form defines none", () => {
    const ids = buildBalancerRegistrationColumns().map((column) => column.id);

    expect(ids.some((id) => id.startsWith("custom_"))).toBe(false);
  });

  it("searches the participant by every handle, boosty included", () => {
    const [participant] = buildBalancerRegistrationColumns().filter(
      (column) => column.id === "participant",
    );

    expect(participant.searchValue?.(registration())).toContain("player_boosty");
  });
});
