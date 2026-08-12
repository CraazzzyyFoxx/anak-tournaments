import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { DraftPlayer } from "@/types/draft.types";

mock.module("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key
}));

// Dynamic, not static: `mock.module` only applies to modules imported after it
// runs, and the component calls `useTranslations` at render time.
const { PlayerInspector } = await import("./PlayerInspector");

function player(overrides: Partial<DraftPlayer> = {}): DraftPlayer {
  return {
    id: 7,
    session_id: 1,
    user_id: null,
    battle_tag: "Ana#1234",
    primary_role: "support",
    sub_role: null,
    is_flex: false,
    division_number: null,
    rank_value: 3000,
    effective_rank: 3000,
    status: "available",
    is_captain: false,
    drafted_by_team_id: null,
    secondary_roles_json: null,
    role_ranks: {},
    role_top_heroes: {},
    additional_info: {},
    custom_fields: [],
    version: 1,
    ...overrides
  };
}

function render(subject: DraftPlayer) {
  return renderToStaticMarkup(
    <PlayerInspector
      player={subject}
      role="support"
      options={null}
      safetyRequired={false}
      onRoleChange={() => {}}
      onClose={() => {}}
      divisionGrid={{ tiers: [] }}
    />
  );
}

describe("player inspector registration answers", () => {
  test("renders each draft-visible custom field with its label", () => {
    const html = render(
      player({
        custom_fields: [
          { key: "vk", label: "VK profile", type: "url", value: "https://vk.com/ana" },
          { key: "shift", label: "Preferred shift", type: "select", value: "Evening" },
          { key: "rules", label: "Rules read", type: "checkbox", value: false }
        ]
      })
    );

    expect(html).toContain("VK profile");
    expect(html).toContain("https://vk.com/ana");
    expect(html).toContain("Preferred shift");
    expect(html).toContain("Evening");
    // A checkbox "no" is an answer, and it renders as a word rather than the
    // raw `false` a plain String() would produce.
    expect(html).toContain("Rules read");
    expect(html).toContain("customFieldNo");
    expect(html).not.toContain("false<");
  });

  test("shows the notes block and the answers block independently", () => {
    const notesOnly = render(player({ additional_info: { notes: "prefers Ana" } }));
    expect(notesOnly).toContain("prefers Ana");

    const answersOnly = render(
      player({ custom_fields: [{ key: "vk", label: "VK profile", type: "text", value: "ana" }] })
    );
    expect(answersOnly).toContain("VK profile");
    // The shared divider only appears once there is something below it.
    expect(answersOnly).not.toContain(">note<");

    const neither = render(player());
    expect(neither).not.toContain(">note<");
    expect(neither).not.toContain("VK profile");
  });
});
