import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { RosterShape } from "@/lib/roster-shape";
import type { AdminRegistration } from "@/types/balancer-admin.types";
import type { DraftSession } from "@/types/draft.types";

import { DraftCaptainsStep } from "./DraftCaptainsStep";
import { DraftConfigStep } from "./DraftConfigStep";
import { DraftHistoryPanel } from "./DraftHistoryPanel";
import type { DraftSetupConfig } from "./setup-types";

const SESSIONS = vi.hoisted(
  () =>
    [
      { id: 12, status: "live", format: "snake", rounds: 4, created_at: "2026-02-01T10:00:00Z" },
      {
        id: 11,
        status: "cancelled",
        format: "linear",
        rounds: 4,
        created_at: "2026-01-30T10:00:00Z"
      }
    ] as unknown as DraftSession[]
);

// Translations resolve to `key:{values}` so an assertion names the message key
// instead of a copy string, and the formatter is pinned so the row is stable.
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useFormatter: () => ({ dateTime: () => "1 Feb 2026, 10:00" }),
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: SESSIONS, isLoading: false, isError: false, refetch: () => {} }),
  useMutation: () => ({ mutate: () => {}, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: async () => {} })
}));

const SHAPE: RosterShape = {
  slots: { flex: 5 },
  team_size: 5,
  flex_slots: 5,
  has_role_slots: false,
  draft_rounds: 4,
  source: "tournament"
};

const CONFIG: DraftSetupConfig = {
  teamCount: 2,
  pickTimeSeconds: 45,
  format: "snake",
  autopickStrategy: "best_fit",
  allowAdminOverride: true,
  roundRules: ["linear", "linear", "linear", "linear"]
};

function registration(id: number, roles: string[], rank: number | null): AdminRegistration {
  return {
    id,
    battle_tag: `Player${id}#1000`,
    display_name: null,
    user_id: id,
    deleted_at: null,
    balancer_status_meta: { excludes_from_balancer: false },
    roles: roles.map((role, index) => ({
      role,
      is_active: true,
      is_primary: index === 0,
      priority: index,
      rank_value: rank
    }))
  } as unknown as AdminRegistration;
}

const POOL = [
  registration(1, ["tank", "dps", "support"], null),
  registration(2, ["support", "tank"], 2600),
  registration(3, ["dps"], 3800)
];

describe("draft config step", () => {
  const html = renderToStaticMarkup(
    <DraftConfigStep value={CONFIG} onChange={() => {}} rosterShape={SHAPE} tournamentId={5} />
  );

  test("renders the pick-time presets as one segmented control, not four loose buttons", () => {
    // Only the pick-time group is a `role=group` here (round rules are custom-only,
    // the format picker is a radiogroup), so one match means one widget.
    expect(html.match(/<div[^>]*role="group"[^>]*aria-labelledby[^>]*>/g) ?? []).toHaveLength(1);
    for (const seconds of [30, 45, 60, 90]) {
      expect(html).toContain(`>${seconds}s</button>`);
    }
    // The selected preset is the only pressed option, and the free-form field is
    // labelled as the custom override rather than looking like a fifth preset.
    expect(html.match(/aria-pressed="true"/g) ?? []).toHaveLength(1);
    expect(html).toContain('for="draft-pick-time"');
    expect(html).toContain("customPickTime");
  });

  test("shows the roster slots as icons instead of role words", () => {
    // A flex-only shape renders the flex glyph plus its screen-reader label; the
    // visible text is the count, never "5 Flex".
    expect(html).toContain("<svg");
    expect(html).toContain("roles.flex");
    expect(html).not.toContain("5 roles.flex");
  });
});

describe("draft captains step", () => {
  const html = renderToStaticMarkup(
    <DraftCaptainsStep
      pool={POOL}
      teamCount={2}
      value={{ ids: [], teamNames: {}, order: "weakest_first", randomSeed: 1 }}
      onChange={() => {}}
    />
  );

  test("filters roles through icon toggles instead of a single-value dropdown", () => {
    expect(html.match(/<button[^>]*aria-pressed="false"[^>]*>/g) ?? []).toHaveLength(3);
    expect(html).toContain('aria-label="roleFilter"');
    // The removed dropdown's "all roles" option must be gone: an empty selection
    // now means every role.
    expect(html).not.toContain("allRoles");
  });

  test("offers a rank sort", () => {
    // Radix renders its options in a portal, so SSR only exposes the trigger.
    expect(html).toContain('aria-label="captainSort"');
  });

  test("renders each candidate's roles as glyphs and the rank as a division icon", () => {
    // Roles used to be text badges; they are icons now, announced by role name.
    expect(html).toContain('aria-label="roles.tank"');
    expect(html).toContain('aria-label="roles.dps"');
    expect(html).toContain('aria-label="roles.support"');
    // Ranked candidates carry a division image; the unranked one still shows a dash.
    expect(html).toContain("<img");
    expect(html).toContain("3800");
    expect(html).toContain("—");
  });

  test("sorts the pool by rank descending by default", () => {
    expect(html.indexOf("Player3#1000")).toBeLessThan(html.indexOf("Player2#1000"));
    expect(html.indexOf("Player2#1000")).toBeLessThan(html.indexOf("Player1#1000"));
  });
});

describe("draft history panel", () => {
  // react-dom/server escapes quotes in text nodes, so the mocked translation's
  // JSON payload lands as &quot; in the markup.
  const session = (id: number) => `sessionNumber:{&quot;id&quot;:${id}}`;

  const html = renderToStaticMarkup(
    <DraftHistoryPanel tournamentId={5} onSessionDeleted={() => {}} />
  );

  test("lists every session with its status", () => {
    expect(html).toContain("history.title");
    expect(html).toContain(session(12));
    expect(html).toContain(session(11));
    expect(html).toContain("statuses.live");
    expect(html).toContain("statuses.cancelled");
  });

  test("blocks deleting an in-flight draft and allows it for a terminal one", () => {
    const live = html.slice(html.indexOf(session(12)), html.indexOf(session(11)));
    const cancelled = html.slice(html.indexOf(session(11)));

    expect(live).toContain("history.cancelFirst");
    expect(live).toContain('disabled=""');
    expect(cancelled).toContain("history.delete");
    expect(cancelled).not.toContain("history.cancelFirst");
    expect(cancelled).not.toContain('disabled=""');
  });
});
