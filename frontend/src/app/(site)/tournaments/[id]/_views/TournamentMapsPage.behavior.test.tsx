// @vitest-environment happy-dom
//
// This page is the tournament's map pool, and nothing else.
//
// It used to be a per-level view of one veto config, chosen through a
// stage/round picker. That picker built its rounds from `Stage.max_rounds`, so
// it could not reach a lower-bracket round at all, and it offered rounds an
// elimination bracket never plays. Worse, the cascade it fed starts at the
// tournament default — so a tournament whose organizer wrote only per-round
// configs, which is the normal shape, opened on "the organizer has not published
// a map pool yet" and stayed there until the viewer guessed a configured round.
//
// The pool is now the union over every config, with no scope to choose, and the
// per-match ban/pick machinery lives with the match. What is pinned here:
//  1. the union, deduplicated, across levels a picker could never reach;
//  2. slot candidates and a slot's regulation reserve count as pool members;
//  3. an id the competitive catalogue cannot resolve is dropped, not named —
//     the opposite of the veto room, where a slot's candidate count is
//     regulation-critical and a missing tile would under-report it;
//  4. none of the veto presentation is left behind on this page.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type { MapRead } from "@/types/map.types";
import type { MapVetoConfig } from "@/types/tournament.types";

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
 * Every field spelled out rather than cast into place: `tsconfig.json` excludes
 * test files, so a fixture that lies about its shape type-checks green and feeds
 * the component a hole.
 */
function map(id: number, name: string, gamemode: string, gamemodeId: number): MapRead {
  return {
    id,
    created_at: new Date(0),
    updated_at: null,
    name,
    image_path: `/maps/${id}.jpg`,
    gamemode_id: gamemodeId,
    in_competitive: true,
    aliases: [],
    gamemode: {
      id: gamemodeId,
      created_at: new Date(0),
      updated_at: null,
      name: gamemode,
      image_path: `/gamemodes/${gamemodeId}.jpg`,
      slug: gamemode.toLowerCase(),
      description: "",
      aliases: []
    }
  };
}

/**
 * Six maps whose ids are deliberately not 1..6 and never equal a slot position,
 * a candidate count or the tournament id, so nothing can pass by confusing one
 * for another. Three gamemodes of unequal size, so grouping and its size
 * ordering are both exercised.
 *
 * Listed out of alphabetical order: the page sorts inside a group itself rather
 * than leaning on the maps endpoint keeping its `sort=name`, and a fixture in
 * sorted order could not tell the two apart.
 */
const MAPS: MapRead[] = [
  map(52, "Busan", "Control", 1),
  map(37, "Ilios", "Control", 1),
  map(71, "Oasis", "Control", 1),
  map(63, "Numbani", "Hybrid", 2),
  map(45, "King's Row", "Hybrid", 2),
  map(84, "Colosseo", "Push", 3)
];

/**
 * A map id the page's catalogue does not carry. `maps` is filtered to
 * `in_competitive !== false`, so a candidate retired from rotation reaches the
 * component exactly like this: an id with nothing behind it.
 */
const RETIRED_MAP_ID = 96;

/** Same reason as `map`: no field left to a default the wire does not have. */
function config(overrides: Partial<MapVetoConfig>): MapVetoConfig {
  return {
    id: 1,
    tournament_id: TOURNAMENT_ID,
    stage_id: null,
    round: null,
    mode: "pool",
    preset: "bracket",
    first_pick_rule: "higher_seed",
    first_ban_rotation: "fixed",
    turn_timer_seconds: 30,
    sequence: [],
    map_ids: [],
    slots: [],
    ...overrides
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  getAllMaps.mockResolvedValue({ results: MAPS });
  // Stages are no longer read at all: the pool spans every level, so there is
  // nothing on this page for a stage list to select. A stub that rejects would
  // fail the render if the page ever reached for one again.
  getStages.mockRejectedValue(new Error("the maps page must not read stages"));
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

/** Map names on screen, read off the tiles rather than the DOM at large. */
function tileNames() {
  return Array.from(container.querySelectorAll("li > span")).map((span) =>
    span.textContent?.trim()
  );
}

/** The gamemode sections in DOM order, each with only its own tiles. */
function sections() {
  return Array.from(container.querySelectorAll("section")).map((section) => ({
    heading: section.querySelector("h3")?.textContent?.trim(),
    tiles: Array.from(section.querySelectorAll("li > span")).map((span) =>
      span.textContent?.trim()
    )
  }));
}

function pills() {
  const group = container.querySelector<HTMLElement>(
    `[role="group"][aria-label="${COPY.filterLabel}"]`
  );
  return Array.from(group?.querySelectorAll("button") ?? []).map((button) => ({
    label: button.textContent?.trim(),
    pressed: button.getAttribute("aria-pressed") === "true",
    button
  }));
}

/**
 * The shape the reported tournament actually had: twelve per-round configs, no
 * tournament default and no stage default, spread over a Swiss stage and both
 * halves of a double-elimination bracket. Under the old picker the four
 * lower-bracket levels were unreachable and the page opened on "not configured".
 */
const PER_ROUND_ONLY = [
  config({ id: 401, stage_id: 188, round: 1, mode: "pool", map_ids: [52, 37] }),
  config({ id: 402, stage_id: 188, round: 5, mode: "pool", map_ids: [37, 71] }),
  config({ id: 403, stage_id: 189, round: 3, mode: "pool", map_ids: [45] }),
  // Lower bracket: reachable through no round the old selector offered.
  config({ id: 404, stage_id: 189, round: -1, mode: "pool", map_ids: [63, 45] }),
  config({ id: 405, stage_id: 189, round: -4, mode: "pool", map_ids: [84] })
];

describe("the pool spans every configured level", () => {
  it("unions the maps of every config, deduplicated", async () => {
    const text = await render(PER_ROUND_ONLY);

    // Six maps named across five configs with repeats; five distinct ones.
    expect(tileNames()).toEqual(["Busan", "Ilios", "Oasis", "King's Row", "Numbani", "Colosseo"]);
    expect(text).toContain("6 maps in the pool");
    expect(text).not.toContain(COPY.notConfiguredTitle);
  });

  it("includes a lower-bracket round's maps, which no round selector could reach", async () => {
    // Colosseo exists only on round -4 and Numbani only on round -1. Both were
    // invisible on this page for as long as rounds came from `max_rounds`.
    expect(await render(PER_ROUND_ONLY)).toContain("6 maps in the pool");
    expect(tileNames()).toContain("Colosseo");
    expect(tileNames()).toContain("Numbani");
  });

  it("counts a slot's candidates and its regulation reserve as pool members", async () => {
    await render([
      config({
        id: 410,
        stage_id: 189,
        round: 2,
        mode: "slots",
        // A slot config carries an empty `map_ids` by construction — the
        // serializer sends both shapes and fills exactly one — so reading the
        // flat pool alone reported this fully configured tournament as empty.
        slots: [
          { position: 4, candidates: [37, 52], reserve_map_id: null },
          // The reserve is a map the series lands on when a slot draws, so it
          // belongs to the pool as much as any candidate does.
          { position: 9, candidates: [63], reserve_map_id: 84 }
        ]
      })
    ]);

    expect(tileNames()).toEqual(["Busan", "Ilios", "Numbani", "Colosseo"]);
  });

  it("drops an id the competitive catalogue cannot resolve", async () => {
    const text = await render([
      config({
        id: 411,
        mode: "slots",
        slots: [
          { position: 4, candidates: [52, RETIRED_MAP_ID], reserve_map_id: RETIRED_MAP_ID }
        ]
      })
    ]);

    // A map retired from rotation is not something anyone will play, and this
    // page is a list of maps rather than a count the regulation is written
    // against — so it is left out instead of named as "Map #96".
    expect(tileNames()).toEqual(["Busan"]);
    expect(text).toContain("1 map in the pool");
    expect(text).not.toContain(String(RETIRED_MAP_ID));
  });
});

describe("grouping and filtering", () => {
  it("groups by gamemode, largest first, alphabetically inside a group", async () => {
    await render(PER_ROUND_ONLY);

    expect(sections()).toEqual([
      { heading: "Control (3)", tiles: ["Busan", "Ilios", "Oasis"] },
      { heading: "Hybrid (2)", tiles: ["King's Row", "Numbani"] },
      { heading: "Push (1)", tiles: ["Colosseo"] }
    ]);
  });

  it("filters to one gamemode and drops the now-redundant headings", async () => {
    await render(PER_ROUND_ONLY);

    expect(pills().map((pill) => pill.label)).toEqual([
      "All (6)",
      "Control (3)",
      "Hybrid (2)",
      "Push (1)"
    ]);

    const hybrid = pills().find((pill) => pill.label === "Hybrid (2)");
    await act(async () => hybrid?.button.click());

    expect(tileNames()).toEqual(["King's Row", "Numbani"]);
    // The pressed pill names the mode, so no section heading repeats it.
    expect(sections()).toEqual([]);
  });

  it("offers no filter for a pool that is all one gamemode", async () => {
    await render([config({ id: 420, mode: "pool", map_ids: [52, 37] })]);

    expect(pills()).toEqual([]);
    expect(tileNames()).toEqual(["Busan", "Ilios"]);
  });
});

describe("nothing to show", () => {
  it("says so when the tournament has no config at all", async () => {
    const text = await render([]);

    expect(text).toContain(COPY.notConfiguredTitle);
    expect(tileNames()).toEqual([]);
  });

  it("says so when every config is empty, rather than an empty pool card", async () => {
    // An organizer who created the levels and never filled them has published
    // no pool, which is exactly what the empty state says.
    const text = await render([
      config({ id: 430, stage_id: 188, round: 1, mode: "pool", map_ids: [] }),
      config({ id: 431, stage_id: 188, round: 2, mode: "slots", slots: [] })
    ]);

    expect(text).toContain(COPY.notConfiguredTitle);
    expect(text).not.toContain(COPY.poolEmpty);
    expect(tileNames()).toEqual([]);
  });
});

describe("the veto presentation is gone from this page", () => {
  it("shows no scope picker, no per-match format and no step list", async () => {
    const text = await render([
      ...PER_ROUND_ONLY,
      config({
        id: 440,
        stage_id: 189,
        round: 1,
        preset: "custom",
        sequence: ["ban_first", "pick_second", "decider"],
        map_ids: [52, 37, 45]
      })
    ]);

    // The picker and the cascade it fed.
    expect(text).not.toContain(COPY.source.exact);
    expect(text).not.toContain(COPY.source.tournament);
    // Series length and the ban/pick order are properties of one match, not of
    // the tournament's pool; they belong on the match's own page.
    expect(text).not.toContain(COPY.bracketFormat);
    expect(text).not.toContain(COPY.sequenceTitle);
    expect(text).not.toContain(COPY.customOrder);
    expect(text).not.toContain(en.mapVeto.step.banFirst);
    // Slots are the shape of one series' veto, so no slot survives either.
    expect(text).not.toContain(COPY.slotPoolDescription);
    expect(container.querySelector("select")).toBeNull();
  });
});
