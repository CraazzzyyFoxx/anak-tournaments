// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import MatchStatsSection from "./MatchStatsSection";
import MatchKillFeedTimeline from "./MatchKillFeedTimeline";
import { generateMetadata } from "../page";
import EncounterSeriesStats from "@/app/(site)/encounters/[id]/components/EncounterSeriesStats";
import { encounterQueryKeys } from "@/lib/encounters/query-keys";
import type { MatchWithStats, MatchObservedPlayer, MatchParticipationWithStats } from "@/types/encounter.types";
import type { KillFeedEntry, MatchKillFeed, MatchTimelineEvent } from "@/types/killfeed.types";
import messages from "@/i18n/messages/en.json";
import { LogStatsName } from "@/types/stats.types";

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
let queryClient: QueryClient | null = null;

function team(id: number, name: string, players: MatchObservedPlayer[] = []): MatchParticipationWithStats {
  return {
    id: 100 + id, name, slot: id, team_id: id, seed: null, score: 0,
    placement: null, active: false, team: null, players
  };
}

function player(memberId: number, eliminations: number): MatchObservedPlayer {
  return {
    workspace_member_id: memberId, user_id: null, name: `Observed ${memberId}#1`,
    stats: { 0: { [LogStatsName.Eliminations]: eliminations } } as MatchObservedPlayer["stats"],
    heroes: {}
  };
}

function match(home: MatchParticipationWithStats, away: MatchParticipationWithStats): MatchWithStats {
  return {
    id: 7, created_at: new Date(0), updated_at: null,
    home_team_id: home.team_id, away_team_id: away.team_id,
    home_team: null, away_team: null, score: { home: 2, away: 1 },
    home_participation: home, away_participation: away,
    time: null, encounter_id: 1, map_id: 1, map_index: null,
    log_name: null, raw_status: "missing", raw_available: false,
    map: null, encounter: null, rounds: 1
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

async function timeline(feed: MatchKillFeed, home: MatchParticipationWithStats | null = null, away: MatchParticipationWithStats | null = null) {
  getMatchKillFeed.mockResolvedValue(feed);
  return mount(<MatchKillFeedTimeline matchId={7} home={home} away={away} />);
}

async function series(observations: MatchWithStats[], view: "overview" | "players") {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  for (const observation of observations) {
    queryClient.setQueryData(encounterQueryKeys.matchDetail(observation.id), observation);
  }
  return mount(
    <QueryClientProvider client={queryClient}>
      <EncounterSeriesStats matchIds={observations.map(({ id }) => id)} view={view} />
    </QueryClientProvider>
  );
}

function timestamps(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("span"))
    .map((element) => element.textContent ?? "")
    .filter((text) => /^\d+:\d{2}$/.test(text));
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  queryClient?.clear();
  queryClient = null;
  document.body.innerHTML = "";
});

beforeEach(() => {
  getMatch.mockReset();
  getMatchKillFeed.mockReset();
});

describe("historical observed participations", () => {
  it("keeps both deleted source teams' observations and snapshot names without inventing roster rows", () => {
    const home = { ...team(1, "Archived A", [player(41, 12)]), team_id: null };
    const away = { ...team(2, "Archived B", [player(42, 5)]), team_id: null };
    const value = match(home, away);
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<MatchStatsSection match={value} />);
    const bodies = Array.from(container.querySelectorAll("tbody"));
    expect(bodies).toHaveLength(2);
    expect(bodies[0].textContent).toContain("Archived A");
    expect(bodies[1].textContent).toContain("Archived B");
    expect(Array.from(bodies[0].querySelectorAll("td")).map((cell) => cell.textContent)).toContain("12");
    expect(Array.from(bodies[1].querySelectorAll("td")).map((cell) => cell.textContent)).toContain("5");
    expect(container.querySelectorAll('a[href^="/users/"]')).toHaveLength(0);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(value.home_team).toBeNull();
    expect(value.away_team).toBeNull();
  });

  it("compares observed totals when both source teams and hero metadata are unavailable", async () => {
    const home = { ...team(1, "Archived A", [player(41, 12)]), team_id: null };
    const away = { ...team(2, "Archived B", [player(42, 5)]), team_id: null };
    const container = await mount(<MatchStatsSection match={match(home, away)} />);
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
    expect(panel?.textContent).toContain("Archived A");
    expect(panel?.textContent).toContain("Archived B");
    expect(panel?.textContent).toContain("12");
    expect(panel?.textContent).toContain("5");
  });

  it("uses observed snapshot names in metadata after source teams have been deleted", async () => {
    getMatch.mockResolvedValue(match(
      { ...team(1, "Archived A"), team_id: null },
      { ...team(2, "Archived B"), team_id: null }
    ));
    const metadata = await generateMetadata({ params: Promise.resolve({ id: 7 }) });
    expect(metadata.title).toContain("Archived A vs Archived B");
    expect(metadata.description).toBe("Archived A vs Archived B");
  });
});

describe("encounter participation statistics", () => {
  it.each(["overview", "players"] as const)("keeps retired-only observations visible in %s", async (view) => {
    const historical = match(
      { ...team(1, "Archived A", [player(41, 12)]), team_id: null },
      { ...team(2, "Archived B", [player(42, 5)]), team_id: null }
    );
    const container = await series([historical], view);
    expect(container.textContent).toContain("Archived A");
    expect(container.textContent).toContain("Archived B");
    expect(container.textContent).toContain("12");
    expect(container.textContent).toContain("5");
    expect(container.querySelectorAll('a[href^="/users/"]')).toHaveLength(0);
  });

  it.each(["overview", "players"] as const)("keeps mixed participations separate in %s without pairing replacement seats", async (view) => {
    const historical = match(
      team(1, "Archived A", [player(41, 12)]),
      team(2, "Archived B", [player(42, 5)])
    );
    const current = {
      ...match(
        { ...team(1, "Current A", [player(41, 4)]), id: 201, active: true },
        { ...team(2, "Current B", [player(42, 3)]), id: 202, active: true }
      ),
      id: 8,
      map_index: 1
    };
    const container = await series([historical, current], view);
    const bodies = Array.from(container.querySelectorAll("tbody"));
    expect(bodies).toHaveLength(4);
    expect(bodies.map((body) => body.querySelector("tr")?.textContent)).toEqual([
      "Archived A · Participation #101 · Historical participation",
      "Archived B · Participation #102 · Historical participation",
      "Current A · Participation #201",
      "Current B · Participation #202"
    ]);
    expect(Array.from(bodies[0].querySelectorAll("td")).map((cell) => cell.textContent)).toContain("12");
    expect(Array.from(bodies[2].querySelectorAll("td")).map((cell) => cell.textContent)).toContain("4");
    expect(historical.home_participation.active).toBe(false);
    expect(current.home_participation.active).toBe(true);
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

  it("does not infer a participation from a source team shared by both sides", async () => {
    const container = await timeline(
      { match_id: 7, kills: [kill({ killer_team_id: 2 })], events: [] },
      { ...team(1, "Former side"), team_id: 2 },
      team(2, "Other participation")
    );
    const clock = Array.from(container.querySelectorAll("span")).find((span) => span.textContent === "0:17")!;
    const row = clock.parentElement!;
    expect(row.style.borderLeft).toContain("var(--aqt-fg-muted)");
    expect(row.parentElement!.previousElementSibling!.textContent).toBe("—");
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
