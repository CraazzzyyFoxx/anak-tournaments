// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MatchStats from "./MatchStats";
import SeriesStats from "./SeriesStats";
import KillFeedTimeline from "./KillFeedTimeline";
import type { DisciplineMetadata } from "@/types/discipline.types";
import type { Encounter, MatchWithStats } from "@/types/encounter.types";
import type { MatchEvent, MatchEvents } from "@/types/killfeed.types";
import messages from "@/i18n/messages/en.json";
import { LogStatsName } from "../stat-names";
import type { OwTeam } from "./view";

const { getMatchKillFeed } = vi.hoisted(() => ({ getMatchKillFeed: vi.fn() }));

vi.mock("@/services/encounter.service", () => ({ default: { getMatchKillFeed } }));
vi.mock("@/lib/datetime/client", () => ({
  useFormatter: () => ({ number: (value: number) => String(value) })
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
const metadata = {} as DisciplineMetadata;

/** A duel of two participations whose source teams are gone (`tournament_team_id: null`); one observed member each. */
function match(
  sides: { id: number; name: string; eliminations: number }[],
  overrides: Partial<MatchWithStats> = {}
): MatchWithStats {
  return {
    id: 7,
    created_at: "1970-01-01T00:00:00Z",
    updated_at: null,
    played_at: null,
    workspace_id: 1,
    discipline: "overwatch",
    encounter_id: 1,
    encounter_game_id: null,
    map_id: 1,
    map_index: null,
    map: null,
    encounter: null,
    duration_s: null,
    log_name: null,
    raw_status: "missing",
    raw_available: false,
    participants: sides.map((side, index) => ({
      encounter_team_id: side.id,
      slot: index + 1,
      source_position: index,
      tournament_team_id: null,
      name: side.name,
      result: null,
      team_facts: { score: 2 - index }
    })),
    statistics: {
      members: sides.map((side) => ({
        encounter_team_id: side.id,
        workspace_member_id: side.id * 10,
        player_id: side.id * 10,
        // Side 102's player has no canonical name on the wire: its handle must stay unlinked.
        player_name: side.id === 102 ? null : `Canonical ${side.id}`,
        handle_snapshot: `Observed ${side.id}#1`,
        observed_role: null
      })),
      segments: [],
      facts: sides.map((side) => ({
        encounter_team_id: side.id,
        workspace_member_id: side.id * 10,
        entity_id: null,
        segment: 0,
        stat_code: LogStatsName.Eliminations,
        value: side.eliminations
      })),
      entities: []
    },
    ...overrides
  };
}

const historical = (): MatchWithStats =>
  match([
    { id: 101, name: "Archived A", eliminations: 12 },
    { id: 102, name: "Archived B", eliminations: 5 }
  ]);

function seats(...ids: number[]): Encounter {
  return { teams: ids.map((id) => ({ id })) } as unknown as Encounter;
}

function event(overrides: Partial<MatchEvent> = {}): MatchEvent {
  return {
    id: 1,
    segment: 1,
    t: 17,
    type: "kill",
    actor_member_id: null,
    actor_team_id: null,
    target_member_id: null,
    target_team_id: null,
    entity_id: null,
    related_entity_id: null,
    data: null,
    ...overrides
  };
}

const side = (id: number, name: string): OwTeam => ({
  id,
  slot: id,
  team_id: null,
  name,
  team: null,
  live: null,
  players: []
});

async function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(node);
  });
  return container;
}

async function timeline(events: MatchEvent[], home = side(1, "Home"), away = side(2, "Away")) {
  const feed: MatchEvents = { match_id: 7, discipline: "overwatch", events, entities: [] };
  getMatchKillFeed.mockResolvedValue(feed);
  return mount(<KillFeedTimeline matchId={7} members={[]} home={home} away={away} />);
}

const timestamps = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll("span"))
    .map((element) => element.textContent ?? "")
    .filter((text) => /^\d+:\d{2}$/.test(text));

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// happy-dom lays nothing out, so recharts' ResponsiveContainer measures 0×0
// and warns that the chart is invisible. Give its box a browser-like size.
const measure = HTMLElement.prototype.getBoundingClientRect;
beforeEach(() => {
  getMatchKillFeed.mockReset();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("recharts-responsive-container")
      ? new DOMRect(0, 0, 600, 300)
      : measure.call(this);
  });
});

describe("historical observed participations", () => {
  it("keeps both participations' observations and snapshot names without a source team", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      <MatchStats match={historical()} metadata={metadata} />
    );
    const bodies = Array.from(container.querySelectorAll("tbody"));
    expect(bodies).toHaveLength(2);
    expect(bodies[0].textContent).toContain("Archived A");
    expect(bodies[1].textContent).toContain("Archived B");
    expect(Array.from(bodies[0].querySelectorAll("td")).map((cell) => cell.textContent)).toContain(
      "12"
    );
    expect(Array.from(bodies[1].querySelectorAll("td")).map((cell) => cell.textContent)).toContain(
      "5"
    );
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("compares observed totals when the source teams and hero metadata are unavailable", async () => {
    const container = await mount(<MatchStats match={historical()} metadata={metadata} />);
    const extended = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === messages.matches.view.extended
    )!;
    await act(async () => extended.click());
    const comparison = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    ).find((button) => button.textContent === messages.matches.tab.comparison)!;
    await act(async () => {
      comparison.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      comparison.click();
    });
    const panel = container.querySelector('[role="tabpanel"][data-state="active"]');
    expect(panel?.textContent).toContain("Archived A");
    expect(panel?.textContent).toContain("Archived B");
    expect(panel?.textContent).toContain("12");
    expect(panel?.textContent).toContain("5");
  });

  it("links observed handles through the canonical player name, never the handle, and leaves a nameless one unlinked", async () => {
    const container = await mount(<MatchStats match={historical()} metadata={metadata} />);
    const links = () =>
      Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href^="/users/"]')).map(
        (link) => [link.textContent, link.getAttribute("href")]
      );
    // The scoreboard: Archived B's member is shown, not linked.
    expect(links()).toEqual([["Observed 101", "/users/Canonical 101"]]);
    expect(container.textContent).toContain("Observed 102");

    const extended = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === messages.matches.view.extended
    )!;
    await act(async () => extended.click());
    const comparison = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    ).find((button) => button.textContent === messages.matches.tab.comparison)!;
    await act(async () => {
      comparison.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      comparison.click();
    });
    // The leader cards: the top eliminator (Archived A's) links the same way; B's leaders (if any) never link.
    const panel = container.querySelector('[role="tabpanel"][data-state="active"]')!;
    const leaderLinks = Array.from(panel.querySelectorAll<HTMLAnchorElement>('a[href^="/users/"]'));
    expect(leaderLinks.length).toBeGreaterThan(0);
    expect(new Set(leaderLinks.map((link) => link.getAttribute("href")))).toEqual(
      new Set(["/users/Canonical 101"])
    );
  });

  it("renders nothing for a match that is not a duel", () => {
    const lobby = match([
      { id: 1, name: "A", eliminations: 1 },
      { id: 2, name: "B", eliminations: 2 },
      { id: 3, name: "C", eliminations: 3 }
    ]);
    expect(renderToStaticMarkup(<MatchStats match={lobby} metadata={metadata} />)).toBe("");
  });
});

describe("encounter participation statistics", () => {
  it.each(["overview", "players"] as const)(
    "keeps retired-only observations visible in %s",
    async (view) => {
      const container = await mount(
        <SeriesStats
          matches={[{ ...historical(), encounter: seats(201, 202) }]}
          metadata={metadata}
          view={view}
        />
      );
      expect(container.textContent).toContain("Archived A");
      expect(container.textContent).toContain("Archived B");
      expect(container.textContent).toContain("12");
      expect(container.textContent).toContain("5");
    }
  );

  it("keeps mixed participations separate without pairing replacement seats", async () => {
    const encounter = seats(201, 202);
    const current = match(
      [
        { id: 201, name: "Current A", eliminations: 4 },
        { id: 202, name: "Current B", eliminations: 3 }
      ],
      { id: 8, map_index: 1, encounter }
    );
    const container = await mount(
      <SeriesStats
        matches={[{ ...historical(), encounter }, current]}
        metadata={metadata}
        view="players"
      />
    );
    const bodies = Array.from(container.querySelectorAll("tbody"));
    expect(bodies).toHaveLength(4);
    expect(bodies.map((body) => body.querySelector("tr")?.textContent)).toEqual([
      "Archived A · Participation #101 · Historical participation",
      "Archived B · Participation #102 · Historical participation",
      "Current A · Participation #201",
      "Current B · Participation #202"
    ]);
    expect(Array.from(bodies[0].querySelectorAll("td")).map((cell) => cell.textContent)).toContain(
      "12"
    );
    expect(Array.from(bodies[2].querySelectorAll("td")).map((cell) => cell.textContent)).toContain(
      "4"
    );
  }, 20_000);
});

describe("native nullable timeline", () => {
  it("preserves duplicate observations and chronological order with missing actors, entities and JSON", async () => {
    const container = await timeline([
      event({ t: 22 }),
      event(),
      event(),
      event({ t: 11, type: "ultimate_start" }),
      event({ type: "ultimate_start" }),
      event({ type: "ultimate_start" })
    ]);
    expect(timestamps(container)).toEqual(["0:11", "0:17", "0:17", "0:17", "0:17", "0:22"]);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelector('[aria-label="critical"]')).toBeNull();
    expect(container.querySelector('[aria-label="environmental"]')).toBeNull();
  });

  it("renders event-only history rather than treating it as an empty kill feed", async () => {
    const container = await timeline([
      event({ type: "ultimate_start" }),
      event({ type: "ultimate_start" })
    ]);
    expect(timestamps(container)).toEqual(["0:17", "0:17"]);
  });

  it("does not assign an unknown actor to the away team or invent a fight", async () => {
    const container = await timeline([event()]);
    const clock = Array.from(container.querySelectorAll("span")).find(
      (span) => span.textContent === "0:17"
    )!;
    const row = clock.parentElement!;
    expect(row.style.borderLeft).toContain("var(--aqt-fg-muted)");
    expect(row.parentElement!.previousElementSibling!.textContent).toBe("—");
    expect(timestamps(container)).toEqual(["0:17"]);
  });

  it("keeps known participation ownership and explicit flags", async () => {
    const container = await timeline([
      event({ actor_team_id: 2, data: { fight: 0, is_critical_hit: true, is_environmental: true } })
    ]);
    const clock = Array.from(container.querySelectorAll("span")).find(
      (span) => span.textContent === "0:17"
    )!;
    expect(clock.parentElement!.style.borderLeft).toContain("var(--aqt-rose)");
    expect(container.querySelector('[aria-label="critical"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="environmental"]')).not.toBeNull();
  });
});
