// @vitest-environment happy-dom
//
// This page answers one question: which maps each round plays.
//
// Two earlier shapes are the reason it is this narrow. First it answered one
// level at a time behind a stage/round picker whose rounds came from
// `Stage.max_rounds`, so it could not name a lower-bracket round at all and a
// tournament configured the normal way — per round, no tournament default —
// opened on "the organizer has not published a map pool yet". Then it grew an
// aggregate pool card above the rounds, which said the same thing twice: once as
// thirty map tiles at the top and again as the tournament-default level below.
//
// What is pinned here:
//  1. every configured round is listed, grouped by stage, ordered the way it is
//     played, each with its maps in slot order;
//  2. a stage- or tournament-wide level is dropped while any round exists, and
//     rendered when it is the only thing configured;
//  3. candidates render as map art, and an id the catalogue cannot resolve keeps
//     its tile — a slot's candidate count is what the regulation is written
//     against;
//  4. a slot names the game mode its candidates share, and stays silent when
//     they do not agree;
//  5. the shared public-page shell, its states, and no per-match veto machinery.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type { MapRead } from "@/types/map.types";
import type { MapVetoConfig, Stage } from "@/types/tournament.types";

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
/**
 * The veto room's own copy, borrowed on purpose: a slot and a map the catalogue
 * cannot resolve are named identically on both player surfaces.
 */
const ROOM = en.encounters.veto.room;
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
 * for another. Three game modes of unequal size, so a slot can be made unanimous
 * or mixed at will.
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

/**
 * Two stages whose `order` is the reverse of their ids, so a page that sorted on
 * the id, or on whatever order the configs arrived in, would land the sections
 * the wrong way round.
 */
const STAGES: Stage[] = [
  { id: 188, name: "Groups", order: 1, stage_type: "swiss" },
  { id: 189, name: "Playoffs", order: 0, stage_type: "double_elimination" }
].map(
  (stage) =>
    ({
      ...stage,
      tournament_id: TOURNAMENT_ID,
      description: null,
      max_rounds: 5,
      advance_count: null,
      split_lower_bracket: false,
      is_active: false,
      is_completed: false,
      settings_json: null,
      challonge_id: null,
      challonge_slug: null,
      items: []
    }) as Stage
);

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  getAllMaps.mockResolvedValue({ results: MAPS });
  getStages.mockResolvedValue(STAGES);
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
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

/**
 * The page, flattened to the shape the regulation document has: one card per
 * stage, then each round with one row per map of the series.
 *
 * `background-image` is read rather than the tile's text, because the map art is
 * the point of the row: a candidate whose picture is missing would still pass a
 * name-only assertion.
 */
function stages() {
  return Array.from(container.querySelectorAll("section[role=group]")).map((stage) => ({
    title: stage.querySelector("h2")?.textContent?.trim() ?? null,
    label: stage.getAttribute("aria-label"),
    headings: Array.from(stage.querySelectorAll("p[class*=uppercase]:not([class*=gap-x])")).map(
      (p) => p.textContent?.trim()
    ),
    rounds: Array.from(stage.querySelectorAll("h3")).map((heading) => {
      const level = heading.parentElement;
      return {
        label: heading.textContent?.trim(),
        rows: Array.from(level?.querySelectorAll("ol > li") ?? []).map((row) => {
          const caption = row.querySelector("p");
          const spans = Array.from(caption?.querySelectorAll("span") ?? []).map((span) =>
            span.textContent?.trim()
          );
          return {
            slot: spans[0],
            mode: spans[1] ?? null,
            maps: Array.from(row.querySelectorAll("ul > li")).map((tile) => ({
              name: tile.querySelector("span")?.textContent?.trim(),
              art:
                tile
                  .querySelector<HTMLElement>("[style*=background-image]")
                  ?.style.backgroundImage.replace(/^url\("?|"?\)$/g, "") ?? null
            }))
          };
        })
      };
    })
  }));
}

/** Every map tile on the page, in DOM order. */
function tileNames() {
  return Array.from(container.querySelectorAll("ul > li > span")).map((span) =>
    span.textContent?.trim()
  );
}

/**
 * The shape the reported tournament had, and the shape its regulation document is
 * written in: every level is a per-round slot config, one slot per map of the
 * series with three candidates each, and each slot unanimous in its game mode.
 *
 * The stages are listed Groups-first and their ids ascend, while `order` puts
 * Playoffs first, so a page sorting on arrival or on id lands them wrong. Slot
 * positions in Lower R4 are gapped and listed out of order, since `position` is
 * the play order and nothing else reconstructs it.
 */
const REGULATION = [
  config({
    id: 401,
    stage_id: 188,
    round: 1,
    mode: "slots",
    slots: [
      { position: 1, candidates: [52, 37, 71], reserve_map_id: null },
      { position: 2, candidates: [63, 45], reserve_map_id: null }
    ]
  }),
  config({
    id: 402,
    stage_id: 188,
    round: 5,
    mode: "slots",
    slots: [
      { position: 1, candidates: [71, 52], reserve_map_id: null },
      { position: 2, candidates: [45, 63], reserve_map_id: null }
    ]
  }),
  config({
    id: 403,
    stage_id: 189,
    round: 1,
    mode: "slots",
    slots: [
      { position: 1, candidates: [52, 37], reserve_map_id: null },
      { position: 2, candidates: [63, 45], reserve_map_id: null },
      // Deliberately mixed: Control + Push, so no single mode can be named.
      { position: 3, candidates: [71, 84], reserve_map_id: null }
    ]
  }),
  config({
    id: 404,
    stage_id: 189,
    round: -1,
    mode: "slots",
    slots: [{ position: 1, candidates: [45, 63], reserve_map_id: null }]
  }),
  config({
    id: 405,
    stage_id: 189,
    round: -4,
    mode: "slots",
    slots: [
      { position: 7, candidates: [71, 52], reserve_map_id: null },
      { position: 2, candidates: [84, 84], reserve_map_id: 45 },
      { position: 4, candidates: [37, 52], reserve_map_id: null }
    ]
  })
];

describe("every configured round, in play order", () => {
  it("gives each stage its own card, ordered the way the stages are played", async () => {
    await render(REGULATION);

    const [playoffs, groups] = stages();
    // Playoffs first: `order` says so, while the ids and the arrival order both
    // say the opposite.
    expect(playoffs?.title).toBe("Playoffs");
    expect(playoffs?.label).toBe("Playoffs");
    expect(groups?.title).toBe("Groups");
    // Upper rounds ascend, then the lower bracket by depth — play order, not the
    // numeric order that would put -4 before -1.
    expect(playoffs?.rounds.map((round) => round.label)).toEqual([
      "Round 1",
      "Lower R1",
      "Lower R4"
    ]);
    expect(groups?.rounds.map((round) => round.label)).toEqual(["Round 1", "Round 5"]);
  });

  it("heads the two brackets only where a stage has both", async () => {
    await render(REGULATION);

    const [playoffs, groups] = stages();
    expect(playoffs?.headings).toEqual([COPY.roundGroupUpper, COPY.roundGroupLower]);
    // Groups has no lower bracket, so "Upper bracket" would name a distinction it
    // does not have.
    expect(groups?.headings).toEqual([]);
  });

  it("orders a round's rows on the slot's own position, not on the wire order", async () => {
    await render(REGULATION);

    // Lower R4 arrives as positions 7, 2, 4.
    const lowerR4 = stages()[0]?.rounds[2];
    expect(lowerR4?.label).toBe("Lower R4");
    expect(lowerR4?.rows.map((row) => row.slot)).toEqual([
      ROOM.slot.label.replace("{n}", "2"),
      ROOM.slot.label.replace("{n}", "4"),
      ROOM.slot.label.replace("{n}", "7")
    ]);
  });

  it("marks the reserve of the slot that names one, and only that slot", async () => {
    const text = await render(REGULATION);

    expect(text).toContain(ROOM.slot.reserve.replace("{map}", "King's Row"));
    // One reserve is configured across the whole fixture, so one mention.
    expect(text.split(ROOM.slot.reserve.split("{map}")[0]).length - 1).toBe(1);
  });

  it("says a slot nobody can ban down to one map cannot open the veto", async () => {
    // Reachable with no invalid save: `map_id` cascades from `overwatch.map`, so
    // deleting a map drops a stored slot under the floor the upsert checks.
    await render([
      config({
        id: 451,
        stage_id: 188,
        round: 3,
        mode: "slots",
        slots: [
          { position: 1, candidates: [52], reserve_map_id: null },
          { position: 2, candidates: [52, 37], reserve_map_id: null }
        ]
      })
    ]);

    const rows = stages()[0]?.rounds[0]?.rows ?? [];
    expect(container.textContent ?? "").toContain(COPY.slotUnderfilled.replace("{n}", "1"));
    expect(rows[1]?.maps.map((tile) => tile.name)).toEqual(["Busan", "Ilios"]);
  });

  it("gives a flat config one row for the whole series, and no slot number", async () => {
    await render([
      config({ id: 460, stage_id: 189, round: 2, mode: "pool", map_ids: [52, 37, 45] })
    ]);

    expect(stages()[0]?.rounds[0]).toEqual({
      label: "Round 2",
      rows: [
        {
          slot: COPY.roundPoolShared,
          mode: null,
          maps: [
            { name: "Busan", art: "/maps/52.jpg" },
            { name: "Ilios", art: "/maps/37.jpg" },
            { name: "King's Row", art: "/maps/45.jpg" }
          ]
        }
      ]
    });
  });
});

describe("candidates are map art", () => {
  it("renders one tile per configured candidate, in configured order", async () => {
    await render(REGULATION);

    // Repeats included: the same map may legitimately appear twice in one slot.
    expect(stages()[0]?.rounds[2]?.rows[0]).toEqual({
      slot: ROOM.slot.label.replace("{n}", "2"),
      mode: "Push",
      maps: [
        { name: "Colosseo", art: "/maps/84.jpg" },
        { name: "Colosseo", art: "/maps/84.jpg" }
      ]
    });
  });

  it("keeps the tile of an id the catalogue cannot resolve, and names it", async () => {
    await render([
      config({
        id: 450,
        stage_id: 188,
        round: 2,
        mode: "slots",
        slots: [{ position: 1, candidates: [52, RETIRED_MAP_ID, 37], reserve_map_id: null }]
      })
    ]);

    // Three tiles for three configured candidates: dropping the retired one would
    // report a slot the captains ban three ways as one they ban two ways.
    expect(stages()[0]?.rounds[0]?.rows[0]?.maps).toEqual([
      { name: "Busan", art: "/maps/52.jpg" },
      { name: ROOM.maps.mapNumber.replace("{id}", String(RETIRED_MAP_ID)), art: null },
      { name: "Ilios", art: "/maps/37.jpg" }
    ]);
  });
});

describe("the game mode a slot shares", () => {
  it("names the mode when every candidate agrees", async () => {
    await render(REGULATION);

    const [playoffs, groups] = stages();
    expect(groups?.rounds[0]?.rows.map((row) => row.mode)).toEqual(["Control", "Hybrid"]);
    expect(playoffs?.rounds[1]?.rows[0]?.mode).toBe("Hybrid");
  });

  it("stays silent on a slot whose candidates disagree", async () => {
    await render(REGULATION);

    // Playoffs Round 1 slot 3 mixes Control and Push: there is no single rule to
    // state, and picking one of the two would invent one.
    const mixed = stages()[0]?.rounds[0]?.rows[2];
    expect(mixed?.maps.map((tile) => tile.name)).toEqual(["Oasis", "Colosseo"]);
    expect(mixed?.mode).toBeNull();
  });

  it("stays silent when the catalogue cannot resolve a candidate's mode", async () => {
    await render([
      config({
        id: 452,
        stage_id: 188,
        round: 4,
        mode: "slots",
        slots: [{ position: 1, candidates: [52, RETIRED_MAP_ID], reserve_map_id: null }]
      })
    ]);

    // Two of two candidates would have to be Control for the rule to hold, and
    // one of them is unknown.
    expect(stages()[0]?.rounds[0]?.rows[0]?.mode).toBeNull();
  });
});

describe("levels that are not rounds", () => {
  it("drops the stage-wide and tournament-wide levels while any round exists", async () => {
    const text = await render([
      ...REGULATION,
      config({ id: 470, stage_id: null, round: null, mode: "pool", map_ids: [52, 37, 71, 63] }),
      config({ id: 471, stage_id: 188, round: null, mode: "pool", map_ids: [45, 84] })
    ]);

    // Rendered next to real rounds, a whole-series level reads as one more round
    // holding every map — the duplicate aggregate list this page dropped.
    expect(text).not.toContain(COPY.scope.tournamentDefault);
    expect(text).not.toContain(COPY.wholeStage);
    expect(stages().map((stage) => stage.title)).toEqual(["Playoffs", "Groups"]);
  });

  it("renders a whole-series level when it is the only thing configured", async () => {
    await render([
      config({ id: 470, stage_id: null, round: null, mode: "pool", map_ids: [52, 37] })
    ]);

    // Nothing else answers "what will we play", so the fallback is the answer.
    const [tournament] = stages();
    expect(tournament?.title).toBe(COPY.scope.tournamentDefault);
    expect(tournament?.rounds[0]?.rows[0]?.slot).toBe(COPY.roundPoolShared);
    expect(tileNames()).toEqual(["Busan", "Ilios"]);
  });

  it("falls back to the stage id when the stages read carries no such stage", async () => {
    getStages.mockResolvedValue([]);
    await render(REGULATION);

    expect(stages().map((stage) => stage.title)).toEqual([
      COPY.scope.unknownStage.replace("{id}", "188"),
      COPY.scope.unknownStage.replace("{id}", "189")
    ]);
  });
});

describe("nothing to show", () => {
  it("says so when the tournament has no config at all", async () => {
    const text = await render([]);

    expect(text).toContain(COPY.notConfiguredTitle);
    expect(stages()).toEqual([]);
  });

  it("says so when every config is empty", async () => {
    // An organizer who created the levels and never filled them has published no
    // pool, which is exactly what the empty state says.
    const text = await render([
      config({ id: 430, stage_id: 188, round: 1, mode: "pool", map_ids: [] }),
      config({ id: 431, stage_id: 188, round: 2, mode: "slots", slots: [] })
    ]);

    expect(text).toContain(COPY.notConfiguredTitle);
    expect(stages()).toEqual([]);
  });
});

/*
 * The page reached this file as a shadcn `Card` island with hand-rolled filter
 * pills, its own loading skeleton and its own error gate — a second design
 * system inside a tab strip whose other six pages share one. These pin the
 * shared vocabulary so it cannot drift back.
 */
describe("the shared public-page design system", () => {
  it("renders inside the public-page container, on shared card surfaces", async () => {
    await render(REGULATION);

    // `styles.publicDataPage` is what pins every child to `min-width: 0`, so a
    // wide descendant owns its overflow instead of scrolling the document.
    const shell = container.querySelector("section[class*=publicDataPage]");
    expect(shell).not.toBeNull();
    expect(shell?.getAttribute("aria-label")).toBe(en.common.maps);
    // Every stage surface is `tn-card`, the shared surface token.
    const surfaces = Array.from(container.querySelectorAll("section[role=group]"));
    expect(surfaces).toHaveLength(2);
    expect(surfaces.every((surface) => surface.classList.contains("tn-card"))).toBe(true);
  });

  it("announces the loading state instead of showing silent grey blocks", async () => {
    // A read that never settles: the page must be in its shared skeleton.
    // Deliberately never resolved: the resolver is dropped on the floor.
    getVetoConfigs.mockReturnValue(Promise.withResolvers<never>().promise);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

    const region = container.querySelector('[role="status"]');
    expect(region?.getAttribute("aria-busy")).toBe("true");
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(region?.getAttribute("data-skeleton-variant")).toBe("maps");
    expect(region?.textContent).toContain(en.tournamentDetail.loading.pages.maps);
  });

  it("keeps the rendered rounds on screen when a refetch fails", async () => {
    await render(REGULATION);
    const before = tileNames().length;
    expect(before).toBeGreaterThan(0);

    // The reads have landed once; now the catalogue refetch fails. The old gate
    // tested `isError` before anything else and threw the whole page away for a
    // full-page error card, losing content the viewer was already reading.
    getAllMaps.mockRejectedValue(new Error("network"));
    await act(async () => {
      await client.refetchQueries({ queryKey: ["maps", "all", "gamemode"] }).catch(() => {});
    });
    await settle();

    expect(tileNames()).toHaveLength(before);
    expect(container.textContent ?? "").toContain(
      en.tournamentDetail.pageState.refreshError.title
    );
  });
});

describe("the per-match veto machinery is not on this page", () => {
  it("shows no scope picker, no per-match format and no step list", async () => {
    const text = await render([
      ...REGULATION,
      config({
        id: 440,
        stage_id: 189,
        round: 2,
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
    expect(container.querySelector("select")).toBeNull();
  });
});
