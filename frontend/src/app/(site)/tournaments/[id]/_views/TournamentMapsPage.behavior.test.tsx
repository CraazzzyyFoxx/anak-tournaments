// @vitest-environment happy-dom
//
// Two shapes of lie are pinned here, because both have shipped on this page.
//
//  1. A slot config carries an EMPTY `map_ids` — the serializer sends both pool
//     shapes and fills exactly one. Rendered as a flat pool that produced two
//     false statements about a fully configured round: the badge "0 maps in the
//     pool" and the pool card's "No maps in this game mode.". So the branch keys
//     off `config.mode`, never off an empty pool: an empty FLAT pool is a genuine
//     misconfiguration and must keep saying so. Collapsing the two would swap a
//     true error message for a false reassurance.
//
//  2. `mapsById` is built from the competitive-only catalogue, so a candidate
//     retired from rotation does not resolve. Dropping its tile would report a
//     slot as holding fewer candidates than the organizer configured, and a
//     slot's candidate count is regulation-critical — the backend refuses fewer
//     than two. The page names the unresolved map instead of shrinking the slot.
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
 * Six maps whose ids are deliberately not 1..6 and never equal a slot position,
 * a candidate count or the tournament id, so nothing can pass by confusing one
 * for another. Two gamemodes, of unequal size, so grouping is exercised.
 */
const MAPS: MapRead[] = [
  { id: 37, name: "Busan", gamemode: { id: 4, name: "Control" } },
  { id: 45, name: "Ilios", gamemode: { id: 4, name: "Control" } },
  { id: 52, name: "King's Row", gamemode: { id: 6, name: "Hybrid" } },
  { id: 63, name: "Numbani", gamemode: { id: 6, name: "Hybrid" } },
  { id: 71, name: "Oasis", gamemode: { id: 4, name: "Control" } },
  { id: 84, name: "Eichenwalde", gamemode: { id: 6, name: "Hybrid" } }
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
 * A map id the page's catalogue does not carry. `mapsById` is built from maps
 * filtered to `in_competitive !== false`, so a candidate retired from rotation
 * reaches the component exactly like this: an id with nothing behind it.
 */
const RETIRED_MAP_ID = 96;

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
 * Three slots at gapped positions 4, 9 and 15 — none is a 0- or 1-based index,
 * and none equals the slot count (3), any candidate count (2, 4, 5) or the
 * catalogue size (6), so no assertion can pass by confusing two of them.
 *
 * Listed out of position order on purpose: the serializer sorts by `position`
 * today, so a fixture in wire order could not tell a page that sorts from one
 * that trusts the array. Maps 37, 45, 52 and 63 each appear in more than one
 * slot, which is legal and must render every time. Slot 4 names no reserve,
 * slot 9 names one the catalogue resolves, slot 15 names one it does not, and
 * slot 9 also holds a candidate the catalogue cannot resolve.
 */
const SLOTS: MapVetoConfigSlot[] = [
  { position: 15, candidates: [71, 37, 52, 63, 45], reserve_map_id: RETIRED_MAP_ID },
  { position: 4, candidates: [37, 52], reserve_map_id: null },
  { position: 9, candidates: [63, 45, 84, RETIRED_MAP_ID], reserve_map_id: 52 }
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

/**
 * The pool card's sections in DOM order — one per slot in slot mode, one per
 * gamemode in flat mode — each with the heading that identifies it and only its
 * own tiles. Read per section rather than off the whole grid, so tiles landing
 * under the wrong slot cannot pass.
 */
function sections() {
  return Array.from(container.querySelectorAll("section")).map((section) => ({
    heading: section.querySelector("h3")?.textContent?.trim(),
    tiles: Array.from(section.querySelectorAll("li > span")).map((span) =>
      span.textContent?.trim()
    ),
    text: section.textContent ?? ""
  }));
}

describe("slot-mode config", () => {
  const slotConfig = () => config({ id: 219, mode: "slots", slots: SLOTS });

  it("renders every slot in position order, whatever order the wire listed them in", async () => {
    await render([slotConfig()]);

    expect(sections().map((section) => section.heading)).toEqual(["Slot 4", "Slot 9", "Slot 15"]);
  });

  it("gives each slot its own candidates, in configured order, repeats included", async () => {
    await render([slotConfig()]);

    expect(sections().map((section) => section.tiles)).toEqual([
      ["Busan", "King's Row"],
      ["Numbani", "Ilios", "Eichenwalde", "Map #96"],
      ["Oasis", "Busan", "King's Row", "Numbani", "Ilios"]
    ]);
  });

  it("names a candidate the competitive catalogue cannot resolve instead of dropping it", async () => {
    await render([slotConfig()]);

    const slot9 = sections()[1];
    // Four tiles for four configured candidates: reporting three would
    // under-state a count the regulation is written against.
    expect(slot9?.tiles).toHaveLength(4);
    expect(slot9?.tiles).toContain("Map #96");
    expect(slot9?.text).toContain("4 candidates");
  });

  it("marks the reserve map of the slots that name one, and only those", async () => {
    await render([slotConfig()]);

    const [slot4, slot9, slot15] = sections();
    expect(slot4?.text).not.toContain("Regulation reserve on a draw");
    expect(slot9?.text).toContain("Regulation reserve on a draw: King's Row");
    // An unresolved reserve is named the same way an unresolved candidate is,
    // rather than leaving the slot looking as if it named no reserve at all.
    expect(slot15?.text).toContain("Regulation reserve on a draw: Map #96");
  });

  it("replaces the pool-size badge with the size of the slot config", async () => {
    const text = await render([slotConfig()]);

    // 3 slots holding 2 + 4 + 5 candidates, counted off the config and never off
    // the catalogue, so the unresolved candidate is still counted.
    expect(text).toContain("3 slots, 11 candidates");
    expect(text).not.toContain("0 maps in the pool");
    expect(text).not.toContain(COPY.poolEmpty);
  });

  it("states the order captains resolve the slots in, without listing steps", async () => {
    const text = await render([slotConfig()]);

    expect(text).toContain(COPY.slotPoolDescription);
    // The flat pool's own description describes a pool that does not exist here.
    expect(text).not.toContain(COPY.poolDescription);
    // A generated step list would be a second copy of the server's
    // `build_slot_sequence`; the prose above is the whole answer.
    expect(text).not.toContain(COPY.sequenceTitle);
  });

  it("keeps the truthful cascade context it does not replace", async () => {
    const text = await render([slotConfig()]);

    // The config IS configured, so "not configured" would be its own lie, and
    // where it was inherited from is true regardless of pool shape.
    expect(text).not.toContain(COPY.notConfiguredTitle);
    expect(text).toContain(COPY.source.tournament);
  });

  it("says a slot that cannot be banned down to one map cannot open the veto", async () => {
    // Reachable with no invalid save: `map_id` cascades from `overwatch.map`, so
    // deleting a map drops a stored slot under the floor the upsert checks.
    await render([
      config({
        id: 219,
        mode: "slots",
        slots: [
          { position: 2, candidates: [37], reserve_map_id: null },
          { position: 7, candidates: [], reserve_map_id: null },
          { position: 11, candidates: [45, 63, 84], reserve_map_id: null }
        ]
      })
    ]);

    const [slot2, slot7, slot11] = sections();
    expect(slot2?.text).toContain(COPY.slotUnderfilled.replace("{n}", "2"));
    expect(slot2?.tiles).toEqual(["Busan"]);
    expect(slot7?.text).toContain(COPY.slotUnderfilled.replace("{n}", "7"));
    expect(slot7?.tiles).toEqual([]);
    expect(slot11?.text).not.toContain("the veto cannot open");
  });
});

describe("flat-mode config", () => {
  it("still reports a genuinely empty flat pool as empty, not as a slot pool", async () => {
    const text = await render([config({ id: 320, mode: "pool", map_ids: [] })]);

    expect(text).toContain(COPY.poolEmpty);
    expect(text).toContain("0 maps in the pool");
    expect(text).not.toContain(COPY.slotPoolDescription);
    expect(sections()).toEqual([]);
  });

  it("renders a populated flat pool unchanged", async () => {
    // Three maps across two gamemodes, so the count differs from both group
    // sizes and from the number of groups.
    const text = await render([config({ id: 320, mode: "pool", map_ids: [52, 37, 45] })]);

    expect(tileNames()).toEqual(["Busan", "Ilios", "King's Row"]);
    expect(text).toContain("3 maps in the pool");
    expect(text).toContain(COPY.poolTitle);
    expect(text).toContain(COPY.poolDescription);
    expect(text).not.toContain(COPY.poolEmpty);
    expect(text).not.toContain(COPY.slotPoolDescription);
    // Gamemode groups, not slots: nothing here is numbered as a slot.
    expect(sections().map((section) => section.heading)).toEqual(["Control (2)", "Hybrid (1)"]);
  });
});
