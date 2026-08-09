// @vitest-environment happy-dom
//
// The tab lists every cascade level at once — the tournament default, each
// stage, and each of that stage's rounds — as rows that expand into an editor.
// Two properties make that shape safe, and both are pinned here:
//
//   1. a level's draft lives in the tab, not in the editor, so collapsing a row
//      (which unmounts the editor) never discards work, and a map-catalogue
//      refetch never reverts an edit in progress;
//   2. a level with no draft re-derives its form from its stored config alone,
//      so a row can never present another level's pool as its own.
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
 * A level's row is an accordion header (`h3 > button`), so scope rows are
 * distinguishable from the two other expanding controls the editor renders —
 * the map picker and the advanced panel — which are plain buttons.
 */

function scopeRows(scope: ParentNode = container): HTMLButtonElement[] {
  return [...scope.querySelectorAll<HTMLButtonElement>("h3 > button[aria-expanded]")];
}

/** A row's own label: the first span inside the trigger's content wrapper. */
function rowLabel(trigger: HTMLElement): string {
  return (trigger.querySelector("span > span")?.textContent ?? "").trim();
}

function scopeRow(label: string, scope: ParentNode = container): HTMLButtonElement {
  const match = scopeRows(scope).find((trigger) => rowLabel(trigger) === label);
  if (!match) throw new Error(`no level row labelled ${JSON.stringify(label)}`);
  return match;
}

/** One stage's card, which is also the group its rounds live in. */
function stageGroup(name: string): HTMLElement {
  const match = container.querySelector<HTMLElement>(`[role="group"][aria-label="${name}"]`);
  if (!match) throw new Error(`no stage group for ${JSON.stringify(name)}`);
  return match;
}

async function openScope(label: string, scope: ParentNode = container) {
  const trigger = scopeRow(label, scope);
  if (trigger.getAttribute("aria-expanded") !== "true") await click(trigger);
}

/** The one expanded level's editor. Only one row is open at a time. */
function editor(): HTMLElement {
  const match = container.querySelector<HTMLElement>('[role="region"][data-state="open"]');
  if (!match) throw new Error("no level is expanded");
  return match;
}

function editorText(): string {
  return editor().textContent ?? "";
}

function editorButton(needle: string): HTMLButtonElement {
  const match = [...editor().querySelectorAll("button")].find((element) =>
    (element.textContent ?? "").includes(needle)
  );
  if (!match) throw new Error(`no editor button containing ${JSON.stringify(needle)}`);
  return match as HTMLButtonElement;
}

function saveButton(): HTMLButtonElement {
  return editorButton(en.mapVetoAdmin.save);
}

/**
 * The pool-shape, step-order and first-ban controls are the `aria-pressed`
 * buttons that carry no `aria-label`; a picker tile is `aria-pressed` too, so
 * the absence of the attribute is what separates them.
 */
function toggleByText(label: string, scope: ParentNode = editor()): HTMLButtonElement {
  const match = [...scope.querySelectorAll("button[aria-pressed]:not([aria-label])")].find(
    (element) => (element.textContent ?? "").includes(label)
  );
  if (!match) throw new Error(`no toggle for ${JSON.stringify(label)}`);
  return match as HTMLButtonElement;
}

function pressed(label: string, scope: ParentNode = editor()): string | null {
  return toggleByText(label, scope).getAttribute("aria-pressed");
}

async function openAdvanced() {
  const trigger = editorButton(en.mapVetoAdmin.advancedTitle);
  if (trigger.getAttribute("data-state") !== "open") await click(trigger);
}

/*
 * Selection rows and the picker.
 *
 * A row is `role="group"` under its own label; the maps it holds are chips, one
 * button each. The catalogue lives in a popover the row's "Add maps" button
 * opens, portalled out of the container under its own group label.
 */

function poolRow(): HTMLElement {
  const match = editor().querySelector<HTMLElement>(
    `[role="group"][aria-label="${en.mapVetoAdmin.poolTitle}"]`
  );
  if (!match) throw new Error("no flat pool row");
  return match;
}

function slotRow(position: number): HTMLElement {
  const label = en.mapVetoAdmin.slotLabel.replace("{n}", String(position));
  const match = editor().querySelector<HTMLElement>(`[role="group"][aria-label="${label}"]`);
  if (!match) throw new Error(`no slot row for position ${position}`);
  return match;
}

/** The maps a row holds, in the order they are stored in. */
function chips(row: HTMLElement): string[] {
  return [...row.querySelectorAll('button[aria-label]:not([role="combobox"])')].map((element) =>
    (element.querySelector("span")?.textContent ?? "").trim()
  );
}

function poolChips(): string[] {
  return chips(poolRow());
}

function slotChips(position: number): string[] {
  return chips(slotRow(position));
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

async function addToPool(names: string[]) {
  await withPicker(poolRow, POOL_PICKER, async () => {
    for (const name of names) await click(pickerTile(POOL_PICKER, name));
  });
}

async function addToSlot(position: number, names: string[]) {
  const label = slotPicker(position);
  await withPicker(() => slotRow(position), label, async () => {
    for (const name of names) await click(pickerTile(label, name));
  });
}

/**
 * Radix Select: the trigger opens on pointerdown and the listbox is portalled
 * out of the container, so the options are read off the document.
 */
async function openReservePicker(position: number): Promise<string[]> {
  const trigger = slotRow(position).querySelector<HTMLElement>('button[role="combobox"]');
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

const ROUND = (n: number) => en.mapVetoAdmin.roundLabel.replace("{round}", String(n));
const WHOLE_STAGE = en.mapVetoAdmin.stageDefaultButton;

/** Round 1 of Groups: a single round, Bo2, no per-round overrides. */
async function openGroupsRound1() {
  await openScope(ROUND(1), stageGroup("Groups"));
}

describe("TournamentMapVetoTab form seeding", () => {
  it("shows no level at all until the configs and the map catalogue have arrived", async () => {
    // A read that never settles: take the promise and never resolve it. No row
    // may claim a level is configured, or unconfigured, before it knows.
    const pending = Promise.withResolvers<never>();
    listVetoConfigs.mockReturnValue(pending.promise);
    await mount();
    await settle(5);

    expect(scopeRows()).toEqual([]);
    expect(text()).not.toContain(en.mapVetoAdmin.levelNew);
    expect(text()).not.toContain(en.mapVetoAdmin.levelExisting);
    expect(text()).not.toContain(en.mapVetoAdmin.save);
  });

  it("seeds the pool from the existing config, not from the all-maps default", async () => {
    await mount();
    await settle();

    // The tournament default is the row the page opens on.
    expect(editorText()).toContain(en.mapVetoAdmin.levelExisting);
    expect(editorText()).not.toContain(en.mapVetoAdmin.levelNew);
    // The config selects 5 of 12 maps; seeding from the default would select 12.
    // Chips read in the stored pool order, which is not catalogue order.
    expect(poolChips()).toEqual(TOURNAMENT_DEFAULT_POOL);
  });

  it("keeps an in-progress edit when the map catalogue changes underneath it", async () => {
    await mount();
    await settle();

    expect(poolChips()).toContain("Busan");
    // A chip is its own remove control.
    await click(
      [...poolRow().querySelectorAll<HTMLButtonElement>("button[aria-label]")].find(
        (element) =>
          element.getAttribute("aria-label") ===
          en.mapVetoAdmin.poolChipRemove.replace("{map}", "Busan")
      ) as HTMLButtonElement
    );
    expect(poolChips()).not.toContain("Busan");

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
    expect(poolChips()).toEqual(TOURNAMENT_DEFAULT_POOL.filter((name) => name !== "Busan"));

    // ...while the new map is offered.
    await withPicker(poolRow, POOL_PICKER, async () => {
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
    expect(poolChips()).toEqual(TOURNAMENT_DEFAULT_POOL);

    await openScope(WHOLE_STAGE, stageGroup("Playoffs"));

    expect(poolChips()).toEqual(["Ilios", "Midtown", "Havana"]);
    expect(editorText()).toContain(en.mapVetoAdmin.levelExisting);
  });

  it("labels a level with no config of its own as new, without borrowing another level's pool", async () => {
    await mount();
    await settle();

    await openScope(WHOLE_STAGE, stageGroup("Groups"));

    // Stage 188 has no config: the level is new, and must not silently present
    // the tournament default's 5-map pool as this stage's own configuration.
    expect(editorText()).toContain(en.mapVetoAdmin.levelNew);
    expect(editorText()).not.toContain(en.mapVetoAdmin.levelExisting);
    expect(poolChips()).toEqual(CATALOGUE_ORDER);
  });

  it("keeps a level's edit across a collapse, and marks it unsaved until it is saved", async () => {
    // The whole reason the draft lives in the tab: collapsing a row unmounts its
    // editor, and an editor that owned its own state would lose the work.
    await mount();
    await settle();

    await addToPool(["Ilios"]);
    expect(poolChips()).toEqual([...TOURNAMENT_DEFAULT_POOL, "Ilios"]);
    expect(text()).toContain(en.mapVetoAdmin.unsaved);

    await openScope(WHOLE_STAGE, stageGroup("Groups"));
    await openScope(en.mapVetoAdmin.tournamentDefault);

    expect(poolChips()).toEqual([...TOURNAMENT_DEFAULT_POOL, "Ilios"]);

    // And discarding puts the level back on its stored config.
    await click(editorButton(en.mapVetoAdmin.reset));
    expect(poolChips()).toEqual(TOURNAMENT_DEFAULT_POOL);
    expect(text()).not.toContain(en.mapVetoAdmin.unsaved);
  });
});

describe("TournamentMapVetoTab series length comes from the bracket", () => {
  it("never offers a control that claims to set the series format", async () => {
    await mount();
    await settle();

    // The old editor shipped Bo1/Bo2/Bo3/Bo5 buttons whose choice the veto
    // session now overrides, so the format must be stated, not chosen. Asserted
    // on the controls rather than on prose: the rows carry Bo labels as read-only
    // badges, so page text cannot tell the two apart.
    expect(editorText()).toContain(en.mapVetoAdmin.formatSourceBracket);

    const presetLabels = new Set(Object.values(en.mapVeto.preset));
    const formatButtons = [...container.querySelectorAll("button")].filter((element) =>
      presetLabels.has((element.textContent ?? "").trim())
    );
    expect(formatButtons).toEqual([]);
  });

  it("opens a legacy bo* config in bracket mode, not custom", async () => {
    await mount();
    await settle();
    await openAdvanced();

    // TOURNAMENT_DEFAULT carries preset "bo3": a template label, not an opinion.
    expect(pressed(en.mapVetoAdmin.orderModeBracket)).toBe("true");
    expect(pressed(en.mapVetoAdmin.orderModeCustom)).toBe("false");
  });

  it("opens an explicitly custom config with its authored order already in view", async () => {
    listVetoConfigs.mockResolvedValue({
      configs: [{ ...TOURNAMENT_DEFAULT, preset: "custom" }]
    });
    await mount();
    await settle();

    // No click on "Advanced": a hand-authored order is the one setting an
    // organizer must not have to go looking for.
    expect(pressed(en.mapVetoAdmin.orderModeCustom)).toBe("true");
  });

  it("saves preset bracket with a sequence matching the stage's best-of", async () => {
    upsertVetoConfig.mockResolvedValue({});
    // Stage 188 (Groups) runs Bo2 while the stored template is Bo3.
    listVetoConfigs.mockResolvedValue({
      configs: [{ ...TOURNAMENT_DEFAULT, id: 901, stage_id: 188, round: null }]
    });
    await mount();
    await settle();

    await openScope(WHOLE_STAGE, stageGroup("Groups"));
    await click(saveButton());

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
    await openScope(WHOLE_STAGE, stageGroup("Groups"));

    expect(editorText()).toContain(en.mapVetoAdmin.mismatchTitle);
    // A custom order deliberately wins, so saving stays available.
    expect(saveButton().disabled).toBe(false);
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
  await openGroupsRound1();
  await click(toggleByText(en.mapVetoAdmin.poolShapeSlots));
}

describe("TournamentMapVetoTab pool shape", () => {
  it("opens a flat config in pool shape, offering the step-order group", async () => {
    await mount();
    await settle();

    expect(pressed(en.mapVetoAdmin.poolShapeFlat)).toBe("true");
    expect(pressed(en.mapVetoAdmin.poolShapeSlots)).toBe("false");
    expect(editorText()).toContain(en.mapVetoAdmin.poolDescription);
    expect(editorText()).not.toContain(en.mapVetoAdmin.slotsDescription);
    // Step order belongs to the flat shape only.
    await openAdvanced();
    expect(editorText()).toContain(en.mapVetoAdmin.orderModeTitle);
  });

  it("opens a slot-mode config in slot shape, hiding the flat pool and the step order", async () => {
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();
    await openGroupsRound1();

    expect(pressed(en.mapVetoAdmin.poolShapeSlots)).toBe("true");
    expect(pressed(en.mapVetoAdmin.poolShapeFlat)).toBe("false");
    expect(editorText()).toContain(en.mapVetoAdmin.slotsDescription);
    // A flat pool row here would collect selections the slot-mode payload
    // discards, and a step-order choice cannot coexist with slots at all.
    expect(editorText()).not.toContain(en.mapVetoAdmin.poolDescription);
    expect(() => poolRow()).toThrow();
    await openAdvanced();
    expect(editorText()).not.toContain(en.mapVetoAdmin.orderModeTitle);
  });

  it("preserves the slot draft across a pool-shape toggle", async () => {
    upsertVetoConfig.mockResolvedValue({});
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();
    await openGroupsRound1();

    // Slot 1's candidates are ids 7, 1, 4 in play order.
    expect(slotChips(1)).toEqual(["Circuit Royal", "Antarctic Peninsula", "Blizzard World"]);

    await click(toggleByText(en.mapVetoAdmin.poolShapeFlat));
    expect(pressed(en.mapVetoAdmin.poolShapeFlat)).toBe("true");

    await click(toggleByText(en.mapVetoAdmin.poolShapeSlots));
    expect(pressed(en.mapVetoAdmin.poolShapeSlots)).toBe("true");
    expect(slotChips(1)).toEqual(["Circuit Royal", "Antarctic Peninsula", "Blizzard World"]);

    await click(saveButton());
    expect(savedPayload().slots).toEqual(SLOT_DRAFT);
  });

  it("preserves the flat pool selection across a pool-shape toggle", async () => {
    await mount();
    await settle();
    // Round 1 of Groups has no config of its own, so the pool seeds to the whole
    // catalogue — and the gate opens there, which the tournament default's does not.
    await openGroupsRound1();

    expect(poolChips()).toEqual(CATALOGUE_ORDER);
    await click(
      [...poolRow().querySelectorAll<HTMLButtonElement>("button[aria-label]")].find(
        (element) =>
          element.getAttribute("aria-label") ===
          en.mapVetoAdmin.poolChipRemove.replace("{map}", "Busan")
      ) as HTMLButtonElement
    );

    await click(toggleByText(en.mapVetoAdmin.poolShapeSlots));
    await click(toggleByText(en.mapVetoAdmin.poolShapeFlat));

    expect(poolChips()).toEqual(CATALOGUE_ORDER.filter((name) => name !== "Busan"));
  });

  it("opens a slot config's flat row on the pool a new level starts from", async () => {
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();
    await openGroupsRound1();

    await click(toggleByText(en.mapVetoAdmin.poolShapeFlat));

    // A slot config reports `map_ids: []` — the upsert refuses any other value
    // and nothing mirrors slot candidates into the flat pool. Seeding the flat
    // row from it left every chip off and Save refused, so one mis-click on the
    // flat shape stranded the organizer; an unconfigured round, meanwhile, seeds
    // the whole catalogue. Same emptiness on the wire, so the two must start
    // from the same place.
    expect(poolChips()).toEqual(CATALOGUE_ORDER);
    expect(editorText()).not.toContain(en.mapVetoAdmin.validation.emptyPool);
    expect(editorText()).not.toContain(en.mapVetoAdmin.validation.emptySequence);
    expect(saveButton().disabled).toBe(false);
  });

  it("seeds a slot config's custom sequence for the pool that row will work with", async () => {
    upsertVetoConfig.mockResolvedValue({});
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();
    await openGroupsRound1();

    await click(toggleByText(en.mapVetoAdmin.poolShapeFlat));
    await openAdvanced();
    await click(toggleByText(en.mapVetoAdmin.orderModeCustom));

    // Sized from `config.map_ids.length` this was `buildSequenceForBestOf(2, 0)`
    // — an empty step list with nothing to reorder and nothing to save. The
    // fallback has to use the pool the form actually seeded.
    expect(editorText()).not.toContain(en.mapVetoAdmin.sequenceEmpty);

    await click(saveButton());
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
    await openGroupsRound1();

    await click(saveButton());

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

    await click(saveButton());

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
    await openGroupsRound1();
    // A new level seeds the pool to the whole catalogue, so the flat fields hold
    // real content the shape switch has to drop.
    expect(poolChips()).toEqual(CATALOGUE_ORDER);

    await click(toggleByText(en.mapVetoAdmin.poolShapeSlots));
    await addToSlot(1, ["Busan", "Ilios"]);
    await addToSlot(2, ["Dorado", "Havana"]);
    await click(saveButton());

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
    await openGroupsRound1();

    await click(toggleByText(en.mapVetoAdmin.poolShapeFlat));
    // The flat row seeds to the whole catalogue, so it is cleared and rebuilt by
    // hand: five picks, so the click order is visible in the payload.
    await withPicker(poolRow, POOL_PICKER, async () => {
      await click(pickerButton(POOL_PICKER, en.mapVetoAdmin.poolClear));
      expect(poolChips()).toEqual([]);
      for (const name of ["Busan", "Dorado", "Havana", "Ilios", "Midtown"]) {
        await click(pickerTile(POOL_PICKER, name));
      }
    });

    await click(saveButton());

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

    // `{ scope: "tournament" }` carries a concrete DEFAULT_BEST_OF, so a gate
    // asking "is bestOf a number" would open slot mode exactly where the series
    // length is unknowable.
    expect(toggleByText(en.mapVetoAdmin.poolShapeSlots).disabled).toBe(true);
    expect(editorText()).toContain(en.mapVetoAdmin.poolShapeSlotsUnavailableTournament);
    // Disabled with its reason, never absent: silent absence reads as "the
    // feature does not exist".
    expect(toggleByText(en.mapVetoAdmin.poolShapeFlat).disabled).toBe(false);

    await click(toggleByText(en.mapVetoAdmin.poolShapeSlots));
    expect(pressed(en.mapVetoAdmin.poolShapeFlat)).toBe("true");
    expect(editorText()).not.toContain(en.mapVetoAdmin.slotsDescription);
  });

  it("disables slot mode with its reason at a stage whose rounds play different lengths", async () => {
    await mount();
    await settle();
    // Playoffs overrides its final round, so the stage has no single best-of.
    await openScope(WHOLE_STAGE, stageGroup("Playoffs"));

    expect(toggleByText(en.mapVetoAdmin.poolShapeSlots).disabled).toBe(true);
    // Distinct copy per cause: "choose a single round" is actionable here, and
    // the tournament-level reason would send the organizer somewhere useless.
    expect(editorText()).toContain(en.mapVetoAdmin.poolShapeSlotsUnavailableStage);
    expect(editorText()).not.toContain(en.mapVetoAdmin.poolShapeSlotsUnavailableTournament);
  });

  it("opens slot mode at a stage whose rounds all play the same length, warning that one config covers them all", async () => {
    await mount();
    await settle();
    // Groups is Bo2 throughout, so the gate passes — and that is the trap the
    // warning exists for: one shared config for five rounds that each want one.
    await openScope(WHOLE_STAGE, stageGroup("Groups"));

    expect(toggleByText(en.mapVetoAdmin.poolShapeSlots).disabled).toBe(false);
    expect(editorText()).not.toContain(en.mapVetoAdmin.poolShapeSlotsUnavailableStage);
    expect(editorText()).not.toContain(en.mapVetoAdmin.poolShapeSlotsUnavailableTournament);

    await click(toggleByText(en.mapVetoAdmin.poolShapeSlots));
    expect(pressed(en.mapVetoAdmin.poolShapeSlots)).toBe("true");
    expect(editorText()).toContain(STAGE_SCOPE_WARNING_FIVE);
    // A warning, not a block: the slot rows are still there to fill.
    await withPicker(() => slotRow(1), slotPicker(1), async () => {
      expect(pickerMaps(slotPicker(1))).toHaveLength(catalogue().length);
    });
  });

  it("opens slot mode at a single round, with one row per map and no stage-scope warning", async () => {
    await openEmptySlotEditor();

    expect(pressed(en.mapVetoAdmin.poolShapeSlots)).toBe("true");
    expect(editorText()).not.toContain(STAGE_SCOPE_WARNING_FIVE);
    // Bo2, so exactly two rows, derived from the bracket — and no control that
    // adds a third, which is what makes the count self-evident without prose.
    expect(editorText()).not.toContain(en.mapVetoAdmin.addStep);
    expect(slotRow(2)).toBeTruthy();
    expect(() => slotRow(3)).toThrow();
  });
});

describe("TournamentMapVetoTab slot editor", () => {
  it("filters one slot's picker to a gamemode and takes exactly those maps", async () => {
    upsertVetoConfig.mockResolvedValue({});
    await openEmptySlotEditor();

    const first = slotPicker(1);
    await withPicker(() => slotRow(1), first, async () => {
      await click(pickerButton(first, "Control (3)"));
      expect(pickerMaps(first)).toEqual(["Antarctic Peninsula", "Busan", "Ilios"]);
      await click(pickerButton(first, en.mapVetoAdmin.poolSelectAll));
    });

    expect(slotChips(1)).toEqual(["Antarctic Peninsula", "Busan", "Ilios"]);
    // The filter belongs to the picker, not to the level: slot 2 is untouched.
    expect(slotChips(2)).toEqual([]);

    // Two Escort maps in slot 2, so the two rows end at different lengths and
    // neither count can stand in for the other.
    await addToSlot(2, ["Dorado", "Havana"]);
    await click(saveButton());

    expect(savedPayload().slots).toEqual([
      { candidates: [1, 2, 3], reserve_map_id: null },
      { candidates: [8, 9], reserve_map_id: null }
    ]);
  });

  it("disables save and names the slot that has too few candidates", async () => {
    await openEmptySlotEditor();

    // Both rows start empty and both are named, so a check that reports only
    // the first failure cannot pass this.
    expect(editorText()).toContain(tooFewCandidates(1));
    expect(editorText()).toContain(tooFewCandidates(2));
    expect(saveButton().disabled).toBe(true);

    await addToSlot(1, ["Busan", "Ilios"]);
    await addToSlot(2, ["Dorado"]);

    // Slot 1 is legal, slot 2 is one short: only slot 2 is named, so the message
    // cannot be a fixed string that happens to read correctly.
    expect(editorText()).not.toContain(tooFewCandidates(1));
    expect(editorText()).toContain(tooFewCandidates(2));
    expect(saveButton().disabled).toBe(true);

    await addToSlot(2, ["Havana"]);
    expect(editorText()).not.toContain(tooFewCandidates(2));
    expect(saveButton().disabled).toBe(false);
  });

  it("finds each map the regulation spells differently from the catalogue", async () => {
    await openEmptySlotEditor();
    const label = slotPicker(1);

    await withPicker(() => slotRow(1), label, async () => {
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
    await openGroupsRound1();

    // Slot 1 is one map from each of three modes — the cross-mode mistake the
    // badges exist to make visible without counting chips.
    const rowOne = slotRow(1).textContent ?? "";
    expect(rowOne).toContain("Control (1)");
    expect(rowOne).toContain("Escort (1)");
    expect(rowOne).toContain("Hybrid (1)");

    // Slot 2 holds Eichenwalde and Ilios: no Escort candidate at all.
    const rowTwo = slotRow(2).textContent ?? "";
    expect(rowTwo).toContain("Control (1)");
    expect(rowTwo).toContain("Hybrid (1)");
    expect(rowTwo).not.toContain("Escort (1)");
  });

  it("never offers a slot's own candidates as its reserve", async () => {
    upsertVetoConfig.mockResolvedValue({});
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();
    await openGroupsRound1();

    const options = await openReservePicker(1);
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
    await click(saveButton());
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
    await openGroupsRound1();

    // Slot 2 reserves Havana (id 9). Adding Havana there makes the replay map
    // the very map that drew, which the upsert refuses.
    await addToSlot(2, ["Havana"]);
    await click(saveButton());

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
    await openGroupsRound1();

    // The stored config really is custom, so the guard below is reached. Without
    // this the assertion would hold for the wrong reason: a bracket-preset
    // fixture never gets there at all.
    expect(pressed(en.mapVetoAdmin.orderModeCustom)).toBe("true");

    await click(toggleByText(en.mapVetoAdmin.poolShapeSlots));
    await addToSlot(1, ["Busan", "Ilios"]);
    await addToSlot(2, ["Dorado", "Havana"]);
    await click(saveButton());

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
    await openGroupsRound1();

    // Three stored slots against a Bo2 round: both numbers named, and the third
    // slot has no row because the bracket does not play it.
    expect(editorText()).toContain(SLOT_COUNT_MISMATCH_THREE_TWO);
    expect(() => slotRow(3)).toThrow();
  });

  it("chooses who bans first, and keeps the choice on the wire", async () => {
    upsertVetoConfig.mockResolvedValue({});
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();
    await openGroupsRound1();
    await openAdvanced();

    // The fixture stores "alternate", so the control opens on it.
    expect(pressed(en.mapVetoAdmin.firstBanAlternate)).toBe("true");
    expect(pressed(en.mapVetoAdmin.firstBanFixed)).toBe("false");

    await click(toggleByText(en.mapVetoAdmin.firstBanFixed));
    await click(saveButton());
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
 * grouped upper (positive) / lower (negative), plus the planned rounds
 * `max_rounds` promises, marked as not generated.
 */

/** Only the two fields the list reads; a real `Encounter` satisfies it. */
function enc(stageId: number | null, round: number): StageRoundSource {
  return { stage_id: stageId, round };
}

/**
 * A double-elimination stage whose encounters disagree with `max_rounds` in
 * every direction at once, so no single arithmetic shortcut reproduces the
 * answer:
 *  - `max_rounds` is 4, but round 5 exists — a regenerated bracket grew past
 *    the stored number, so `1..max_rounds` alone loses a real round;
 *  - round 3 is promised by `max_rounds` and has no encounter, and it sits in
 *    the middle rather than at the end, so "the tail is planned" is wrong;
 *  - the lower rounds are -1, -2, -4: gapped, so mirroring `1..n` invents -3,
 *    and three of them against five upper rounds, so neither count stands in
 *    for the other;
 *  - rounds repeat across encounters, so a list that is not deduplicated
 *    renders the same row twice.
 */
const DE_STAGE: Stage = {
  ...stage(190, "DE Bracket", 2, 4, { default: 3 }),
  stage_type: "double_elimination"
} as Stage;

const DE_STAGES = [...STAGES, DE_STAGE];

const DE_ENCOUNTERS: StageRoundSource[] = [
  enc(190, 4),
  enc(190, 1),
  enc(190, -2),
  enc(190, 1),
  enc(190, 5),
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
  return scopeRows(scope)
    .map(rowLabel)
    .filter((label) => label !== WHOLE_STAGE);
}

/** Round labels inside one scope whose row carries the not-generated marker. */
function notGeneratedNames(scope: ParentNode): string[] {
  return scopeRows(scope)
    .filter((trigger) =>
      (trigger.textContent ?? "").includes(en.mapVetoAdmin.roundNotGenerated)
    )
    .map(rowLabel);
}

describe("TournamentMapVetoTab round list", () => {
  it("offers both brackets' rounds, taking them from the encounters that exist", async () => {
    await mount({ stages: DE_STAGES, encounters: DE_ENCOUNTERS });
    await settle();

    // Round 5 is past `max_rounds` and round 3 is inside it with no encounter:
    // the union of both sources, deduplicated, in ascending order.
    expect(roundNames(bracketGroup("DE Bracket", UPPER))).toEqual([
      "Round 1",
      "Round 2",
      "Round 3",
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

    // Only the promised-but-absent round is marked, and the marker never
    // reaches a lower round, which is never planned.
    expect(notGeneratedNames(bracketGroup("DE Bracket", UPPER))).toEqual(["Round 3"]);
    expect(notGeneratedNames(bracketGroup("DE Bracket", LOWER))).toEqual([]);
  });

  it("round-trips a lower-bracket round through selection, seeding and save", async () => {
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
    await openScope("Lower R2", bracketGroup("DE Bracket", LOWER));

    // Read back: the config on round -2, not the one on round 2.
    expect(editorText()).toContain(en.mapVetoAdmin.levelExisting);
    expect(poolChips()).toEqual(["Paraíso", "Busan", "Dorado"]);

    await click(saveButton());

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
    expect(roundNames(groups)).toEqual([
      "Round 1",
      "Round 2",
      "Round 3",
      "Round 4",
      "Round 5"
    ]);
    expect(groups.textContent ?? "").not.toContain(UPPER);
    expect(groups.textContent ?? "").not.toContain(LOWER);
    expect(groups.textContent ?? "").not.toContain("Lower R");

    // The two rounds the bracket has not reached yet are marked, and only them.
    expect(notGeneratedNames(groups)).toEqual(["Round 4", "Round 5"]);

    // And the round still saves what it always did.
    await openScope("Round 2", groups);
    await click(saveButton());
    const payload = savedPayload();
    expect(payload.round).toBe(2);
    expect(payload.stage_id).toBe(188);
  });

  it("lets the organizer configure a round the bracket has not generated yet", async () => {
    upsertVetoConfig.mockResolvedValue({});
    await mount({ stages: DE_STAGES, encounters: DE_ENCOUNTERS });
    await settle();

    // Marked, never disabled: a config cascades to encounters created later,
    // so authoring round 3's pool before round 3 exists is the intended order
    // of work, not a mistake to block.
    const upper = bracketGroup("DE Bracket", UPPER);
    const planned = scopeRow("Round 3", upper);
    expect(planned.disabled).toBe(false);
    expect(planned.textContent).toContain(en.mapVetoAdmin.roundNotGenerated);

    await click(planned);
    expect(editorText()).toContain(en.mapVetoAdmin.levelNew);

    await click(saveButton());
    const payload = savedPayload();
    expect(payload.round).toBe(3);
    expect(payload.stage_id).toBe(190);
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

function rowText(label: string, scope: ParentNode): string {
  return scopeRow(label, scope).textContent ?? "";
}

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
    const groups = stageGroup("Groups");

    // Both numbers, because a round with two empty slots and a round with two
    // full ones must not read identically: the slot count alone is the same for
    // every Bo2 round whether or not anyone filled it in.
    expect(rowText("Round 1", groups)).toContain(ROUND_SLOTS_2_5);
    expect(rowText("Round 1", groups)).not.toContain(ROUND_FLAT_ZERO);

    // Same slot count, a different candidate total: the second number is read
    // from this config, not copied from the first row or from the slot count.
    expect(rowText("Round 2", groups)).toContain(ROUND_SLOTS_2_4);
    expect(rowText("Round 2", groups)).not.toContain(ROUND_FLAT_ZERO);
  });

  it("leaves a flat round's summary as the pool size, and an unconfigured round's alone", async () => {
    await mount();
    await settle();
    const groups = stageGroup("Groups");

    // Flat mode's copy is untouched, and the slot wording must not leak into it.
    const flat = rowText("Round 3", groups);
    expect(flat).toContain(ROUND_FLAT_THREE);
    expect(flat).not.toContain("slot");
    expect(flat).not.toContain("candidate");

    // No config at all is still a third thing, distinct from both summaries.
    const inherited = rowText("Round 4", groups);
    expect(inherited).toContain(en.mapVetoAdmin.roundUsesDefault);
    expect(inherited).not.toContain("slot");
    expect(inherited).not.toContain("in the pool");
  });

  it("says the tournament default has nothing to fall back on when it is unset", async () => {
    // Every other level inherits; this one is the root, so "uses the inherited
    // pool" would be a lie and an organizer would read it as configured.
    await mount();
    await settle();

    const row = scopeRow(en.mapVetoAdmin.tournamentDefault).textContent ?? "";
    expect(row).toContain(en.mapVetoAdmin.tournamentUnconfigured);
    expect(row).not.toContain(en.mapVetoAdmin.roundUsesDefault);
  });
});
