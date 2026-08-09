// @vitest-environment happy-dom
//
// The public page is slot-unaware until stage two, and a slot config carries an
// EMPTY `map_ids` (the serializer sends both pool shapes; only one is filled).
// Rendered as a flat pool that produced two false statements about a round the
// organizer had fully configured: the badge "0 maps in the pool" and the pool
// card's "No maps in this game mode.".
//
// The guard therefore has to key off `config.mode`, never off an empty pool: an
// empty FLAT pool is a genuine misconfiguration and must keep saying so. These
// tests pin both sides of that distinction, because collapsing them would swap a
// true error message for a false reassurance.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type { MapRead } from "@/types/map.types";
import type { MapVetoConfig, MapVetoConfigSlot } from "@/types/tournament.types";

import TournamentMapsPage from "./TournamentMapsPage";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getVetoConfigs = vi.fn();
const getStages = vi.fn();
const getAllMaps = vi.fn();

vi.mock("@/services/tournament.service", () => ({
  default: {
    getVetoConfigs: (...args: unknown[]) => getVetoConfigs(...args),
    getStages: (...args: unknown[]) => getStages(...args)
  }
}));
vi.mock("@/services/map.service", () => ({
  default: { getAll: (...args: unknown[]) => getAllMaps(...args) }
}));

const COPY = en.mapVeto;
const TOURNAMENT_ID = 88;

/**
 * Four maps whose ids are deliberately not 1..4 and never equal a slot position,
 * a candidate count or the tournament id, so nothing can pass by confusing one
 * for another. Two gamemodes, of unequal size, so grouping is exercised.
 */
const MAPS: MapRead[] = [
  { id: 37, name: "Busan", gamemode: { id: 4, name: "Control" } },
  { id: 45, name: "Ilios", gamemode: { id: 4, name: "Control" } },
  { id: 52, name: "King's Row", gamemode: { id: 6, name: "Hybrid" } },
  { id: 63, name: "Numbani", gamemode: { id: 6, name: "Hybrid" } }
].map((map) => ({
  ...map,
  created_at: new Date("2026-01-01T00:00:00Z"),
  updated_at: null,
  image_path: `/maps/${map.id}.jpg`,
  gamemode_id: map.gamemode.id,
  in_competitive: true,
  aliases: []
})) as MapRead[];

/**
 * Every field spelled out rather than spread from a caller: `tsconfig.json`
 * excludes test files, so a builder that drops a required field type-checks
 * green and silently feeds the component a hole.
 */
function config(overrides: Partial<MapVetoConfig>): MapVetoConfig {
  return {
    id: 118,
    tournament_id: TOURNAMENT_ID,
    stage_id: null,
    round: null,
    mode: "pool",
    preset: "bracket",
    first_pick_rule: "higher_seed",
    first_ban_rotation: "fixed",
    turn_timer_seconds: null,
    sequence: [],
    map_ids: [],
    slots: [],
    ...overrides
  };
}

/**
 * Two slots at positions 4 and 9 — gapped, so neither is a 0- or 1-based index,
 * and neither equals the slot count (2) or either candidate count (3 and 2).
 */
const SLOTS: MapVetoConfigSlot[] = [
  { position: 4, candidates: [37, 45, 52], reserve_map_id: null },
  { position: 9, candidates: [63, 52], reserve_map_id: 63 }
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  getAllMaps.mockResolvedValue({ results: MAPS });
  // No stages: the scope picker is then skipped entirely and the tournament
  // default is the resolved config, which is all these cases need.
  getStages.mockResolvedValue([]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Let queued promise callbacks and React Query's own scheduling drain. */
async function settle(ticks = 3) {
  for (let index = 0; index < ticks; index += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

async function render(configs: MapVetoConfig[]) {
  getVetoConfigs.mockResolvedValue({ configs });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={en}>
          <TournamentMapsPage tournamentId={TOURNAMENT_ID} />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });
  await settle();
  return container.textContent ?? "";
}

/** Map names actually on screen, read off the pool grid rather than the DOM at large. */
function tileNames() {
  return Array.from(container.querySelectorAll("li > span")).map((span) =>
    span.textContent?.trim()
  );
}

describe("slot-mode config", () => {
  it("says the pool is not shown instead of rendering an empty flat pool", async () => {
    const text = await render([config({ id: 219, mode: "slots", slots: SLOTS })]);

    expect(text).toContain(COPY.slotPoolNotShownTitle);
    expect(text).toContain(COPY.slotPoolNotShownDescription);
    // The two false statements this guard exists to stop telling.
    expect(text).not.toContain("0 maps in the pool");
    expect(text).not.toContain(COPY.poolEmpty);
    expect(text).not.toContain(COPY.poolTitle);
    expect(tileNames()).toEqual([]);
  });

  it("keeps the truthful cascade context it does not replace", async () => {
    const text = await render([config({ id: 219, mode: "slots", slots: SLOTS })]);

    // The config IS configured, so "not configured" would be its own lie, and
    // where it was inherited from is true regardless of pool shape.
    expect(text).not.toContain(COPY.notConfiguredTitle);
    expect(text).toContain(COPY.source.tournament);
  });
});

describe("flat-mode config", () => {
  it("still reports a genuinely empty flat pool as empty, not as a slot pool", async () => {
    const text = await render([config({ id: 320, mode: "pool", map_ids: [] })]);

    expect(text).toContain(COPY.poolEmpty);
    expect(text).toContain("0 maps in the pool");
    expect(text).not.toContain(COPY.slotPoolNotShownTitle);
    expect(text).not.toContain(COPY.slotPoolNotShownDescription);
  });

  it("renders a populated flat pool unchanged", async () => {
    // Three maps across two gamemodes, so the count differs from both group
    // sizes and from the number of groups.
    const text = await render([config({ id: 320, mode: "pool", map_ids: [52, 37, 45] })]);

    expect(tileNames()).toEqual(["Busan", "Ilios", "King's Row"]);
    expect(text).toContain("3 maps in the pool");
    expect(text).toContain(COPY.poolTitle);
    expect(text).not.toContain(COPY.poolEmpty);
    expect(text).not.toContain(COPY.slotPoolNotShownTitle);
  });
});
