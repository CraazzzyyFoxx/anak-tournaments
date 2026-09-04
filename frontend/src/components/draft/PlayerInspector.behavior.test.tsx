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

// Two tiers so a rank maps to a division number a test can tell apart. An empty
// grid resolves every rank to null, which would make a rank assertion vacuous.
const GRID = {
  tiers: [
    { slug: "high", number: 9, name: "High", sort_order: 0, rank_min: 3000, rank_max: 3999, icon_url: "/high.png" },
    { slug: "low", number: 4, name: "Low", sort_order: 1, rank_min: 2000, rank_max: 2999, icon_url: "/low.png" }
  ]
};

function render(subject: DraftPlayer, divisionGrid: { tiers: typeof GRID.tiers } = { tiers: [] }) {
  return renderToStaticMarkup(
    <PlayerInspector
      player={subject}
      role="support"
      options={null}
      safetyRequired={false}
      onRoleChange={() => {}}
      onClose={() => {}}
      divisionGrid={divisionGrid}
    />
  );
}

describe("player inspector flex roles", () => {
  test("offers the undeclared role a flex player can still be picked on", () => {
    // The server counts a flex player as supply for every role, so with a tight
    // pool the only safe option can be a role they never declared. Rendering
    // just the declared ones left every offered role blocked and the player
    // unpickable — with nothing drafted yet.
    const html = renderToStaticMarkup(
      <PlayerInspector
        player={player({ primary_role: "dps", secondary_roles_json: ["tank"], is_flex: true })}
        role="dps"
        options={{
          pick_id: 1,
          pick_version: 0,
          draft_team_id: 2,
          options: [
            { player_id: 7, role: "dps", is_safe: false, reason_code: "role_shortage", unmatched_slots: [], blocking_player_ids: [], suggestion_score: null },
            { player_id: 7, role: "tank", is_safe: false, reason_code: "role_shortage", unmatched_slots: [], blocking_player_ids: [], suggestion_score: null },
            { player_id: 7, role: "support", is_safe: true, reason_code: null, unmatched_slots: [], blocking_player_ids: [], suggestion_score: 1 }
          ]
        }}
        safetyRequired
        onRoleChange={() => {}}
        onClose={() => {}}
        divisionGrid={{ tiers: [] }}
      />
    );

    // All three roles are buttons, and exactly the two blocked ones are
    // aria-disabled — the safe support option is reachable.
    expect((html.match(/sr-only">roles\./g) ?? []).length).toBe(3);
    expect((html.match(/aria-disabled="true"/g) ?? []).length).toBe(2);
  });
});


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

describe("player inspector role ranks", () => {
  // Ranked on support only, but flex — so tank is offered without a rating.
  const flexPlayer = player({
    primary_role: "support",
    secondary_roles_json: ["tank"],
    is_flex: true,
    rank_value: 2814,
    effective_rank: 2814,
    role_ranks: { support: 2814 }
  });

  test("a role the player has no rank on shows no rank, not the primary's", () => {
    const html = render(flexPlayer, GRID);

    // Support carries its own rank; tank carries the em-dash, because lending it
    // `rank_value` would invent a rating the captain then picks on.
    expect(html).toContain("2814 SR");
    expect(html).toContain("roles.tank");
    expect(html).not.toContain("roles.tank · 2814 SR");
    expect(html).toContain("—");
  });

  test("the header shows the rank the server resolved for this draft, not the maximum", () => {
    // A support main: 2814 on support, 3900 on dps. `rank_value` carries 3900
    // because an all-roles registration form stores the maximum there, so the
    // header has to render `effective_rank` — the server's rank for the player's
    // own role (services.draft.board) — or it advertises a 3900 support.
    const html = render(
      player({
        primary_role: "support",
        secondary_roles_json: ["dps"],
        rank_value: 3900,
        effective_rank: 2814,
        role_ranks: { support: 2814, dps: 3900 }
      }),
      GRID
    );

    // The header icon precedes the role list, so its division is the resolved
    // rank's (Low, 2814) and not the maximum's (High, 3900).
    const headerIcon = html.indexOf('title="Low"');
    expect(headerIcon).toBeGreaterThan(-1);
    expect(headerIcon).toBeLessThan(html.indexOf("chooseRole"));
    expect(html).not.toContain('title="High"');
    // The rows stay per-role: both ranks are still readable.
    expect(html).toContain("2814 SR");
    expect(html).toContain("3900 SR");
  });
});
