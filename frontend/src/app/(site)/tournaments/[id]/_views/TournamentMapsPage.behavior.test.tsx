// @vitest-environment happy-dom
//
// This page answers two questions and no others: which maps the tournament
// plays, and which of them each round plays.
//
// It used to answer one level at a time, chosen through a stage/round picker.
// That picker built its rounds from `Stage.max_rounds`, so it could not reach a
// lower-bracket round at all, and it offered rounds an elimination bracket never
// plays. Worse, the cascade it fed starts at the tournament default — so a
// tournament whose organizer wrote only per-round configs, which is the normal
// shape, opened on "the organizer has not published a map pool yet" and stayed
// there until the viewer guessed a configured round.
//
// What is pinned here:
//  1. the pool is the union over every config, deduplicated, including levels a
//     picker could never reach, and slot candidates and reserves count as
//     members of it;
//  2. the per-round block lists exactly the configured levels, grouped by stage
//     and ordered the way they are played, each with its maps in slot order;
//  3. an unresolvable id is dropped from the pool — nobody plays a retired map —
//     but named in a round's rows, where a slot's candidate count is what the
//     regulation is written against;
//  4. the per-match ban/pick machinery is not on this page.
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
 * The two blocks are addressed by their own labelled region, never off the whole
 * container: both hold `section` elements and map names, so an assertion read
 * from the document at large cannot tell which block answered.
 */
function block(label: string): HTMLElement {
  const match = container.querySelector<HTMLElement>(`[role="group"][aria-label="${label}"]`);
  if (!match) throw new Error(`no block labelled ${JSON.stringify(label)}`);
  return match;
}

function poolBlock() {
  return block(COPY.poolTitle);
}

function roundsBlock() {
  return block(COPY.roundsTitle);
}

/** Map names on the pool tiles, read off the pool block alone. */
function tileNames() {
  return Array.from(poolBlock().querySelectorAll("li > span")).map((span) =>
    span.textContent?.trim()
  );
}

/**
 * The pool's gamemode sections in DOM order, each with only its own tiles.
 *
 * The outline is `h2` surface -> `h3` group -> `h4` level, so nothing skips a
 * level under the page's own `h1` and no deeper heading outsizes its parent.
 */
function sections() {
  return Array.from(poolBlock().querySelectorAll("section")).map((section) => ({
    heading: section.querySelector("h3")?.textContent?.trim(),
    tiles: Array.from(section.querySelectorAll("li > span")).map((span) =>
      span.textContent?.trim()
    )
  }));
}

/**
 * The per-round block, flattened to the shape the regulation document has: stage
 * heading, then each level with one line per map of the series.
 */
function rounds() {
  return Array.from(roundsBlock().querySelectorAll("section")).map((section) => ({
    stage: section.querySelector("h3")?.textContent?.trim() ?? null,
    headings: Array.from(section.querySelectorAll("p")).map((p) => p.textContent?.trim()),
    levels: Array.from(section.querySelectorAll("h4")).map((heading) => {
      const level = heading.parentElement;
      return {
        label: heading.textContent?.trim(),
        rows: Array.from(level?.querySelectorAll("li") ?? []).map((row) => {
          const [slot, ...chips] = Array.from(row.querySelectorAll("span")).map((span) =>
            span.textContent?.trim()
          );
          return { slot, chips };
        })
      };
    })
  }));
}

/**
 * The gamemode filters. Label and count are read apart, because the shared
 * `FilterChip` puts the count in its own `.aqt-count` element rather than
 * concatenating it into the label the way this page's local pills used to.
 */
function pills() {
  const group = container.querySelector<HTMLElement>(
    `[role="group"][aria-label="${COPY.filterLabel}"]`
  );
  return Array.from(group?.querySelectorAll("button") ?? []).map((button) => {
    const count = button.querySelector(".aqt-count");
    return {
      chip: button.classList.contains("aqt-filter-chip"),
      label: (button.textContent ?? "").replace(count?.textContent ?? "", "").trim(),
      count: count?.textContent?.trim() ?? null,
      pressed: button.getAttribute("aria-pressed") === "true",
      button
    };
  });
}

/**
 * The shape the reported tournament actually had, and the shape its regulation
 * document is written in: every level is a per-round slot config, one slot per
 * map of the series with three candidates each. No tournament default and no
 * stage default, spread over a Swiss stage and both halves of a
 * double-elimination bracket — under the old picker the two lower-bracket levels
 * were unreachable and the page opened on "not configured".
 *
 * The stages are listed Groups-first and their ids ascend, while `order` puts
 * Playoffs first, so a page sorting on arrival or on id lands them wrong. King's
 * Row appears only in Lower R1 and Colosseo only in Lower R4, so the pool cannot
 * be assembled from the reachable levels alone. Slot positions in Lower R4 are
 * gapped and listed out of order, since `position` is the play order and nothing
 * else reconstructs it.
 */
const REGULATION = [
  config({
    id: 401,
    stage_id: 188,
    round: 1,
    mode: "slots",
    slots: [
      { position: 1, candidates: [52, 37, 63], reserve_map_id: null },
      { position: 2, candidates: [63, 52, 37], reserve_map_id: null }
    ]
  }),
  config({
    id: 402,
    stage_id: 188,
    round: 5,
    mode: "slots",
    slots: [
      { position: 1, candidates: [71, 52, 37], reserve_map_id: null },
      { position: 2, candidates: [37, 71, 52], reserve_map_id: null }
    ]
  }),
  config({
    id: 403,
    stage_id: 189,
    round: 1,
    mode: "slots",
    slots: [
      { position: 1, candidates: [52, 37, 63], reserve_map_id: null },
      { position: 2, candidates: [63, 71, 52], reserve_map_id: null },
      { position: 3, candidates: [71, 37, 63], reserve_map_id: null }
    ]
  }),
  config({
    id: 404,
    stage_id: 189,
    round: -1,
    mode: "slots",
    slots: [
      { position: 1, candidates: [45, 52, 37], reserve_map_id: null },
      { position: 2, candidates: [63, 45, 71], reserve_map_id: null },
      { position: 3, candidates: [52, 63, 37], reserve_map_id: null }
    ]
  }),
  config({
    id: 405,
    stage_id: 189,
    round: -4,
    mode: "slots",
    slots: [
      { position: 7, candidates: [63, 52, 71], reserve_map_id: null },
      { position: 2, candidates: [84, 52, 37], reserve_map_id: 45 },
      { position: 4, candidates: [37, 84, 63], reserve_map_id: null }
    ]
  })
];

describe("the pool spans every configured level", () => {
  it("unions the maps of every config, deduplicated", async () => {
    const text = await render(REGULATION);

    // Six distinct maps across five slot configs naming thirty-eight candidates.
    expect(tileNames()).toEqual(["Busan", "Ilios", "Oasis", "King's Row", "Numbani", "Colosseo"]);
    expect(text).toContain("6 maps in the pool");
    expect(text).not.toContain(COPY.notConfiguredTitle);
  });

  it("includes maps only a lower-bracket round names, which no selector reached", async () => {
    // King's Row is in Lower R1 and nowhere else, Colosseo in Lower R4 and
    // nowhere else. Both were invisible on this page for as long as its rounds
    // came from `max_rounds`, which never produced a negative one.
    await render(REGULATION);

    expect(tileNames()).toContain("King's Row");
    expect(tileNames()).toContain("Colosseo");
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

    // A map retired from rotation is not something anyone will play, so the pool
    // leaves it out entirely rather than naming it as "Map #96" — which is
    // exactly what the round's own row below does, and must keep doing.
    expect(tileNames()).toEqual(["Busan"]);
    expect(text).toContain("1 map in the pool");
    expect(poolBlock().textContent ?? "").not.toContain(String(RETIRED_MAP_ID));
    expect(roundsBlock().textContent ?? "").toContain(`Map #${RETIRED_MAP_ID}`);
  });
});

describe("grouping and filtering", () => {
  it("groups by gamemode, largest first, alphabetically inside a group", async () => {
    await render(REGULATION);

    expect(sections()).toEqual([
      { heading: "Control (3)", tiles: ["Busan", "Ilios", "Oasis"] },
      { heading: "Hybrid (2)", tiles: ["King's Row", "Numbani"] },
      { heading: "Push (1)", tiles: ["Colosseo"] }
    ]);
  });

  it("filters to one gamemode and drops the now-redundant headings", async () => {
    await render(REGULATION);

    // The site-wide chip, not a local pill: label and count are separate
    // elements, and the count carries the shared `.aqt-count` treatment.
    expect(pills()).toMatchObject([
      { chip: true, label: COPY.filterAll, count: "6", pressed: true },
      { chip: true, label: "Control", count: "3", pressed: false },
      { chip: true, label: "Hybrid", count: "2", pressed: false },
      { chip: true, label: "Push", count: "1", pressed: false }
    ]);

    const hybrid = pills().find((pill) => pill.label === "Hybrid");
    await act(async () => hybrid?.button.click());

    expect(tileNames()).toEqual(["King's Row", "Numbani"]);
    expect(pills().find((pill) => pill.label === "Hybrid")?.pressed).toBe(true);
    // The pressed chip names the mode, so no section heading repeats it.
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
    // Neither block exists: there is no pool to list and no level to break down.
    expect(() => poolBlock()).toThrow();
    expect(() => roundsBlock()).toThrow();
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
    expect(() => poolBlock()).toThrow();
  });
});

describe("the per-round breakdown", () => {
  it("lists every configured level by stage, in the order it is played", async () => {
    await render(REGULATION);

    const [playoffs, groups] = rounds();
    // Playoffs first: `order` says so, while the ids and the arrival order both
    // say the opposite.
    expect(playoffs?.stage).toBe("Playoffs");
    expect(groups?.stage).toBe("Groups");
    // Upper rounds ascend, then the lower bracket by depth — play order, not the
    // numeric order that would put -4 before -1.
    expect(playoffs?.levels.map((level) => level.label)).toEqual([
      "Round 1",
      "Lower R1",
      "Lower R4"
    ]);
    expect(groups?.levels.map((level) => level.label)).toEqual(["Round 1", "Round 5"]);
  });

  it("heads the two brackets only where a stage has both", async () => {
    await render(REGULATION);

    const [playoffs, groups] = rounds();
    expect(playoffs?.headings).toEqual([COPY.roundGroupUpper, COPY.roundGroupLower]);
    // Groups has no lower bracket, so "Upper bracket" would name a distinction it
    // does not have.
    expect(groups?.headings).toEqual([]);
  });

  it("gives each round its maps in slot order, one row per map of the series", async () => {
    await render(REGULATION);

    // The regulation's own shape: "Slot 1: A / B / C" per map of the series.
    expect(rounds()[1]?.levels[0]).toEqual({
      label: "Round 1",
      rows: [
        { slot: "Slot 1", chips: ["Busan", "Ilios", "Numbani"] },
        { slot: "Slot 2", chips: ["Numbani", "Busan", "Ilios"] }
      ]
    });
  });

  it("orders a round's rows on the slot's own position, not on the wire order", async () => {
    await render(REGULATION);

    // Lower R4 arrives as positions 7, 2, 4 and carries a reserve on position 2.
    const lowerR4 = rounds()[0]?.levels[2];
    expect(lowerR4?.label).toBe("Lower R4");
    expect(lowerR4?.rows.map((row) => row.slot)).toEqual(["Slot 2", "Slot 4", "Slot 7"]);
    expect(lowerR4?.rows[0]?.chips).toEqual([
      "Colosseo",
      "Busan",
      "Ilios",
      ROOM.slot.reserve.replace("{map}", "King's Row")
    ]);
  });

  it("names an unresolvable candidate here, where the count is regulation-critical", async () => {
    await render([
      config({
        id: 450,
        stage_id: 188,
        round: 2,
        mode: "slots",
        slots: [{ position: 1, candidates: [52, RETIRED_MAP_ID, 37], reserve_map_id: null }]
      })
    ]);

    // Three chips for three configured candidates: dropping the retired one, the
    // way the pool above drops it, would report a slot the organizer can ban
    // three ways as one they can ban two ways.
    expect(rounds()[0]?.levels[0]?.rows[0]?.chips).toEqual(["Busan", "Map #96", "Ilios"]);
    expect(tileNames()).toEqual(["Busan", "Ilios"]);
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

    const [underfilled, fine] = rounds()[0]?.levels[0]?.rows ?? [];
    expect(underfilled?.chips).toContain(COPY.slotUnderfilled.replace("{n}", "1"));
    expect(fine?.chips).toEqual(["Busan", "Ilios"]);
  });

  it("gives a flat config one row for the whole series, and no slot number", async () => {
    await render([
      config({ id: 460, stage_id: 189, round: 2, mode: "pool", map_ids: [52, 37, 45] })
    ]);

    expect(rounds()[0]?.levels[0]).toEqual({
      label: "Round 2",
      rows: [{ slot: COPY.roundPoolShared, chips: ["Busan", "Ilios", "King's Row"] }]
    });
  });

  it("names the stage-wide and tournament-wide levels, and sorts them first", async () => {
    await render([
      config({ id: 471, stage_id: 188, round: 2, mode: "pool", map_ids: [37] }),
      config({ id: 472, stage_id: 188, round: null, mode: "pool", map_ids: [52] }),
      config({ id: 470, stage_id: null, round: null, mode: "pool", map_ids: [45] })
    ]);

    const [tournament, groups] = rounds();
    // The tournament-wide level belongs to no stage, so its section carries no
    // stage heading, and it comes first because it applies everywhere.
    expect(tournament?.stage).toBeNull();
    expect(tournament?.levels.map((level) => level.label)).toEqual([
      COPY.scope.tournamentDefault
    ]);
    expect(groups?.levels.map((level) => level.label)).toEqual([COPY.wholeStage, "Round 2"]);
  });

  it("falls back to the stage id when the stages read carries no such stage", async () => {
    getStages.mockResolvedValue([]);
    await render(REGULATION);

    expect(rounds().map((section) => section.stage)).toEqual([
      COPY.scope.unknownStage.replace("{id}", "188"),
      COPY.scope.unknownStage.replace("{id}", "189")
    ]);
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
    // Both surfaces are `tn-card`, the shared surface token, and neither is a
    // local rounded-border div.
    expect(poolBlock().classList.contains("tn-card")).toBe(true);
    expect(roundsBlock().classList.contains("tn-card")).toBe(true);
  });

  it("announces the loading state instead of showing silent grey blocks", async () => {
    // A read that never settles: the page must be in its shared skeleton.
    getVetoConfigs.mockReturnValue(new Promise(() => {}));
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

    const region = container.querySelector('[role="status"]');
    expect(region?.getAttribute("aria-busy")).toBe("true");
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(region?.getAttribute("data-skeleton-variant")).toBe("maps");
    expect(region?.textContent).toContain(en.tournamentDetail.loading.pages.maps);
  });

  it("keeps the rendered pool on screen when a refetch fails", async () => {
    await render(REGULATION);
    expect(tileNames()).toHaveLength(6);

    // The reads have landed once; now the catalogue refetch fails. The old gate
    // tested `isError` before anything else and threw the whole page away for a
    // full-page error card, losing content the viewer was already reading.
    getAllMaps.mockRejectedValue(new Error("network"));
    await act(async () => {
      await client.refetchQueries({ queryKey: ["maps", "all", "gamemode"] }).catch(() => {});
    });
    await settle();

    expect(tileNames()).toHaveLength(6);
    expect(container.textContent ?? "").toContain(
      en.tournamentDetail.pageState.refreshError.title
    );
  });
});
