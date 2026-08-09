// @vitest-environment happy-dom
//
// The tab lists every cascade level at once — the tournament default, each
// stage, and each of that stage's rounds — and every level is expanded on
// arrival: the maps are the work, so they are on screen the moment the page is.
// Collapsing exists for reach on a long page, at two granularities only: a
// whole stage card, or one level.
//
// Two properties make that shape safe, and both are pinned here:
//
//   1. a level's draft lives in the tab, not in the editor, so collapsing a
//      level or its stage (which unmounts the editor) never discards work, and
//      a map-catalogue refetch never reverts an edit in progress;
//   2. a level with no draft re-derives its form from its stored config alone,
//      so a level can never present another level's pool as its own.
//
// The rest of the file is the behaviour the editor has always owed: the series
// length comes from the bracket, the two pool shapes each send their own wire
// shape, and the round list covers both brackets.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type { MapRead } from "@/types/map.types";
import type { MapVetoConfig, Stage } from "@/types/tournament.types";

import { TournamentMapVetoTab, type StageRoundSource } from "./TournamentMapVetoTab";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const listVetoConfigs = vi.fn();
const upsertVetoConfig = vi.fn();
const deleteVetoConfig = vi.fn();
const getAll = vi.fn();

vi.mock("@/services/admin.service", () => ({
  default: {
    listVetoConfigs: (...args: unknown[]) => listVetoConfigs(...args),
    upsertVetoConfig: (...args: unknown[]) => upsertVetoConfig(...args),
    deleteVetoConfig: (...args: unknown[]) => deleteVetoConfig(...args)
  }
}));

vi.mock("@/services/map.service", () => ({
  default: { getAll: (...args: unknown[]) => getAll(...args) }
}));

vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn() }
}));

const GAMEMODES: Record<string, number> = { Control: 4, Hybrid: 5, Escort: 2, Push: 6 };

/**
 * Twelve competitive maps across four gamemodes — ids 1..12.
 *
 * The last three carry the catalogue spellings the paper regulation writes
 * differently: `Shambali Monastery` for "Shambali", `Paraíso` for "Paraiso",
 * and `King’s Row` with U+2019 for a typed U+0027. Together with the existing
 * `Antarctic Peninsula` (written "Peninsular") they are the four near-misses
 * the picker's name filter has to land on.
 */
function catalogue(): MapRead[] {
  const names = [
    ["Antarctic Peninsula", "Control"],
    ["Busan", "Control"],
    ["Ilios", "Control"],
    ["Blizzard World", "Hybrid"],
    ["Eichenwalde", "Hybrid"],
    ["Midtown", "Hybrid"],
    ["Circuit Royal", "Escort"],
    ["Dorado", "Escort"],
    ["Havana", "Escort"],
    ["Shambali Monastery", "Escort"],
    ["Paraíso", "Push"],
    ["King’s Row", "Hybrid"]
  ] as const;
  return names.map(([name, gamemode], index) => ({
    id: index + 1,
    gamemode_id: GAMEMODES[gamemode],
    name,
    image_path: `https://example.test/${name}.jpg`,
    in_competitive: true,
    gamemode: {
      id: GAMEMODES[gamemode],
      slug: gamemode.toLowerCase(),
      name: gamemode,
      image_path: "",
      description: ""
    }
  })) as MapRead[];
}

const CATALOGUE_ORDER = catalogue().map((map) => map.name);

function stage(
  id: number,
  name: string,
  order: number,
  maxRounds: number,
  bestOf?: Record<string, unknown>
): Stage {
  return {
    id,
    tournament_id: 78,
    name,
    description: null,
    stage_type: "swiss",
    max_rounds: maxRounds,
    advance_count: null,
    split_lower_bracket: false,
    order,
    is_active: false,
    is_completed: true,
    settings_json: bestOf ? { best_of: bestOf } : null,
    challonge_id: null,
    challonge_slug: null,
    items: []
  } as Stage;
}

/** Tournament default: a 5-map Bo3 pool, deliberately NOT the whole catalogue. */
const TOURNAMENT_DEFAULT: MapVetoConfig = {
  id: 900,
  tournament_id: 78,
  stage_id: null,
  round: null,
  mode: "pool",
  preset: "bo3",
  first_pick_rule: "higher_seed",
  // Serialized on every config; slot mode is what reads it.
  first_ban_rotation: "fixed",
  turn_timer_seconds: 30,
  sequence: ["ban_first", "ban_second", "pick_first", "pick_second", "decider"],
  map_ids: [1, 4, 7, 2, 5],
  slots: []
};

/** `TOURNAMENT_DEFAULT.map_ids` as names, in the order the pool is stored in. */
const TOURNAMENT_DEFAULT_POOL = [
  "Antarctic Peninsula",
  "Blizzard World",
  "Circuit Royal",
  "Busan",
  "Eichenwalde"
];

// Groups runs Bo2, so a config carrying a Bo3 template disagrees with the
// bracket — which is exactly the divergence the bracket now settles.
const STAGES = [
  stage(188, "Groups", 0, 5, { default: 2 }),
  stage(189, "Playoffs", 1, 3, { default: 3, final: 5 })
];

/**
 * A slot-mode config, deliberately awkward so a fixture cannot stand in for a
 * correct implementation:
 *  - the slots arrive out of `position` order, so trusting array order over
 *    `position` renumbers them;
 *  - the slots hold different numbers of candidates, so neither length is
 *    interchangeable with the other's;
 *  - candidate ids are unsorted, so a stray sort is visible;
 *  - only the second slot carries a reserve, so a dropped reserve cannot hide
 *    behind a uniform value;
 *  - `first_ban_rotation` is "alternate", so a save that omits it reads back as
 *    the server's "fixed" default.
 *
 * It sits on round 1 of the Bo2 Groups stage rather than on the tournament
 * default, because the editor derives one slot row per map of the series: the
 * two slots are only coherent where the bracket plays two maps, and the gate
 * refuses slot mode at the tournament default outright.
 */
const SLOT_CONFIG: MapVetoConfig = {
  ...TOURNAMENT_DEFAULT,
  id: 910,
  stage_id: 188,
  round: 1,
  mode: "slots",
  preset: "bracket",
  first_ban_rotation: "alternate",
  // A slot config carries neither, and the upsert 422s any other value.
  sequence: [],
  map_ids: [],
  slots: [
    { position: 2, candidates: [5, 3], reserve_map_id: 9 },
    { position: 1, candidates: [7, 1, 4], reserve_map_id: null }
  ]
};

/** What the upsert must receive for `SLOT_CONFIG`: play order, and no `position`. */
const SLOT_DRAFT = [
  { candidates: [7, 1, 4], reserve_map_id: null },
  { candidates: [5, 3], reserve_map_id: 9 }
];

/**
 * A second slot config, on round 2 of the same stage, holding the same number
 * of slots as `SLOT_CONFIG` but four candidates rather than five.
 *
 * Two slot rounds on screen whose slot counts agree and whose candidate totals
 * do not: a summary that reported the slot count twice, or the catalogue size,
 * or one round's numbers for both, is wrong on at least one of them.
 */
const SLOT_CONFIG_ROUND_2: MapVetoConfig = {
  ...SLOT_CONFIG,
  id: 911,
  round: 2,
  slots: [
    { position: 1, candidates: [2, 6], reserve_map_id: null },
    { position: 2, candidates: [8, 11], reserve_map_id: 3 }
  ]
};

/**
 * A flat config on round 3, with a three-map pool — distinct from both slot
 * configs' slot count (2) and candidate totals (5 and 4), and from the
 * catalogue's 12, so the flat summary cannot borrow any of them.
 */
const FLAT_CONFIG_ROUND_3: MapVetoConfig = {
  ...TOURNAMENT_DEFAULT,
  id: 912,
  stage_id: 188,
  round: 3,
  sequence: ["ban_first", "pick_first", "pick_second"],
  map_ids: [3, 6, 9]
};

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

async function settle(times = 40) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

function text() {
  return container.textContent ?? "";
}

/**
 * `stages` defaults to the two-stage swiss fixture every earlier test is
 * written against. `encounters` is left undefined by default, which is also
 * what the tab sees before the encounters read lands.
 */
async function mount(options: { stages?: Stage[]; encounters?: StageRoundSource[] } = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <QueryClientProvider client={client}>
          <TournamentMapVetoTab
            tournamentId={78}
            stages={options.stages ?? STAGES}
            encounters={options.encounters}
            canManage
          />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
  await settle(3);
}

/** Type into a controlled input the way React's synthetic layer sees it. */
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(3);
}

/*
 * Addressing the page.
 *
 * Every level is a `role="group"` named by its full path, so the same "Round 1"
 * in two stages stays distinguishable. Inside it, the collapse control is the
 * only `h3 > button`; the editor is the only `form`.
 */

const LEVEL_TOURNAMENT = en.mapVeto.scope.tournamentDefault;

function levelStage(stageName: string): string {
  return en.mapVeto.scope.stage.replace("{stage}", stageName);
}

function levelRound(stageName: string, round: number): string {
  return en.mapVeto.scope.stageRound
    .replace("{stage}", stageName)
    .replace("{round}", String(round));
}

function level(fullLabel: string): HTMLElement {
  const match = container.querySelector<HTMLElement>(`[role="group"][aria-label="${fullLabel}"]`);
  if (!match) throw new Error(`no level group labelled ${JSON.stringify(fullLabel)}`);
  return match;
}

/** One stage's card, which is also the group its levels live in. */
function stageGroup(name: string): HTMLElement {
  const match = container.querySelector<HTMLElement>(`[role="group"][aria-label="${name}"]`);
  if (!match) throw new Error(`no stage group for ${JSON.stringify(name)}`);
  return match;
}

function levelRows(scope: ParentNode = container): HTMLButtonElement[] {
  return [...scope.querySelectorAll<HTMLButtonElement>("h3 > button")];
}

/** A level's own short label: the first span inside the trigger's wrapper. */
function rowLabel(trigger: HTMLElement): string {
  return (trigger.querySelector("span > span")?.textContent ?? "").trim();
}

function levelTrigger(fullLabel: string): HTMLButtonElement {
  const match = level(fullLabel).querySelector<HTMLButtonElement>("h3 > button");
  if (!match) throw new Error(`no collapse control in ${JSON.stringify(fullLabel)}`);
  return match;
}

function editor(fullLabel: string): HTMLElement {
  const match = level(fullLabel).querySelector<HTMLElement>("form");
  if (!match) throw new Error(`level ${JSON.stringify(fullLabel)} is collapsed`);
  return match;
}

function editorText(fullLabel: string): string {
  return editor(fullLabel).textContent ?? "";
}

function editorButton(fullLabel: string, needle: string): HTMLButtonElement {
  const match = [...editor(fullLabel).querySelectorAll("button")].find((element) =>
    (element.textContent ?? "").includes(needle)
  );
  if (!match) throw new Error(`no button containing ${JSON.stringify(needle)} in ${fullLabel}`);
  return match as HTMLButtonElement;
}

function saveButton(fullLabel: string): HTMLButtonElement {
  return editorButton(fullLabel, en.mapVetoAdmin.save);
}

/**
 * A level with no config of its own shows the pool it inherits, read only, and
 * offers exactly one control: this one, which copies that pool into an editable
 * draft for the level.
 */
async function fork(fullLabel: string) {
  await click(editorButton(fullLabel, en.mapVetoAdmin.forkLevel));
}

/**
 * The pool shape, the step order, the first-ban rotation and the timer are
 * decided once per level, so they live behind "Advanced" rather than on eleven
 * copies of the page.
 */
async function openAdvanced(fullLabel: string) {
  const trigger = editorButton(fullLabel, en.mapVetoAdmin.advancedTitle);
  if (trigger.getAttribute("data-state") !== "open") await click(trigger);
}

/**
 * The pool-shape, step-order and first-ban controls are the `aria-pressed`
 * buttons that carry no `aria-label`; a picker tile is `aria-pressed` too, so
 * the absence of the attribute is what separates them.
 */
function toggleByText(fullLabel: string, label: string): HTMLButtonElement {
  const match = [
    ...editor(fullLabel).querySelectorAll("button[aria-pressed]:not([aria-label])")
  ].find((element) => (element.textContent ?? "").includes(label));
  if (!match) throw new Error(`no toggle for ${JSON.stringify(label)} in ${fullLabel}`);
  return match as HTMLButtonElement;
}

function pressed(fullLabel: string, label: string): string | null {
  return toggleByText(fullLabel, label).getAttribute("aria-pressed");
}

/*
 * Selection rows and the picker.
 *
 * A row is `role="group"` under its own label; the maps it holds are tokens,
 * one button each. The catalogue lives in a popover the row's "Add maps" button
 * opens, portalled out of the container under its own group label.
 */

/** The flat pool row, under whichever of its two names this level shows. */
function poolRow(fullLabel: string): HTMLElement {
  const match = editor(fullLabel).querySelector<HTMLElement>(
    `[role="group"][aria-label="${en.mapVetoAdmin.poolTitle}"],` +
      `[role="group"][aria-label="${en.mapVetoAdmin.poolInheritedTitle}"]`
  );
  if (!match) throw new Error(`no flat pool row in ${fullLabel}`);
  return match;
}

function slotRow(fullLabel: string, position: number): HTMLElement {
  const label = en.mapVetoAdmin.slotLabel.replace("{n}", String(position));
  const match = editor(fullLabel).querySelector<HTMLElement>(
    `[role="group"][aria-label="${label}"]`
  );
  if (!match) throw new Error(`no slot ${position} row in ${fullLabel}`);
  return match;
}

/**
 * The maps a row holds, in the order they are stored in. An editable token is a
 * remove button, an inherited one a plain span; both carry the full name as
 * `title`, which is also what makes a truncated name reachable.
 */
function tokens(row: HTMLElement): string[] {
  return [...row.querySelectorAll('[title]:not([role="combobox"])')].map((element) =>
    (element.getAttribute("title") ?? "").trim()
  );
}

function poolMaps(fullLabel: string): string[] {
  return tokens(poolRow(fullLabel));
}

function slotMaps(fullLabel: string, position: number): string[] {
  return tokens(slotRow(fullLabel, position));
}

/** Remove one map straight from the row, the way its token does. */
async function removeFromPool(fullLabel: string, name: string) {
  const label = en.mapVetoAdmin.poolChipRemove.replace("{map}", name);
  const token = poolRow(fullLabel).querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!token) throw new Error(`no ${name} token in the pool of ${fullLabel}`);
  await click(token);
}

function pickerTrigger(row: HTMLElement): HTMLButtonElement {
  const match = [...row.querySelectorAll("button")].find((element) =>
    (element.textContent ?? "").includes(en.mapVetoAdmin.addMaps)
  );
  if (!match) throw new Error("no picker trigger in this row");
  return match as HTMLButtonElement;
}

/** The open picker, addressed by the group label its row gave it. */
function picker(label: string): HTMLElement {
  const match = document.body.querySelector<HTMLElement>(`[role="group"][aria-label="${label}"]`);
  if (!match) throw new Error(`no open picker labelled ${JSON.stringify(label)}`);
  return match;
}

const POOL_PICKER = en.mapVetoAdmin.poolPickerLabel;

function slotPicker(position: number): string {
  return en.mapVetoAdmin.slotPickerLabel.replace("{slot}", String(position));
}

/** Every map the open picker currently offers, in render order. */
function pickerMaps(label: string): string[] {
  return [...picker(label).querySelectorAll("button[aria-pressed][aria-label]")].map((element) =>
    (element.getAttribute("aria-label") ?? "").split(",")[0]
  );
}

function pickerTile(label: string, name: string): HTMLButtonElement {
  const match = [...picker(label).querySelectorAll("button[aria-pressed][aria-label]")].find(
    (element) => (element.getAttribute("aria-label") ?? "").split(",")[0] === name
  );
  if (!match) throw new Error(`no ${label} tile for ${JSON.stringify(name)}`);
  return match as HTMLButtonElement;
}

function pickerButton(label: string, needle: string): HTMLButtonElement {
  const match = [...picker(label).querySelectorAll("button")].find(
    (element) => (element.textContent ?? "").trim() === needle
  );
  if (!match) throw new Error(`no ${label} button labelled ${JSON.stringify(needle)}`);
  return match as HTMLButtonElement;
}

function pickerSearch(label: string): HTMLInputElement {
  const match = picker(label).querySelector("input");
  if (!match) throw new Error(`no ${label} search field`);
  return match as HTMLInputElement;
}

/** Open one row's picker, run against it, and close it again. */
async function withPicker(row: () => HTMLElement, label: string, body: () => Promise<void>) {
  await click(pickerTrigger(row()));
  await body();
  await click(pickerTrigger(row()));
}

async function addToPool(fullLabel: string, names: string[]) {
  await withPicker(() => poolRow(fullLabel), POOL_PICKER, async () => {
    for (const name of names) await click(pickerTile(POOL_PICKER, name));
  });
}

async function addToSlot(fullLabel: string, position: number, names: string[]) {
  const label = slotPicker(position);
  await withPicker(() => slotRow(fullLabel, position), label, async () => {
    for (const name of names) await click(pickerTile(label, name));
  });
}

/**
 * Radix Select: the trigger opens on pointerdown and the listbox is portalled
 * out of the container, so the options are read off the document.
 */
async function openReservePicker(fullLabel: string, position: number): Promise<string[]> {
  const trigger = slotRow(fullLabel, position).querySelector<HTMLElement>(
    'button[role="combobox"]'
  );
  if (!trigger) throw new Error(`no reserve picker in slot ${position}`);
  await act(async () => {
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle(3);
  return [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].map((element) =>
    (element.textContent ?? "").trim()
  );
}

async function pickReserveOption(label: string) {
  const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (element) => (element.textContent ?? "").trim() === label
  );
  if (!option) throw new Error(`no reserve option ${JSON.stringify(label)}`);
  await act(async () => {
    option.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle(3);
}

/** The single payload of the one save this test performed. */
function savedPayload(): Record<string, unknown> {
  expect(upsertVetoConfig).toHaveBeenCalledTimes(1);
  const [, payload] = upsertVetoConfig.mock.calls[0] as [number, Record<string, unknown>];
  return payload;
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  // A fresh array every call: this is exactly the identity change that used to
  // re-run the seeding `useMemo` and wipe the form.
  getAll.mockImplementation(async () => ({
    page: 1,
    per_page: -1,
    total: catalogue().length,
    results: catalogue()
  }));
  listVetoConfigs.mockResolvedValue({ configs: [TOURNAMENT_DEFAULT] });
});

const GROUPS_R1 = levelRound("Groups", 1);
const GROUPS_STAGE = levelStage("Groups");
const WHOLE_STAGE = en.mapVetoAdmin.stageDefaultButton;

describe("TournamentMapVetoTab arrival", () => {
  it("shows no level at all until the configs and the map catalogue have arrived", async () => {
    // A read that never settles: take the promise and never resolve it. No level
    // may claim to be configured, or unconfigured, before it knows.
    const pending = Promise.withResolvers<never>();
    listVetoConfigs.mockReturnValue(pending.promise);
    await mount();
    await settle(5);

    expect(levelRows()).toEqual([]);
    expect(text()).not.toContain(en.mapVetoAdmin.save);
  });

  it("puts every level's maps on screen without a single click", async () => {
    listVetoConfigs.mockResolvedValue({
      configs: [TOURNAMENT_DEFAULT, SLOT_CONFIG, FLAT_CONFIG_ROUND_3]
    });
    await mount();
    await settle();

    // Eleven levels: the tournament default, and both stages' default plus
    // rounds. All expanded, all showing their maps.
    expect(levelRows()).toHaveLength(1 + (1 + 5) + (1 + 3));
    expect(poolMaps(LEVEL_TOURNAMENT)).toEqual(TOURNAMENT_DEFAULT_POOL);
    expect(slotMaps(GROUPS_R1, 1)).toEqual([
      "Circuit Royal",
      "Antarctic Peninsula",
      "Blizzard World"
    ]);
    expect(poolMaps(levelRound("Groups", 3))).toEqual(["Ilios", "Midtown", "Havana"]);
  });

  it("collapses a whole stage, and one level, without touching the others", async () => {
    await mount();
    await settle();

    const groups = stageGroup("Groups");
    expect(editor(GROUPS_R1)).toBeTruthy();

    // One level.
    await click(levelTrigger(GROUPS_R1));
    expect(() => editor(GROUPS_R1)).toThrow();
    expect(editor(GROUPS_STAGE)).toBeTruthy();
    expect(editor(LEVEL_TOURNAMENT)).toBeTruthy();

    // The whole stage card.
    const stageTrigger = groups.querySelector<HTMLButtonElement>("h2 > button");
    await click(stageTrigger as HTMLButtonElement);
    expect(() => editor(GROUPS_STAGE)).toThrow();
    expect(levelRows(groups)).toEqual([]);
    // Playoffs and the tournament default are untouched.
    expect(editor(LEVEL_TOURNAMENT)).toBeTruthy();
    expect(editor(levelStage("Playoffs"))).toBeTruthy();
  });
});

describe("TournamentMapVetoTab map size", () => {
  it("switches every level between map art and name-only tokens, changing nothing else", async () => {
    await mount();
    await settle();

    const hasArt = () =>
      poolRow(LEVEL_TOURNAMENT).querySelector('[style*="background-image"]') !== null;

    // Art is the default: an organizer recognises a pool by its pictures.
    expect(hasArt()).toBe(true);
    const before = poolMaps(LEVEL_TOURNAMENT);

    const toggle = (label: string) =>
      [...container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find(
        (element) => (element.textContent ?? "").trim() === label
      ) as HTMLButtonElement;

    await click(toggle(en.mapVetoAdmin.densityCompact));
    expect(hasArt()).toBe(false);
    // Same maps, same order, same remove control: only the size changed.
    expect(poolMaps(LEVEL_TOURNAMENT)).toEqual(before);
    expect(toggle(en.mapVetoAdmin.densityCompact).getAttribute("aria-pressed")).toBe("true");
    expect(toggle(en.mapVetoAdmin.densityNormal).getAttribute("aria-pressed")).toBe("false");

    await click(toggle(en.mapVetoAdmin.densityNormal));
    expect(hasArt()).toBe(true);
    expect(poolMaps(LEVEL_TOURNAMENT)).toEqual(before);
  });
});

describe("TournamentMapVetoTab form seeding", () => {
  it("seeds the pool from the existing config, not from the all-maps default", async () => {
    await mount();
    await settle();

    expect(editorText(LEVEL_TOURNAMENT)).toContain(en.mapVetoAdmin.save);
    // The config selects 5 of 12 maps; seeding from the default would select 12.
    // Tokens read in the stored pool order, which is not catalogue order.
    expect(poolMaps(LEVEL_TOURNAMENT)).toEqual(TOURNAMENT_DEFAULT_POOL);
  });

  it("keeps an in-progress edit when the map catalogue changes underneath it", async () => {
    await mount();
    await settle();

    expect(poolMaps(LEVEL_TOURNAMENT)).toContain("Busan");
    await removeFromPool(LEVEL_TOURNAMENT, "Busan");
    expect(poolMaps(LEVEL_TOURNAMENT)).not.toContain("Busan");

    // A refetch that returns genuinely different content, so React Query's
    // structural sharing cannot preserve the old `data` reference and the
    // derived `maps` array really does change identity. That identity change is
    // what the pre-fix seeding keyed on: it re-ran and restored "Busan",
    // silently reverting the organizer's edit.
    getAll.mockImplementation(async () => {
      const results = catalogue();
      results.push({
        // Past the catalogue's 1..12, so the new map is genuinely new.
        id: 13,
        gamemode_id: GAMEMODES.Control,
        name: "Samoa",
        image_path: "https://example.test/Samoa.jpg",
        in_competitive: true,
        gamemode: {
          id: GAMEMODES.Control,
          slug: "control",
          name: "Control",
          image_path: "",
          description: ""
        }
      } as MapRead);
      return { page: 1, per_page: -1, total: results.length, results };
    });

    await act(async () => {
      await client.invalidateQueries({ queryKey: ["maps", "all", "gamemode"] });
    });
    await settle();

    expect(getAll.mock.calls.length).toBeGreaterThan(1);
    // The edit stands, and the new map is not auto-selected into the pool.
    expect(poolMaps(LEVEL_TOURNAMENT)).toEqual(
      TOURNAMENT_DEFAULT_POOL.filter((name) => name !== "Busan")
    );

    // ...while the new map is offered.
    await withPicker(() => poolRow(LEVEL_TOURNAMENT), POOL_PICKER, async () => {
      expect(pickerMaps(POOL_PICKER)).toContain("Samoa");
    });
  });

  it("seeds each level from its own config, never from a neighbour's", async () => {
    listVetoConfigs.mockResolvedValue({
      configs: [
        TOURNAMENT_DEFAULT,
        {
          ...TOURNAMENT_DEFAULT,
          id: 901,
          stage_id: 189,
          round: null,
          preset: "bo1",
          sequence: ["ban_first", "ban_second", "decider"],
          map_ids: [3, 6, 9]
        }
      ]
    });
    await mount();
    await settle();

    // Side by side, with no navigation between them.
    expect(poolMaps(LEVEL_TOURNAMENT)).toEqual(TOURNAMENT_DEFAULT_POOL);
    expect(poolMaps(levelStage("Playoffs"))).toEqual(["Ilios", "Midtown", "Havana"]);
    // Stage 188 has no config of its own, so it shows what it inherits — the
    // tournament default — rather than the whole catalogue standing in for a
    // pool this level does not have.
    expect(poolMaps(GROUPS_STAGE)).toEqual(TOURNAMENT_DEFAULT_POOL);
    expect(editorText(GROUPS_STAGE)).toContain(en.mapVetoAdmin.forkLevel);
  });

  it("offers nothing to edit on an inherited level until it is given its own pool", async () => {
    upsertVetoConfig.mockResolvedValue({});
    await mount();
    await settle();

    const row = poolRow(GROUPS_STAGE);
    // Read-only means the controls are gone, not disabled: a greyed-out remove
    // still says "you could take this map out here", which is the opposite of
    // what an inherited pool means.
    expect(row.querySelectorAll("button")).toHaveLength(0);
    expect(editorText(GROUPS_STAGE)).toContain(en.mapVeto.scope.tournamentDefault);
    expect(() => saveButton(GROUPS_STAGE)).toThrow();
    expect(() => editorButton(GROUPS_STAGE, en.mapVetoAdmin.advancedTitle)).toThrow();

    await fork(GROUPS_STAGE);

    // The fork copies the inherited pool rather than the catalogue, so the level
    // starts from what its matches play today.
    expect(poolMaps(GROUPS_STAGE)).toEqual(TOURNAMENT_DEFAULT_POOL);
    expect(saveButton(GROUPS_STAGE).disabled).toBe(false);
    // A level that owns no config has pending work the moment it is forked:
    // saving creates a config where there was none.
    expect(levelTrigger(GROUPS_STAGE).textContent).toContain(en.mapVetoAdmin.unsaved);

    // And discarding puts it back to inheriting.
    await click(editorButton(GROUPS_STAGE, en.mapVetoAdmin.reset));
    expect(poolRow(GROUPS_STAGE).querySelectorAll("button")).toHaveLength(0);
    expect(editorText(GROUPS_STAGE)).toContain(en.mapVetoAdmin.forkLevel);

    // The tournament default has nothing above it, so it stays editable.
    expect(saveButton(LEVEL_TOURNAMENT).disabled).toBe(false);
  });

  it("keeps a level's edit across a collapse, and marks it unsaved until it is saved", async () => {
    // The whole reason the draft lives in the tab: collapsing a level unmounts
    // its editor, and an editor that owned its own state would lose the work.
    await mount();
    await settle();

    await addToPool(LEVEL_TOURNAMENT, ["Ilios"]);
    expect(poolMaps(LEVEL_TOURNAMENT)).toEqual([...TOURNAMENT_DEFAULT_POOL, "Ilios"]);
    expect(levelTrigger(LEVEL_TOURNAMENT).textContent).toContain(en.mapVetoAdmin.unsaved);

    await click(levelTrigger(LEVEL_TOURNAMENT));
    await click(levelTrigger(LEVEL_TOURNAMENT));

    expect(poolMaps(LEVEL_TOURNAMENT)).toEqual([...TOURNAMENT_DEFAULT_POOL, "Ilios"]);

    // And discarding puts the level back on its stored config.
    await click(editorButton(LEVEL_TOURNAMENT, en.mapVetoAdmin.reset));
    expect(poolMaps(LEVEL_TOURNAMENT)).toEqual(TOURNAMENT_DEFAULT_POOL);
    expect(levelTrigger(LEVEL_TOURNAMENT).textContent).not.toContain(en.mapVetoAdmin.unsaved);
  });
});

describe("TournamentMapVetoTab series length comes from the bracket", () => {
  it("never offers a control that claims to set the series format", async () => {
    await mount();
    await settle();
    await openAdvanced(LEVEL_TOURNAMENT);

    // The old editor shipped Bo1/Bo2/Bo3/Bo5 buttons whose choice the veto
    // session now overrides, so the format must be stated, not chosen. Asserted
    // on the controls rather than on prose: every level carries a Bo label as a
    // read-only badge, so page text cannot tell the two apart.
    expect(editorText(LEVEL_TOURNAMENT)).toContain(en.mapVetoAdmin.formatSourceBracket);

    const presetLabels = new Set(Object.values(en.mapVeto.preset));
    const formatButtons = [...container.querySelectorAll("button")].filter((element) =>
      presetLabels.has((element.textContent ?? "").trim())
    );
    expect(formatButtons).toEqual([]);
  });

  it("opens a legacy bo* config in bracket mode, not custom", async () => {
    await mount();
    await settle();
    await openAdvanced(LEVEL_TOURNAMENT);

    // TOURNAMENT_DEFAULT carries preset "bo3": a template label, not an opinion.
    expect(pressed(LEVEL_TOURNAMENT, en.mapVetoAdmin.orderModeBracket)).toBe("true");
    expect(pressed(LEVEL_TOURNAMENT, en.mapVetoAdmin.orderModeCustom)).toBe("false");
  });

  it("opens an explicitly custom config with its authored order already in view", async () => {
    listVetoConfigs.mockResolvedValue({
      configs: [{ ...TOURNAMENT_DEFAULT, preset: "custom" }]
    });
    await mount();
    await settle();

    // No click on "Advanced": a hand-authored order is the one setting an
    // organizer must not have to go looking for.
    expect(pressed(LEVEL_TOURNAMENT, en.mapVetoAdmin.orderModeCustom)).toBe("true");
  });

  it("saves preset bracket with a sequence matching the stage's best-of", async () => {
    upsertVetoConfig.mockResolvedValue({});
    // Stage 188 (Groups) runs Bo2 while the stored template is Bo3.
    listVetoConfigs.mockResolvedValue({
      configs: [{ ...TOURNAMENT_DEFAULT, id: 901, stage_id: 188, round: null }]
    });
    await mount();
    await settle();

    await click(saveButton(GROUPS_STAGE));

    const payload = savedPayload();
    expect(payload.preset).toBe("bracket");
    // Bo2: two opening bans then a pick each, and no decider.
    expect(payload.sequence).toEqual(["ban_first", "ban_second", "pick_first", "pick_second"]);
    expect(payload.stage_id).toBe(188);
    expect(payload.round).toBe(null);
  });

  it("warns without blocking when a custom order disagrees with the bracket", async () => {
    // Three played maps authored against a Bo2 stage.
    listVetoConfigs.mockResolvedValue({
      configs: [
        {
          ...TOURNAMENT_DEFAULT,
          id: 902,
          stage_id: 188,
          round: null,
          preset: "custom",
          sequence: ["ban_first", "pick_second", "pick_first", "decider"]
        }
      ]
    });
    await mount();
    await settle();

    // The warning is not behind "Advanced": it is about the config as it stands.
    expect(editorText(GROUPS_STAGE)).toContain(en.mapVetoAdmin.mismatchTitle);
    // A custom order deliberately wins, so saving stays available.
    expect(saveButton(GROUPS_STAGE).disabled).toBe(false);
  });
});

/**
 * ICU-rendered fragments. The raw message keys carry plural syntax that never
 * reaches the DOM, so these are the formatted forms for the counts each test
 * sets up — pinning the numbers, not just the prose.
 */
const STAGE_SCOPE_WARNING_FIVE = "These slots apply to all 5 rounds of this stage";
const SLOT_COUNT_MISMATCH_THREE_TWO =
  "This level has 3 slots configured while the bracket now calls for 2 maps";

/** The message naming one underfilled slot, as the validation list renders it. */
function tooFewCandidates(slot: number): string {
  return en.mapVetoAdmin.validation.slotTooFewCandidates.replace("{slot}", String(slot));
}

/** Enter slot mode on round 1 of Groups: gate open, two rows, nothing stored. */
async function openEmptySlotEditor() {
  await mount();
  await settle();
  await fork(GROUPS_R1);
  await openAdvanced(GROUPS_R1);
  await click(toggleByText(GROUPS_R1, en.mapVetoAdmin.poolShapeSlots));
}

describe("TournamentMapVetoTab pool shape", () => {
  it("opens a flat config in pool shape, offering the step-order group", async () => {
    await mount();
    await settle();
    await openAdvanced(LEVEL_TOURNAMENT);

    expect(pressed(LEVEL_TOURNAMENT, en.mapVetoAdmin.poolShapeFlat)).toBe("true");
    expect(pressed(LEVEL_TOURNAMENT, en.mapVetoAdmin.poolShapeSlots)).toBe("false");
    // The flat shape has a pool row and a step order; the slot rules belong to
    // the other shape and must not be described here.
    expect(poolRow(LEVEL_TOURNAMENT)).toBeTruthy();
    expect(() => slotRow(LEVEL_TOURNAMENT, 1)).toThrow();
    expect(editorText(LEVEL_TOURNAMENT)).not.toContain(en.mapVetoAdmin.slotsDescription);
    expect(editorText(LEVEL_TOURNAMENT)).toContain(en.mapVetoAdmin.orderModeTitle);
  });

  it("opens a slot-mode config in slot shape, hiding the flat pool and the step order", async () => {
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();
    await openAdvanced(GROUPS_R1);

    expect(pressed(GROUPS_R1, en.mapVetoAdmin.poolShapeSlots)).toBe("true");
    expect(pressed(GROUPS_R1, en.mapVetoAdmin.poolShapeFlat)).toBe("false");
    expect(editorText(GROUPS_R1)).toContain(en.mapVetoAdmin.slotsDescription);
    // A flat pool row here would collect selections the slot-mode payload
    // discards, and a step-order choice cannot coexist with slots at all.
    // Structural, not textual: "Map pool" is a prefix of "Map pool shape",
    // which the shape control renders in both shapes.
    expect(() => poolRow(GROUPS_R1)).toThrow();
    expect(editorText(GROUPS_R1)).not.toContain(en.mapVetoAdmin.orderModeTitle);
  });

  it("preserves the slot draft across a pool-shape toggle", async () => {
    upsertVetoConfig.mockResolvedValue({});
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();
    await openAdvanced(GROUPS_R1);

    // Slot 1's candidates are ids 7, 1, 4 in play order.
    expect(slotMaps(GROUPS_R1, 1)).toEqual([
      "Circuit Royal",
      "Antarctic Peninsula",
      "Blizzard World"
    ]);

    await click(toggleByText(GROUPS_R1, en.mapVetoAdmin.poolShapeFlat));
    expect(pressed(GROUPS_R1, en.mapVetoAdmin.poolShapeFlat)).toBe("true");

    await click(toggleByText(GROUPS_R1, en.mapVetoAdmin.poolShapeSlots));
    expect(pressed(GROUPS_R1, en.mapVetoAdmin.poolShapeSlots)).toBe("true");
    expect(slotMaps(GROUPS_R1, 1)).toEqual([
      "Circuit Royal",
      "Antarctic Peninsula",
      "Blizzard World"
    ]);

    await click(saveButton(GROUPS_R1));
    expect(savedPayload().slots).toEqual(SLOT_DRAFT);
  });

  it("preserves the flat pool selection across a pool-shape toggle", async () => {
    await mount();
    await settle();
    // Round 1 of Groups has no config of its own, so it starts from the pool it
    // inherits — and the slot gate opens there, which the tournament default's
    // does not.
    await fork(GROUPS_R1);
    await openAdvanced(GROUPS_R1);

    expect(poolMaps(GROUPS_R1)).toEqual(TOURNAMENT_DEFAULT_POOL);
    await removeFromPool(GROUPS_R1, "Busan");

    await click(toggleByText(GROUPS_R1, en.mapVetoAdmin.poolShapeSlots));
    await click(toggleByText(GROUPS_R1, en.mapVetoAdmin.poolShapeFlat));

    expect(poolMaps(GROUPS_R1)).toEqual(TOURNAMENT_DEFAULT_POOL.filter((name) => name !== "Busan"));
  });

  it("opens a slot config's flat row on the pool a new level starts from", async () => {
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();
    await openAdvanced(GROUPS_R1);

    await click(toggleByText(GROUPS_R1, en.mapVetoAdmin.poolShapeFlat));

    // A slot config reports `map_ids: []` — the upsert refuses any other value
    // and nothing mirrors slot candidates into the flat pool. Seeding the flat
    // row from it left every token off and Save refused, so one mis-click on the
    // flat shape stranded the organizer; an unconfigured round, meanwhile, seeds
    // the whole catalogue. Same emptiness on the wire, so the two must start
    // from the same place.
    expect(poolMaps(GROUPS_R1)).toEqual(CATALOGUE_ORDER);
    expect(editorText(GROUPS_R1)).not.toContain(en.mapVetoAdmin.validation.emptyPool);
    expect(editorText(GROUPS_R1)).not.toContain(en.mapVetoAdmin.validation.emptySequence);
    expect(saveButton(GROUPS_R1).disabled).toBe(false);
  });

  it("seeds a slot config's custom sequence for the pool that row will work with", async () => {
    upsertVetoConfig.mockResolvedValue({});
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();
    await openAdvanced(GROUPS_R1);

    await click(toggleByText(GROUPS_R1, en.mapVetoAdmin.poolShapeFlat));
    await click(toggleByText(GROUPS_R1, en.mapVetoAdmin.orderModeCustom));

    // Sized from `config.map_ids.length` this was `buildSequenceForBestOf(2, 0)`
    // — an empty step list with nothing to reorder and nothing to save. The
    // fallback has to use the pool the form actually seeded.
    expect(editorText(GROUPS_R1)).not.toContain(en.mapVetoAdmin.sequenceEmpty);

    await click(saveButton(GROUPS_R1));
    const payload = savedPayload();
    // Bo2 over a twelve-map pool: the two opening bans, then a pick each.
    expect(payload.sequence).toEqual(["ban_first", "ban_second", "pick_first", "pick_second"]);
    // Hand-authored steps in flat shape: the save must name them as such, or the
    // server regenerates them from the bracket and the sequence above is a lie.
    expect(payload.preset).toBe("custom");
  });

  it("saves a slot config as slots, with the flat fields empty and the rotation kept", async () => {
    upsertVetoConfig.mockResolvedValue({});
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();

    await click(saveButton(GROUPS_R1));

    const payload = savedPayload();
    expect(payload.mode).toBe("slots");
    // A slot config already arrives with both flat fields empty, so this pins
    // the wire shape rather than the emptying — the two switch-shape-then-save
    // tests below are where that is load-bearing. The slot order is the play
    // order the server derives positions 1..N from.
    expect(payload.map_ids).toEqual([]);
    expect(payload.sequence).toEqual([]);
    expect(payload.slots).toEqual(SLOT_DRAFT);
    // Omitted, the server silently rewrites this config back to "fixed".
    expect(payload.first_ban_rotation).toBe("alternate");
    // `slots` + `custom` is refused by a CHECK constraint.
    expect(payload.preset).not.toBe("custom");
  });

  it("saves a flat config as pool, with the slot list empty and the rotation kept", async () => {
    upsertVetoConfig.mockResolvedValue({});
    await mount();
    await settle();

    await click(saveButton(LEVEL_TOURNAMENT));

    const payload = savedPayload();
    expect(payload.mode).toBe("pool");
    expect(payload.map_ids).toEqual(TOURNAMENT_DEFAULT.map_ids);
    // A non-empty slot list is a 422 in pool mode.
    expect(payload.slots).toEqual([]);
    // The server assigns this column on every upsert, whichever mode won.
    expect(payload.first_ban_rotation).toBe("fixed");
  });

  it("empties the flat fields when a flat config is switched to slot shape", async () => {
    upsertVetoConfig.mockResolvedValue({});
    await mount();
    await settle();
    await fork(GROUPS_R1);
    await openAdvanced(GROUPS_R1);
    // Forking copies the inherited pool, so the flat fields hold real content
    // the shape switch has to drop.
    expect(poolMaps(GROUPS_R1)).toEqual(TOURNAMENT_DEFAULT_POOL);

    await click(toggleByText(GROUPS_R1, en.mapVetoAdmin.poolShapeSlots));
    await addToSlot(GROUPS_R1, 1, ["Busan", "Ilios"]);
    await addToSlot(GROUPS_R1, 2, ["Dorado", "Havana"]);
    await click(saveButton(GROUPS_R1));

    const payload = savedPayload();
    expect(payload.mode).toBe("slots");
    // Both are 422s in slot mode, and the pool selection is still in the draft.
    expect(payload.map_ids).toEqual([]);
    expect(payload.sequence).toEqual([]);
    expect(payload.slots).toEqual([
      { candidates: [2, 3], reserve_map_id: null },
      { candidates: [8, 9], reserve_map_id: null }
    ]);
  });

  it("empties the slot list when a slot config is switched to pool shape", async () => {
    upsertVetoConfig.mockResolvedValue({});
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();
    await openAdvanced(GROUPS_R1);

    await click(toggleByText(GROUPS_R1, en.mapVetoAdmin.poolShapeFlat));
    // The flat row seeds to the whole catalogue, so it is cleared and rebuilt by
    // hand: five picks, so the click order is visible in the payload.
    await withPicker(() => poolRow(GROUPS_R1), POOL_PICKER, async () => {
      await click(pickerButton(POOL_PICKER, en.mapVetoAdmin.poolClear));
      expect(poolMaps(GROUPS_R1)).toEqual([]);
      for (const name of ["Busan", "Dorado", "Havana", "Ilios", "Midtown"]) {
        await click(pickerTile(POOL_PICKER, name));
      }
    });

    await click(saveButton(GROUPS_R1));

    const payload = savedPayload();
    expect(payload.mode).toBe("pool");
    // Click order, not id order: the pool order is persisted.
    expect(payload.map_ids).toEqual([2, 8, 9, 3, 6]);
    // Round 1 of Groups is Bo2: two opening bans, a pick each, no decider.
    expect(payload.sequence).toEqual(["ban_first", "ban_second", "pick_first", "pick_second"]);
    // The slot draft survives the toggle, so it must be emptied on the wire
    // rather than merely absent: a non-empty list here is a 422.
    expect(payload.slots).toEqual([]);
  });
});

describe("TournamentMapVetoTab slot mode gate", () => {
  it("disables slot mode with its reason at the tournament default", async () => {
    await mount();
    await settle();
    await openAdvanced(LEVEL_TOURNAMENT);

    // `{ scope: "tournament" }` carries a concrete DEFAULT_BEST_OF, so a gate
    // asking "is bestOf a number" would open slot mode exactly where the series
    // length is unknowable.
    expect(toggleByText(LEVEL_TOURNAMENT, en.mapVetoAdmin.poolShapeSlots).disabled).toBe(true);
    expect(editorText(LEVEL_TOURNAMENT)).toContain(
      en.mapVetoAdmin.poolShapeSlotsUnavailableTournament
    );
    // Disabled with its reason, never absent: silent absence reads as "the
    // feature does not exist".
    expect(toggleByText(LEVEL_TOURNAMENT, en.mapVetoAdmin.poolShapeFlat).disabled).toBe(false);

    await click(toggleByText(LEVEL_TOURNAMENT, en.mapVetoAdmin.poolShapeSlots));
    expect(pressed(LEVEL_TOURNAMENT, en.mapVetoAdmin.poolShapeFlat)).toBe("true");
    expect(editorText(LEVEL_TOURNAMENT)).not.toContain(en.mapVetoAdmin.slotsDescription);
  });

  it("disables slot mode with its reason at a stage whose rounds play different lengths", async () => {
    await mount();
    await settle();
    // Playoffs overrides its final round, so the stage has no single best-of.
    const playoffs = levelStage("Playoffs");
    await fork(playoffs);
    await openAdvanced(playoffs);

    expect(toggleByText(playoffs, en.mapVetoAdmin.poolShapeSlots).disabled).toBe(true);
    // Distinct copy per cause: "choose a single round" is actionable here, and
    // the tournament-level reason would send the organizer somewhere useless.
    expect(editorText(playoffs)).toContain(en.mapVetoAdmin.poolShapeSlotsUnavailableStage);
    expect(editorText(playoffs)).not.toContain(
      en.mapVetoAdmin.poolShapeSlotsUnavailableTournament
    );
  });

  it("opens slot mode at a stage whose rounds all play the same length, warning that one config covers them all", async () => {
    await mount();
    await settle();
    // Groups is Bo2 throughout, so the gate passes — and that is the trap the
    // warning exists for: one shared config for five rounds that each want one.
    await fork(GROUPS_STAGE);
    await openAdvanced(GROUPS_STAGE);

    expect(toggleByText(GROUPS_STAGE, en.mapVetoAdmin.poolShapeSlots).disabled).toBe(false);
    expect(editorText(GROUPS_STAGE)).not.toContain(
      en.mapVetoAdmin.poolShapeSlotsUnavailableStage
    );

    await click(toggleByText(GROUPS_STAGE, en.mapVetoAdmin.poolShapeSlots));
    expect(pressed(GROUPS_STAGE, en.mapVetoAdmin.poolShapeSlots)).toBe("true");
    expect(editorText(GROUPS_STAGE)).toContain(STAGE_SCOPE_WARNING_FIVE);
    // A warning, not a block: the slot rows are still there to fill.
    await withPicker(() => slotRow(GROUPS_STAGE, 1), slotPicker(1), async () => {
      expect(pickerMaps(slotPicker(1))).toHaveLength(catalogue().length);
    });
  });

  it("opens slot mode at a single round, with one row per map and no stage-scope warning", async () => {
    await openEmptySlotEditor();

    expect(pressed(GROUPS_R1, en.mapVetoAdmin.poolShapeSlots)).toBe("true");
    expect(editorText(GROUPS_R1)).not.toContain(STAGE_SCOPE_WARNING_FIVE);
    // Bo2, so exactly two rows, derived from the bracket — and no control that
    // adds a third, which is what makes the count self-evident without prose.
    expect(slotRow(GROUPS_R1, 2)).toBeTruthy();
    expect(() => slotRow(GROUPS_R1, 3)).toThrow();
  });
});

describe("TournamentMapVetoTab slot editor", () => {
  it("filters one slot's picker to a gamemode and takes exactly those maps", async () => {
    upsertVetoConfig.mockResolvedValue({});
    await openEmptySlotEditor();

    const first = slotPicker(1);
    await withPicker(() => slotRow(GROUPS_R1, 1), first, async () => {
      await click(pickerButton(first, "Control (3)"));
      expect(pickerMaps(first)).toEqual(["Antarctic Peninsula", "Busan", "Ilios"]);
      await click(pickerButton(first, en.mapVetoAdmin.poolSelectAll));
    });

    expect(slotMaps(GROUPS_R1, 1)).toEqual(["Antarctic Peninsula", "Busan", "Ilios"]);
    // The filter belongs to the picker, not to the level: slot 2 is untouched.
    expect(slotMaps(GROUPS_R1, 2)).toEqual([]);

    // Two Escort maps in slot 2, so the two rows end at different lengths and
    // neither count can stand in for the other.
    await addToSlot(GROUPS_R1, 2, ["Dorado", "Havana"]);
    await click(saveButton(GROUPS_R1));

    expect(savedPayload().slots).toEqual([
      { candidates: [1, 2, 3], reserve_map_id: null },
      { candidates: [8, 9], reserve_map_id: null }
    ]);
  });

  it("disables save and names the slot that has too few candidates", async () => {
    await openEmptySlotEditor();

    // Both rows start empty and both are named, so a check that reports only
    // the first failure cannot pass this.
    expect(editorText(GROUPS_R1)).toContain(tooFewCandidates(1));
    expect(editorText(GROUPS_R1)).toContain(tooFewCandidates(2));
    expect(saveButton(GROUPS_R1).disabled).toBe(true);

    await addToSlot(GROUPS_R1, 1, ["Busan", "Ilios"]);
    await addToSlot(GROUPS_R1, 2, ["Dorado"]);

    // Slot 1 is legal, slot 2 is one short: only slot 2 is named, so the message
    // cannot be a fixed string that happens to read correctly.
    expect(editorText(GROUPS_R1)).not.toContain(tooFewCandidates(1));
    expect(editorText(GROUPS_R1)).toContain(tooFewCandidates(2));
    expect(saveButton(GROUPS_R1).disabled).toBe(true);

    await addToSlot(GROUPS_R1, 2, ["Havana"]);
    expect(editorText(GROUPS_R1)).not.toContain(tooFewCandidates(2));
    expect(saveButton(GROUPS_R1).disabled).toBe(false);
  });

  it("finds each map the regulation spells differently from the catalogue", async () => {
    await openEmptySlotEditor();
    const label = slotPicker(1);

    await withPicker(() => slotRow(GROUPS_R1, 1), label, async () => {
      // Each query differs from the catalogue name on one axis of the normalized
      // comparison: a trailing suffix, case, a diacritic, and the apostrophe.
      for (const [query, expected] of [
        ["peninsular", "Antarctic Peninsula"],
        ["shambali", "Shambali Monastery"],
        ["Paraiso", "Paraíso"],
        ["King's Row", "King’s Row"]
      ] as const) {
        await type(pickerSearch(label), query);
        expect(pickerMaps(label)).toEqual([expected]);
      }

      await type(pickerSearch(label), "zzz");
      expect(pickerMaps(label)).toEqual([]);
      expect(picker(label).textContent ?? "").toContain(
        en.mapVetoAdmin.pickerSearchEmpty.replace("{query}", "zzz")
      );
    });
  });

  it("shows each slot's gamemode composition", async () => {
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();

    // Slot 1 is one map from each of three modes — the cross-mode mistake the
    // badges exist to make visible without counting tokens.
    const rowOne = slotRow(GROUPS_R1, 1).textContent ?? "";
    expect(rowOne).toContain("Control (1)");
    expect(rowOne).toContain("Escort (1)");
    expect(rowOne).toContain("Hybrid (1)");

    // Slot 2 holds Eichenwalde and Ilios: no Escort candidate at all.
    const rowTwo = slotRow(GROUPS_R1, 2).textContent ?? "";
    expect(rowTwo).toContain("Control (1)");
    expect(rowTwo).toContain("Hybrid (1)");
    expect(rowTwo).not.toContain("Escort (1)");
  });

  it("never offers a slot's own candidates as its reserve", async () => {
    upsertVetoConfig.mockResolvedValue({});
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();

    const options = await openReservePicker(GROUPS_R1, 1);
    expect(options).toContain(en.mapVetoAdmin.slotReserveNone);
    // Slot 1's own candidates: a reserve there is either banned and then
    // replayed, or is the survivor that drew.
    expect(options).not.toContain("Circuit Royal");
    expect(options).not.toContain("Antarctic Peninsula");
    expect(options).not.toContain("Blizzard World");
    // Slot 2's candidates are fair game: a map may repeat across slots.
    expect(options).toContain("Eichenwalde");
    expect(options).toContain("Havana");

    await pickReserveOption("Havana");
    await click(saveButton(GROUPS_R1));
    expect(savedPayload().slots).toEqual([
      { candidates: [7, 1, 4], reserve_map_id: 9 },
      { candidates: [5, 3], reserve_map_id: 9 }
    ]);
  });

  it("drops a reserve promoted into its own slot's candidates", async () => {
    upsertVetoConfig.mockResolvedValue({});
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();

    // Slot 2 reserves Havana (id 9). Adding Havana there makes the replay map
    // the very map that drew, which the upsert refuses.
    await addToSlot(GROUPS_R1, 2, ["Havana"]);
    await click(saveButton(GROUPS_R1));

    // Slot 1's reserve was already null, so only slot 2 changes.
    expect(savedPayload().slots).toEqual([
      { candidates: [7, 1, 4], reserve_map_id: null },
      { candidates: [5, 3, 9], reserve_map_id: null }
    ]);
  });

  it("never saves preset custom alongside slot mode", async () => {
    upsertVetoConfig.mockResolvedValue({});
    listVetoConfigs.mockResolvedValue({
      configs: [
        {
          ...TOURNAMENT_DEFAULT,
          id: 903,
          stage_id: 188,
          round: 1,
          preset: "custom",
          sequence: ["ban_first", "pick_second", "pick_first", "decider"]
        }
      ]
    });
    await mount();
    await settle();

    // The stored config really is custom, so the guard below is reached. Without
    // this the assertion would hold for the wrong reason: a bracket-preset
    // fixture never gets there at all.
    expect(pressed(GROUPS_R1, en.mapVetoAdmin.orderModeCustom)).toBe("true");

    await click(toggleByText(GROUPS_R1, en.mapVetoAdmin.poolShapeSlots));
    await addToSlot(GROUPS_R1, 1, ["Busan", "Ilios"]);
    await addToSlot(GROUPS_R1, 2, ["Dorado", "Havana"]);
    await click(saveButton(GROUPS_R1));

    const payload = savedPayload();
    expect(payload.mode).toBe("slots");
    // `ck_map_veto_config_slots_not_custom` refuses the pair, and the 422 names
    // neither field — so the editor must never send it.
    expect(payload.preset).toBe("bracket");
  });

  it("warns when the stored slot count no longer matches what the bracket plays", async () => {
    listVetoConfigs.mockResolvedValue({
      configs: [
        {
          ...SLOT_CONFIG,
          slots: [
            { position: 1, candidates: [1, 2], reserve_map_id: null },
            { position: 2, candidates: [4, 5], reserve_map_id: null },
            { position: 3, candidates: [7, 8], reserve_map_id: null }
          ]
        }
      ]
    });
    await mount();
    await settle();

    // Three stored slots against a Bo2 round: both numbers named, and the third
    // slot has no row because the bracket does not play it.
    expect(editorText(GROUPS_R1)).toContain(SLOT_COUNT_MISMATCH_THREE_TWO);
    expect(() => slotRow(GROUPS_R1, 3)).toThrow();
  });

  it("chooses who bans first, and keeps the choice on the wire", async () => {
    upsertVetoConfig.mockResolvedValue({});
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();
    await openAdvanced(GROUPS_R1);

    // The fixture stores "alternate", so the control opens on it.
    expect(pressed(GROUPS_R1, en.mapVetoAdmin.firstBanAlternate)).toBe("true");
    expect(pressed(GROUPS_R1, en.mapVetoAdmin.firstBanFixed)).toBe("false");

    await click(toggleByText(GROUPS_R1, en.mapVetoAdmin.firstBanFixed));
    await click(saveButton(GROUPS_R1));
    expect(savedPayload().first_ban_rotation).toBe("fixed");
  });
});

/*
 * Round list — Decision 13.
 *
 * The list used to build `1..max_rounds`, so a lower-bracket round had no row
 * at all: four of the regulation's twelve levels could not be reached, and each
 * silently inherited a stage- or tournament-level config authored for a
 * different series. Round numbers now come from the encounters that exist,
 * grouped upper (positive) / lower (negative), plus — only where `max_rounds`
 * governs the round count — the rounds it promises, marked as not generated.
 */

/** Only the fields the list reads; a real `Encounter` satisfies it. */
function enc(stageId: number | null, round: number, bestOf = 3): StageRoundSource {
  return { stage_id: stageId, round, best_of: bestOf };
}

/**
 * A double-elimination stage, where `max_rounds` governs nothing: the round
 * count follows from the team count, and 4 here is just a stored number. Its
 * encounters disagree with it in every direction at once, so no arithmetic on
 * it reproduces the answer:
 *  - round 5 exists, past `max_rounds`, so `1..max_rounds` loses a real round;
 *  - round 3 is inside `max_rounds` and has no encounter, and it sits in the
 *    middle rather than at the end, so "the tail is planned" is wrong too;
 *  - the lower rounds are -1, -2, -4: gapped, so mirroring `1..n` invents -3,
 *    and three of them against four upper rounds, so neither count stands in
 *    for the other;
 *  - rounds repeat across encounters, so a list that is not deduplicated
 *    renders the same row twice.
 *
 * `final: 7` is played by nothing. Round 4 is the last round `max_rounds`
 * names, which is where that override used to land — so a Bo7 anywhere on
 * screen is the stage config answering a question only the bracket can.
 */
const DE_STAGE: Stage = {
  ...stage(190, "DE Bracket", 2, 4, { default: 3, final: 7 }),
  stage_type: "double_elimination"
} as Stage;

const DE_STAGES = [...STAGES, DE_STAGE];

const DE_ENCOUNTERS: StageRoundSource[] = [
  enc(190, 4),
  enc(190, 1),
  enc(190, -2),
  enc(190, 1),
  // The real grand final. Bo5 appears nowhere in the stage's config, so the
  // only way this number reaches the screen is the encounter itself.
  enc(190, 5, 5),
  enc(190, -4),
  enc(190, 2),
  enc(190, -1),
  enc(190, -2),
  // Neither of these belongs to stage 190: round 7 and lower round 9 are
  // stage 188's, so they must land on Groups and never on the DE bracket, and
  // the stage-less encounter must reach no stage's list at all.
  enc(188, 7),
  enc(188, -9),
  enc(null, 6)
];

const UPPER = en.mapVetoAdmin.roundGroupUpper;
const LOWER = en.mapVetoAdmin.roundGroupLower;

function bracketGroup(stageName: string, label: string): HTMLElement {
  const match = stageGroup(stageName).querySelector<HTMLElement>(
    `[role="group"][aria-label="${label}"]`
  );
  if (!match) throw new Error(`no ${label} group in ${stageName}`);
  return match;
}

function roundNames(scope: ParentNode): string[] {
  return levelRows(scope)
    .map(rowLabel)
    .filter((label) => label !== WHOLE_STAGE);
}

/** Round labels inside one scope whose row carries the not-generated marker. */
function notGeneratedNames(scope: ParentNode): string[] {
  return levelRows(scope)
    .filter((trigger) => (trigger.textContent ?? "").includes(en.mapVetoAdmin.roundNotGenerated))
    .map(rowLabel);
}

describe("TournamentMapVetoTab round list", () => {
  it("takes an elimination stage's rounds from the encounters alone", async () => {
    await mount({ stages: DE_STAGES, encounters: DE_ENCOUNTERS });
    await settle();

    // Exactly the positive rounds that exist, deduplicated and in ascending
    // order: gapped at 3, past `max_rounds` at 5, and nothing invented at
    // either end. `max_rounds` counts a Swiss progression, so planning an
    // elimination bracket from it offered rounds the bracket never plays and
    // filed the grand final's length under the last of them.
    expect(roundNames(bracketGroup("DE Bracket", UPPER))).toEqual([
      "Round 1",
      "Round 2",
      "Round 4",
      "Round 5"
    ]);
    // Lower rounds come from encounters only — nothing on the client says how
    // many a double-elimination bracket will have — so the gap at -3 stands,
    // and they read in play order rather than in numeric order.
    expect(roundNames(bracketGroup("DE Bracket", LOWER))).toEqual([
      "Lower R1",
      "Lower R2",
      "Lower R4"
    ]);

    // Stage 188's own encounters put round 7 and lower round 9 on Groups, where
    // they belong; neither may reach the DE bracket, and the stage-less
    // encounter's round 6 may reach no stage at all.
    expect(roundNames(stageGroup("Groups"))).toContain("Round 7");
    expect(roundNames(stageGroup("Groups"))).toContain("Lower R9");
    expect(roundNames(bracketGroup("DE Bracket", UPPER))).not.toContain("Round 7");
    expect(roundNames(bracketGroup("DE Bracket", LOWER))).not.toContain("Lower R9");
    expect(text()).not.toContain("Round 6");

    // Nothing here is planned, so nothing can be promised-but-absent.
    expect(notGeneratedNames(bracketGroup("DE Bracket", UPPER))).toEqual([]);
    expect(notGeneratedNames(bracketGroup("DE Bracket", LOWER))).toEqual([]);
  });

  it("reads each round's series length from that round's own encounter", async () => {
    await mount({ stages: DE_STAGES, encounters: DE_ENCOUNTERS });
    await settle();

    // The grand final plays Bo5, a length the stage's config cannot produce for
    // any round — so this number came from the encounter and nowhere else. It
    // is also the slot count a slot-mode config on this round is built for.
    expect(levelTrigger(levelRound("DE Bracket", 5)).textContent).toContain(en.mapVeto.preset.bo5);

    // Round 4 is the last round `max_rounds` names, which is where the stage's
    // `final` override used to land. It plays Bo3, and no level may claim the
    // Bo7 that override configures for a final this bracket does not have
    // there.
    expect(levelTrigger(levelRound("DE Bracket", 4)).textContent).toContain(en.mapVeto.preset.bo3);
    expect(bracketGroup("DE Bracket", UPPER).textContent ?? "").not.toContain(
      en.mapVeto.preset.bo7
    );

    // Two lengths across the stage's rounds, so the whole-stage level can name
    // neither of them.
    expect(levelTrigger(levelStage("DE Bracket")).textContent).toContain(
      en.mapVeto.bracketFormatVaries
    );
  });

  it("round-trips a lower-bracket round through seeding and save", async () => {
    upsertVetoConfig.mockResolvedValue({});
    listVetoConfigs.mockResolvedValue({
      configs: [
        TOURNAMENT_DEFAULT,
        // The decoy: same stage, same magnitude, opposite sign, and a pool of a
        // different size. Any `Math.abs` on the way in or on the way out lands
        // here instead, and the assertions below name which one arrived.
        {
          ...TOURNAMENT_DEFAULT,
          id: 921,
          stage_id: 190,
          round: 2,
          preset: "bracket",
          map_ids: [3, 6, 9, 12]
        },
        {
          ...TOURNAMENT_DEFAULT,
          id: 920,
          stage_id: 190,
          round: -2,
          preset: "bracket",
          map_ids: [11, 2, 8]
        }
      ]
    });
    await mount({ stages: DE_STAGES, encounters: DE_ENCOUNTERS });
    await settle();

    const lower = levelRound("DE Bracket", -2);
    // Read back: the config on round -2, not the one on round 2.
    expect(poolMaps(lower)).toEqual(["Paraíso", "Busan", "Dorado"]);
    expect(poolMaps(levelRound("DE Bracket", 2))).toEqual([
      "Ilios",
      "Midtown",
      "Havana",
      "King’s Row"
    ]);

    await click(saveButton(lower));

    const payload = savedPayload();
    expect(payload.round).toBe(-2);
    expect(payload.stage_id).toBe(190);
  });

  it("keeps a stage with no lower bracket on its single ungrouped list", async () => {
    upsertVetoConfig.mockResolvedValue({});
    await mount({
      stages: STAGES,
      // Groups has generated three of its five rounds. Playoffs has a lower
      // round, so a list grouped by tournament rather than by stage would
      // sprout a Lower bracket heading here.
      encounters: [enc(188, 2), enc(188, 1), enc(188, 2), enc(188, 3), enc(189, -4), enc(189, 1)]
    });
    await settle();

    const groups = stageGroup("Groups");
    expect(roundNames(groups)).toEqual(["Round 1", "Round 2", "Round 3", "Round 4", "Round 5"]);
    expect(groups.textContent ?? "").not.toContain(UPPER);
    expect(groups.textContent ?? "").not.toContain(LOWER);
    expect(groups.textContent ?? "").not.toContain("Lower R");

    // The two rounds the bracket has not reached yet are marked, and only them.
    expect(notGeneratedNames(groups)).toEqual(["Round 4", "Round 5"]);

    // And the round still saves what it always did.
    await fork(levelRound("Groups", 2));
    await click(saveButton(levelRound("Groups", 2)));
    const payload = savedPayload();
    expect(payload.round).toBe(2);
    expect(payload.stage_id).toBe(188);
  });

  it("lets the organizer configure a planned round the bracket has not reached", async () => {
    upsertVetoConfig.mockResolvedValue({});
    // Groups is Swiss, the one shape whose round count `max_rounds` really
    // governs, so rounds 4 and 5 are a promise rather than an invention.
    await mount({ stages: STAGES, encounters: [enc(188, 1), enc(188, 2), enc(188, 3)] });
    await settle();

    // Marked, never disabled: a config cascades to encounters created later,
    // so authoring round 4's pool before round 4 exists is the intended order
    // of work, not a mistake to block.
    const planned = levelRound("Groups", 4);
    expect(levelTrigger(planned).textContent).toContain(en.mapVetoAdmin.roundNotGenerated);
    await fork(planned);
    expect(saveButton(planned).disabled).toBe(false);

    await click(saveButton(planned));
    const payload = savedPayload();
    expect(payload.round).toBe(4);
    expect(payload.stage_id).toBe(188);
  });

  it("claims nothing about generation before the encounters have arrived", async () => {
    // `encounters` undefined is the state during the read, not an empty stage.
    await mount({ stages: DE_STAGES });
    await settle();

    const de = stageGroup("DE Bracket");
    expect(roundNames(de)).toEqual(["Round 1", "Round 2", "Round 3", "Round 4"]);
    // Marking every round "not generated" here would be a claim the tab cannot
    // support, and hiding the lower bracket is what the arriving read fixes.
    expect(notGeneratedNames(de)).toEqual([]);
    expect(de.textContent ?? "").not.toContain("Lower R");
  });

  it("offers an ungenerated elimination stage its whole-stage level and no rounds", async () => {
    // The encounters are known and this stage has none. There is no honest round
    // list to draw: which rounds a bracket ends up with follows from its team
    // count, and the whole-stage level covers every one of them until it exists.
    await mount({ stages: DE_STAGES, encounters: [enc(188, 1)] });
    await settle();

    const de = stageGroup("DE Bracket");
    expect(roundNames(de)).toEqual([]);
    expect(levelTrigger(levelStage("DE Bracket")).textContent).toContain(WHOLE_STAGE);
  });
});

/*
 * Row summaries.
 *
 * The summary was written when a config had exactly one shape, so it read
 * `map_ids.length` unconditionally. A slot config reports `map_ids: []` by
 * design, so every fully configured slot round announced "0 maps in the pool" —
 * the one thing an organizer checking twelve transcribed levels would read as
 * "this one did not save".
 */

/** ICU-rendered summaries for the fixtures below, numbers included. */
const ROUND_FLAT_ZERO = "0 maps in the pool";
const ROUND_FLAT_THREE = "3 maps in the pool";
const ROUND_SLOTS_2_5 = "2 slots, 5 candidates";
const ROUND_SLOTS_2_4 = "2 slots, 4 candidates";

describe("TournamentMapVetoTab row summary", () => {
  beforeEach(() => {
    // Rounds 1 and 2 of Groups carry slot configs, round 3 a flat one, rounds 4
    // and 5 nothing — every summary a row can render, side by side.
    listVetoConfigs.mockResolvedValue({
      configs: [SLOT_CONFIG, SLOT_CONFIG_ROUND_2, FLAT_CONFIG_ROUND_3]
    });
  });

  it("states a slot round's slots and its candidate total, never a pool of zero", async () => {
    await mount();
    await settle();

    // Both numbers, because a round with two empty slots and a round with two
    // full ones must not read identically: the slot count alone is the same for
    // every Bo2 round whether or not anyone filled it in.
    const one = levelTrigger(GROUPS_R1).textContent ?? "";
    expect(one).toContain(ROUND_SLOTS_2_5);
    expect(one).not.toContain(ROUND_FLAT_ZERO);

    // Same slot count, a different candidate total: the second number is read
    // from this config, not copied from the first row or from the slot count.
    const two = levelTrigger(levelRound("Groups", 2)).textContent ?? "";
    expect(two).toContain(ROUND_SLOTS_2_4);
    expect(two).not.toContain(ROUND_FLAT_ZERO);
  });

  it("leaves a flat round's summary as the pool size, and an unconfigured round's alone", async () => {
    await mount();
    await settle();

    // Flat mode's copy is untouched, and the slot wording must not leak into it.
    const flat = levelTrigger(levelRound("Groups", 3)).textContent ?? "";
    expect(flat).toContain(ROUND_FLAT_THREE);
    expect(flat).not.toContain("slot");
    expect(flat).not.toContain("candidate");

    // No config at all is still a third thing, distinct from both summaries.
    const inherited = levelTrigger(levelRound("Groups", 4)).textContent ?? "";
    expect(inherited).toContain(en.mapVetoAdmin.roundUsesDefault);
    expect(inherited).not.toContain("slot");
    expect(inherited).not.toContain("in the pool");
  });

  it("says the tournament default has nothing to fall back on when it is unset", async () => {
    // Every other level inherits; this one is the root, so "uses the inherited
    // pool" would be a lie and an organizer would read it as configured.
    await mount();
    await settle();

    const row = levelTrigger(LEVEL_TOURNAMENT).textContent ?? "";
    expect(row).toContain(en.mapVetoAdmin.tournamentUnconfigured);
    expect(row).not.toContain(en.mapVetoAdmin.roundUsesDefault);
  });
});
