// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MatchStatsSection from "./MatchStatsSection";
import MatchKillFeedTimeline from "./MatchKillFeedTimeline";
import { generateMetadata } from "../page";
import type { MatchWithStats } from "@/types/encounter.types";
import type { KillFeedEntry, MatchKillFeed, MatchTimelineEvent } from "@/types/killfeed.types";
import type { TeamWithStats } from "@/types/team.types";
import messages from "@/i18n/messages/en.json";

const { getMatch, getMatchKillFeed } = vi.hoisted(() => ({
  getMatch: vi.fn(),
  getMatchKillFeed: vi.fn()
}));

vi.mock("@/services/encounter.service", () => ({ default: { getMatch, getMatchKillFeed } }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (_key: string, values: Record<string, unknown>) =>
    `${values.home} vs ${values.away}`
}));
vi.mock("@/lib/datetime/client", () => ({
  useFormatter: () => ({ number: (value: number) => String(value) })
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;

function team(id: number, name: string): TeamWithStats {
  return {
    id, name, created_at: new Date(0), updated_at: null, image_url: null,
    avg_sr: 0, total_sr: 0, captain_id: 1, tournament_id: 1,
    players: [], tournament: null, placement: null, group: null
  };
}

function match(home: TeamWithStats | null, away: TeamWithStats | null): MatchWithStats {
  return {
    id: 7, created_at: new Date(0), updated_at: null,
    home_team_id: home?.id ?? null, away_team_id: away?.id ?? null,
    home_team: home, away_team: away, score: { home: 2, away: 1 },
    time: null, encounter_id: 1, map_id: 1, map_index: 1,
    log_name: null, map: null, encounter: null, rounds: 1
  };
}

function kill(overrides: Partial<KillFeedEntry> = {}): KillFeedEntry {
  return {
    time: 17, round: 1, fight: null, ability: null, damage: null,
    is_critical_hit: null, is_environmental: null,
    killer_user_id: null, killer_team_id: null, killer_hero: null,
    victim_user_id: null, victim_team_id: null, victim_hero: null,
    ...overrides
  };
}

function event(overrides: Partial<MatchTimelineEvent> = {}): MatchTimelineEvent {
  return {
    time: 17, round: 1, name: "ultimate_start", user_id: null,
    team_id: null, hero: null, related_user_id: null, related_team_id: null,
    ...overrides
  };
}

async function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(node);
  });
  return container;
}

async function timeline(feed: MatchKillFeed, home: TeamWithStats | null = null, away: TeamWithStats | null = null) {
  getMatchKillFeed.mockResolvedValue(feed);
  return mount(<MatchKillFeedTimeline matchId={7} home={home} away={away} />);
}

function timestamps(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("span"))
    .map((element) => element.textContent ?? "")
    .filter((text) => /^\d+:\d{2}$/.test(text));
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

beforeEach(() => {
  getMatch.mockReset();
  getMatchKillFeed.mockReset();
});

describe("historical match teams", () => {
  it.each([true, false])("keeps the surviving team table when home survives: %s", (homeSurvives) => {
    const surviving = team(2, "Survivors");
    const value = homeSurvives ? match(surviving, null) : match(null, surviving);
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<MatchStatsSection match={value} />);
    expect(container.querySelector("table")?.textContent).toContain("Survivors");
    expect(container.querySelectorAll("tbody")).toHaveLength(2);
    expect(Array.from(container.querySelectorAll("tbody")).some((body) => body.textContent === "—")).toBe(true);
  });

  it("renders unavailable team slots without creating player rows", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<MatchStatsSection match={match(null, null)} />);
    expect(Array.from(container.querySelectorAll("tbody")).map((body) => body.textContent)).toEqual(["—", "—"]);
    expect(container.querySelectorAll('a[href^="/users/"]')).toHaveLength(0);
  });

  it("shows unavailable comparison instead of zero statistics for a deleted team", async () => {
    const container = await mount(<MatchStatsSection match={match(null, team(2, "Survivors"))} />);
    const extended = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === messages.matches.view.extended
    )!;
    await act(async () => extended.click());
    const comparison = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
      (button) => button.textContent === messages.matches.tab.comparison
    )!;
    await act(async () => {
      comparison.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      comparison.click();
    });
    const panel = container.querySelector('[role="tabpanel"][data-state="active"]');
    expect(panel?.textContent).toBe("—");
    expect(panel?.querySelector("svg")).toBeNull();
  });

  it("builds metadata without dereferencing a deleted team", async () => {
    getMatch.mockResolvedValue(match(null, team(2, "Survivors")));
    const metadata = await generateMetadata({ params: Promise.resolve({ id: 7 }) });
    expect(metadata.title).toContain("— vs Survivors");
    expect(metadata.description).toBe("— vs Survivors");
  });
});

describe("native nullable timeline", () => {
  it("preserves duplicate observations and chronological order with missing actors, entities and JSON", async () => {
    const container = await timeline({
      match_id: 7,
      kills: [kill({ time: 22 }), kill(), kill()],
      events: [event({ time: 11 }), event(), event()]
    });
    expect(timestamps(container)).toEqual(["0:11", "0:17", "0:17", "0:17", "0:17", "0:22"]);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelector('[aria-label="critical"]')).toBeNull();
    expect(container.querySelector('[aria-label="environmental"]')).toBeNull();
  });

  it("renders event-only history rather than treating it as an empty kill feed", async () => {
    const container = await timeline({ match_id: 7, kills: [], events: [event(), event()] });
    expect(timestamps(container)).toEqual(["0:17", "0:17"]);
  });

  it("does not assign an unknown actor to the away team or invent a fight", async () => {
    const container = await timeline(
      { match_id: 7, kills: [kill()], events: [] },
      team(1, "Home"), team(2, "Away")
    );
    const clock = Array.from(container.querySelectorAll("span")).find((span) => span.textContent === "0:17")!;
    const row = clock.parentElement!;
    expect(row.style.borderLeft).toContain("var(--aqt-fg-muted)");
    const roundHeader = row.parentElement!.previousElementSibling!;
    expect(roundHeader.textContent).toBe("—");
    expect(timestamps(container)).toEqual(["0:17"]);
  });

  it("keeps known team ownership and explicit flags when the other team is absent", async () => {
    const container = await timeline({
      match_id: 7,
      kills: [kill({ killer_team_id: 2, fight: 0, is_critical_hit: true, is_environmental: true })],
      events: []
    }, null, team(2, "Away"));
    const clock = Array.from(container.querySelectorAll("span")).find((span) => span.textContent === "0:17")!;
    expect(clock.parentElement!.style.borderLeft).toContain("var(--aqt-rose)");
    expect(container.querySelector('[aria-label="critical"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="environmental"]')).not.toBeNull();
  });
});
