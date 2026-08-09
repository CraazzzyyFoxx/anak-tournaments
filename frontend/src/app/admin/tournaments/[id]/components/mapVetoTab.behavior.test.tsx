// @vitest-environment happy-dom
//
// This tab used to seed its form by calling `setFormState` from inside a
// `useMemo` whose deps included the fetched `maps` array. A `useMemo` callback
// must be pure, and React is free to re-run one whenever it drops the cache —
// so an organizer's in-progress pool edit was silently reverted, and the first
// arrival of the map catalogue reset the form under them.
//
// The fix moved all form state into a child seeded by `useState` initializers
// and remounted through a parent `key`, gated on both queries succeeding. These
// tests pin the three properties that made the old shape unsafe:
//   1. the form never mounts before the config it seeds from has arrived;
//   2. it seeds from that config, not from the all-maps default;
//   3. a new `maps` array identity does not clobber an edit in progress.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type { MapRead } from "@/types/map.types";
import type { MapVetoConfig, Stage } from "@/types/tournament.types";

import { TournamentMapVetoTab } from "./TournamentMapVetoTab";

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
 * the slot editor's name filter has to land on.
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
 * default, because the editor derives one slot card per map of the series: the
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

function buttonByText(needle: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find((element) =>
    (element.textContent ?? "").includes(needle)
  );
  if (!match) throw new Error(`no button containing ${JSON.stringify(needle)}`);
  return match as HTMLButtonElement;
}

/**
 * The pool-shape and step-order cards are the `aria-pressed` controls that carry
 * no `aria-label`, so they are addressed by their label text rather than by the
 * attribute — a pool tile is `aria-pressed` too.
 */
function toggleByText(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button[aria-pressed]")].find((element) =>
    (element.textContent ?? "").includes(label)
  );
  if (!match) throw new Error(`no toggle for ${JSON.stringify(label)}`);
  return match as HTMLButtonElement;
}

const MAP_NAMES: Record<string, true> = Object.fromEntries(
  catalogue().map((map) => [map.name, true])
);

/**
 * Flat-pool tiles are `aria-pressed` buttons whose accessible name is
 * `"{map}, {gamemode}"`. A slot tile's name carries a third `", slot N"`
 * segment, so the segment count is what separates the two grids — matching on
 * the leading name alone would pick a slot tile once slot mode renders one.
 */
function mapTile(name: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button[aria-pressed][aria-label]")].find(
    (element) => {
      const parts = (element.getAttribute("aria-label") ?? "").split(",");
      return parts.length === 2 && parts[0] === name;
    }
  );
  if (!match) throw new Error(`no pool tile for ${JSON.stringify(name)}`);
  return match as HTMLButtonElement;
}

/** One slot card, addressed by the `role="group"` label the editor gives it. */
function slotCard(position: number): HTMLElement {
  const label = en.mapVetoAdmin.slotLabel.replace("{n}", String(position));
  const match = container.querySelector<HTMLElement>(
    `[role="group"][aria-label="${label}"]`
  );
  if (!match) throw new Error(`no slot card for position ${position}`);
  return match;
}

/** A candidate tile inside one slot card. */
function slotTile(position: number, name: string): HTMLButtonElement {
  const card = slotCard(position);
  const match = [...card.querySelectorAll("button[aria-pressed][aria-label]")].find(
    (element) => (element.getAttribute("aria-label") ?? "").split(",")[0] === name
  );
  if (!match) throw new Error(`no slot ${position} tile for ${JSON.stringify(name)}`);
  return match as HTMLButtonElement;
}

/** Every map offered inside a card, in render order — what the filters narrow. */
function slotVisibleMaps(position: number): string[] {
  return [...slotCard(position).querySelectorAll("button[aria-pressed][aria-label]")].map(
    (element) => (element.getAttribute("aria-label") ?? "").split(",")[0]
  );
}

/** Candidates selected in one card, in the order the tiles report. */
function slotSelected(position: number): string[] {
  return [...slotCard(position).querySelectorAll('button[aria-pressed="true"][aria-label]')].map(
    (element) => (element.getAttribute("aria-label") ?? "").split(",")[0]
  );
}

/** A button inside one slot card, so five cards' "Select all" stay distinct. */
function slotButton(position: number, needle: string): HTMLButtonElement {
  const match = [...slotCard(position).querySelectorAll("button")].find((element) =>
    (element.textContent ?? "").includes(needle)
  );
  if (!match) throw new Error(`no slot ${position} button containing ${JSON.stringify(needle)}`);
  return match as HTMLButtonElement;
}

function selectedTiles(): string[] {
  return [...container.querySelectorAll('button[aria-pressed="true"][aria-label]')]
    .map((element) => (element.getAttribute("aria-label") ?? "").split(",")[0])
    .filter((name) => MAP_NAMES[name])
    .sort();
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

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <QueryClientProvider client={client}>
          <TournamentMapVetoTab tournamentId={78} stages={STAGES} canManage />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click();
  });
  await settle(3);
}

/**
 * Round 1 of Groups: a single round, Bo2, no per-round overrides. The one scope
 * where the gate opens for a two-slot config, and the scope every slot fixture
 * here is written against.
 */
async function selectGroupsRound1() {
  await click(buttonByText("Groups"));
  await click(buttonByText(en.mapVetoAdmin.roundLabel.replace("{round}", "1")));
}

/**
 * Radix Select: the trigger opens on pointerdown and the listbox is portalled
 * out of the container, so the options are read off the document.
 */
async function openReservePicker(position: number): Promise<string[]> {
  const trigger = slotCard(position).querySelector<HTMLElement>('button[role="combobox"]');
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

describe("TournamentMapVetoTab form seeding", () => {
  it("does not mount the form until the config and the map catalogue have arrived", async () => {
    // Never-resolving configs read: the form must not appear and, critically,
    // must not claim this level is unconfigured.
    // A read that never settles: take the promise and never resolve it.
    const pending = Promise.withResolvers<never>();
    listVetoConfigs.mockReturnValue(pending.promise);
    await mount();
    await settle(5);

    expect(text()).not.toContain(en.mapVetoAdmin.levelNew);
    expect(text()).not.toContain(en.mapVetoAdmin.levelExisting);
    expect(text()).not.toContain(en.mapVetoAdmin.save);
    expect(container.querySelectorAll("button[aria-pressed][aria-label]")).toHaveLength(0);
  });

  it("seeds the pool from the existing config, not from the all-maps default", async () => {
    await mount();
    await settle();

    expect(text()).toContain(en.mapVetoAdmin.levelExisting);
    expect(text()).not.toContain(en.mapVetoAdmin.levelNew);
    // The config selects 5 of 12 maps; seeding from the default would select 12.
    expect(selectedTiles()).toEqual(
      ["Antarctic Peninsula", "Blizzard World", "Busan", "Circuit Royal", "Eichenwalde"].sort()
    );
  });

  it("keeps an in-progress edit when the map catalogue changes underneath it", async () => {
    await mount();
    await settle();

    const before = selectedTiles();
    expect(before).toContain("Busan");

    await act(async () => {
      mapTile("Busan").click();
    });
    await settle(3);
    expect(selectedTiles()).not.toContain("Busan");

    // A refetch that returns genuinely different content, so React Query's
    // structural sharing cannot preserve the old `data` reference and the
    // derived `maps` array really does change identity. That identity change is
    // what the pre-fix `useMemo([…, maps])` seeding keyed on: it re-ran and
    // restored "Busan", silently reverting the organizer's edit.
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
    // The new map is offered...
    expect(text()).toContain("Samoa");
    // ...but the edit stands, and the new map is not auto-selected into the pool.
    expect(selectedTiles()).not.toContain("Busan");
    expect(selectedTiles()).not.toContain("Samoa");
    expect(selectedTiles()).toHaveLength(before.length - 1);
  });

  it("reseeds from the newly selected level when the scope changes", async () => {
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
    expect(selectedTiles()).toHaveLength(5);

    await act(async () => {
      buttonByText("Playoffs").click();
    });
    await settle();

    expect(selectedTiles()).toEqual(["Havana", "Ilios", "Midtown"].sort());
    expect(text()).toContain(en.mapVetoAdmin.levelExisting);
  });

  it("labels a level with no config of its own as new, without borrowing another level's pool", async () => {
    await mount();
    await settle();

    await act(async () => {
      buttonByText("Groups").click();
    });
    await settle();

    // Stage 188 has no config: the form is new, and must not silently present
    // the tournament default's 5-map pool as this stage's own configuration.
    expect(text()).toContain(en.mapVetoAdmin.levelNew);
    expect(text()).not.toContain(en.mapVetoAdmin.levelExisting);
  });
});

describe("TournamentMapVetoTab series length comes from the bracket", () => {
  it("never offers a control that claims to set the series format", async () => {
    await mount();
    await settle();

    // The old editor shipped Bo1/Bo2/Bo3/Bo5 buttons whose choice the veto
    // session now overrides, so the format must be stated, not chosen. Asserted
    // on the controls rather than on prose: "3 maps played" also appears as a
    // legitimate derived figure, so page text cannot tell the two apart.
    expect(text()).toContain(en.mapVetoAdmin.formatSourceBracket);

    const presetLabels = new Set(Object.values(en.mapVeto.preset));
    const formatButtons = [...container.querySelectorAll("button")].filter((element) =>
      presetLabels.has((element.textContent ?? "").trim())
    );
    expect(formatButtons).toEqual([]);
  });

  it("opens a legacy bo* config in bracket mode, not custom", async () => {
    await mount();
    await settle();

    // TOURNAMENT_DEFAULT carries preset "bo3": a template label, not an opinion.
    expect(toggleByText(en.mapVetoAdmin.orderModeBracket).getAttribute("aria-pressed")).toBe("true");
    expect(toggleByText(en.mapVetoAdmin.orderModeCustom).getAttribute("aria-pressed")).toBe("false");
  });

  it("opens an explicitly custom config in custom mode", async () => {
    listVetoConfigs.mockResolvedValue({
      configs: [{ ...TOURNAMENT_DEFAULT, preset: "custom" }]
    });
    await mount();
    await settle();

    expect(toggleByText(en.mapVetoAdmin.orderModeCustom).getAttribute("aria-pressed")).toBe("true");
  });

  it("saves preset bracket with a sequence matching the stage's best-of", async () => {
    upsertVetoConfig.mockResolvedValue({});
    // Stage 188 (Groups) runs Bo2 while the stored template is Bo3.
    listVetoConfigs.mockResolvedValue({
      configs: [{ ...TOURNAMENT_DEFAULT, id: 901, stage_id: 188, round: null }]
    });
    await mount();
    await settle();

    await act(async () => {
      buttonByText("Groups").click();
    });
    await settle();

    await act(async () => {
      buttonByText(en.mapVetoAdmin.save).click();
    });
    await settle();

    expect(upsertVetoConfig).toHaveBeenCalledTimes(1);
    const [, payload] = upsertVetoConfig.mock.calls[0] as [number, Record<string, unknown>];
    expect(payload.preset).toBe("bracket");
    // Bo2: two opening bans then a pick each, and no decider.
    expect(payload.sequence).toEqual(["ban_first", "ban_second", "pick_first", "pick_second"]);
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

    await act(async () => {
      buttonByText("Groups").click();
    });
    await settle();

    expect(text()).toContain(en.mapVetoAdmin.mismatchTitle);
    // A custom order deliberately wins, so saving stays available.
    expect(buttonByText(en.mapVetoAdmin.save).disabled).toBe(false);
  });
});

/**
 * ICU-rendered fragments. The raw message keys carry plural syntax that never
 * reaches the DOM, so these are the formatted forms for the counts each test
 * sets up — pinning the numbers, not just the prose.
 */
const SLOT_COUNT_HINT_TWO = "2 slots, one per map in the series";
const STAGE_SCOPE_WARNING_FIVE = "These slots apply to all 5 rounds of this stage";
const SLOT_COUNT_MISMATCH_THREE_TWO =
  "This level has 3 slots configured while the bracket now calls for 2 maps";

function pressed(label: string): string | null {
  return toggleByText(label).getAttribute("aria-pressed");
}

/** The single payload of the one save this test performed. */
function savedPayload(): Record<string, unknown> {
  expect(upsertVetoConfig).toHaveBeenCalledTimes(1);
  const [, payload] = upsertVetoConfig.mock.calls[0] as [number, Record<string, unknown>];
  return payload;
}

/** The message naming one underfilled slot, as the validation list renders it. */
function tooFewCandidates(slot: number): string {
  return en.mapVetoAdmin.validation.slotTooFewCandidates.replace("{slot}", String(slot));
}

/** Enter slot mode on round 1 of Groups: gate open, two cards, nothing stored. */
async function openEmptySlotEditor() {
  await mount();
  await settle();
  await selectGroupsRound1();
  await click(toggleByText(en.mapVetoAdmin.poolShapeSlots));
}

describe("TournamentMapVetoTab pool shape", () => {
  it("opens a flat config in pool shape, offering the step-order group", async () => {
    await mount();
    await settle();

    expect(pressed(en.mapVetoAdmin.poolShapeFlat)).toBe("true");
    expect(pressed(en.mapVetoAdmin.poolShapeSlots)).toBe("false");
    // Step order belongs to the flat shape only.
    expect(text()).toContain(en.mapVetoAdmin.orderModeTitle);
    expect(text()).toContain(en.mapVetoAdmin.poolDescription);
    expect(text()).not.toContain(en.mapVetoAdmin.slotsDescription);
  });

  it("opens a slot-mode config in slot shape, hiding the flat pool and the step order", async () => {
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();
    await selectGroupsRound1();

    expect(pressed(en.mapVetoAdmin.poolShapeSlots)).toBe("true");
    expect(pressed(en.mapVetoAdmin.poolShapeFlat)).toBe("false");
    expect(text()).toContain(en.mapVetoAdmin.slotsDescription);
    // A flat pool grid here would collect selections the slot-mode payload
    // discards, and a step-order choice cannot coexist with slots at all.
    expect(text()).not.toContain(en.mapVetoAdmin.poolDescription);
    expect(text()).not.toContain(en.mapVetoAdmin.orderModeTitle);
    // Every tile on screen belongs to a slot card: a flat tile's accessible name
    // has two segments, a slot tile's three.
    const flatTiles = [...container.querySelectorAll("button[aria-pressed][aria-label]")].filter(
      (element) => (element.getAttribute("aria-label") ?? "").split(",").length === 2
    );
    expect(flatTiles).toEqual([]);
  });

  it("preserves the slot draft across a pool-shape toggle", async () => {
    upsertVetoConfig.mockResolvedValue({});
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();
    await selectGroupsRound1();

    // Slot 1's candidates are ids 7, 1, 4 in play order.
    expect(slotSelected(1)).toEqual(["Antarctic Peninsula", "Blizzard World", "Circuit Royal"]);

    await click(toggleByText(en.mapVetoAdmin.poolShapeFlat));
    expect(pressed(en.mapVetoAdmin.poolShapeFlat)).toBe("true");
    expect(text()).toContain(en.mapVetoAdmin.orderModeTitle);

    await click(toggleByText(en.mapVetoAdmin.poolShapeSlots));
    expect(pressed(en.mapVetoAdmin.poolShapeSlots)).toBe("true");
    expect(slotSelected(1)).toEqual(["Antarctic Peninsula", "Blizzard World", "Circuit Royal"]);

    // The payload is where the candidate ORDER survives too: the tiles render in
    // catalogue order whatever the draft says.
    await click(buttonByText(en.mapVetoAdmin.save));
    expect(savedPayload().slots).toEqual(SLOT_DRAFT);
  });

  it("preserves the flat pool selection across a pool-shape toggle", async () => {
    await mount();
    await settle();
    // Round 1 of Groups has no config of its own, so the pool seeds to the whole
    // catalogue — and the gate opens there, which the tournament default's does not.
    await selectGroupsRound1();

    const before = selectedTiles();
    expect(before).toContain("Busan");
    await click(mapTile("Busan"));
    expect(selectedTiles()).not.toContain("Busan");

    await click(toggleByText(en.mapVetoAdmin.poolShapeSlots));
    await click(toggleByText(en.mapVetoAdmin.poolShapeFlat));

    expect(selectedTiles()).not.toContain("Busan");
    expect(selectedTiles()).toHaveLength(before.length - 1);
  });

  it("saves a slot config as slots, with the flat fields empty and the rotation kept", async () => {
    upsertVetoConfig.mockResolvedValue({});
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();
    await selectGroupsRound1();

    await click(buttonByText(en.mapVetoAdmin.save));

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

    await click(buttonByText(en.mapVetoAdmin.save));

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
    await selectGroupsRound1();
    // A new level seeds the pool to the whole catalogue, so the flat fields hold
    // real content the shape switch has to drop.
    expect(selectedTiles()).toHaveLength(catalogue().length);

    await click(toggleByText(en.mapVetoAdmin.poolShapeSlots));
    for (const [position, names] of [
      [1, ["Busan", "Ilios"]],
      [2, ["Dorado", "Havana"]]
    ] as const) {
      for (const name of names) await click(slotTile(position, name));
    }
    await click(buttonByText(en.mapVetoAdmin.save));

    const payload = savedPayload();
    expect(payload.mode).toBe("slots");
    // Both are 422s in slot mode, and the pool selection is still in state.
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
    await selectGroupsRound1();

    await click(toggleByText(en.mapVetoAdmin.poolShapeFlat));
    // A slot config carries no flat pool, so the form has nothing to save until
    // maps are picked. Five, so the click order is visible in the payload.
    for (const name of ["Busan", "Dorado", "Havana", "Ilios", "Midtown"]) {
      await click(mapTile(name));
    }

    await click(buttonByText(en.mapVetoAdmin.save));

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
    expect(text()).toContain(en.mapVetoAdmin.poolShapeSlotsUnavailableTournament);
    // Disabled with its reason, never absent: silent absence reads as "the
    // feature does not exist".
    expect(toggleByText(en.mapVetoAdmin.poolShapeFlat).disabled).toBe(false);

    await click(toggleByText(en.mapVetoAdmin.poolShapeSlots));
    expect(pressed(en.mapVetoAdmin.poolShapeFlat)).toBe("true");
    expect(text()).not.toContain(en.mapVetoAdmin.slotsDescription);
  });

  it("disables slot mode with its reason at a stage whose rounds play different lengths", async () => {
    await mount();
    await settle();
    // Playoffs overrides its final round, so the stage has no single best-of.
    await click(buttonByText("Playoffs"));

    expect(toggleByText(en.mapVetoAdmin.poolShapeSlots).disabled).toBe(true);
    // Distinct copy per cause: "choose a single round" is actionable here, and
    // the tournament-level reason would send the organizer somewhere useless.
    expect(text()).toContain(en.mapVetoAdmin.poolShapeSlotsUnavailableStage);
    expect(text()).not.toContain(en.mapVetoAdmin.poolShapeSlotsUnavailableTournament);
  });

  it("opens slot mode at a stage whose rounds all play the same length, warning that one config covers them all", async () => {
    await mount();
    await settle();
    // Groups is Bo2 throughout, so the gate passes — and that is the trap the
    // warning exists for: one shared config for five rounds that each want one.
    await click(buttonByText("Groups"));

    expect(toggleByText(en.mapVetoAdmin.poolShapeSlots).disabled).toBe(false);
    expect(text()).not.toContain(en.mapVetoAdmin.poolShapeSlotsUnavailableStage);
    expect(text()).not.toContain(en.mapVetoAdmin.poolShapeSlotsUnavailableTournament);

    await click(toggleByText(en.mapVetoAdmin.poolShapeSlots));
    expect(pressed(en.mapVetoAdmin.poolShapeSlots)).toBe("true");
    expect(text()).toContain(STAGE_SCOPE_WARNING_FIVE);
    // A warning, not a block: the slot cards are still there to fill.
    expect(slotVisibleMaps(1)).toHaveLength(catalogue().length);
  });

  it("opens slot mode at a single round, with one card per map and no stage-scope warning", async () => {
    await openEmptySlotEditor();

    expect(pressed(en.mapVetoAdmin.poolShapeSlots)).toBe("true");
    expect(text()).not.toContain(STAGE_SCOPE_WARNING_FIVE);
    // Bo2, so two cards — derived from the bracket, with no control to change it.
    expect(text()).toContain(SLOT_COUNT_HINT_TWO);
    expect(slotCard(2)).toBeTruthy();
    expect(() => slotCard(3)).toThrow();
  });
});

describe("TournamentMapVetoTab slot editor", () => {
  it("filters one card to a gamemode and selects exactly those maps, leaving its neighbour alone", async () => {
    upsertVetoConfig.mockResolvedValue({});
    await openEmptySlotEditor();

    await click(slotButton(1, "Control (3)"));
    expect(slotVisibleMaps(1)).toEqual(["Antarctic Peninsula", "Busan", "Ilios"]);
    // The filter belongs to the card, not to the form: a group round is
    // gamemode-homogeneous per slot, not per config.
    expect(slotVisibleMaps(2)).toHaveLength(catalogue().length);

    await click(slotButton(1, en.mapVetoAdmin.poolSelectAll));
    expect(slotSelected(1)).toEqual(["Antarctic Peninsula", "Busan", "Ilios"]);
    expect(slotSelected(2)).toEqual([]);
    expect(slotButton(1, en.mapVetoAdmin.poolSelectAll).disabled).toBe(true);

    // Two Escort maps in slot 2, so the two cards end at different lengths and
    // neither count can stand in for the other.
    await click(slotTile(2, "Dorado"));
    await click(slotTile(2, "Havana"));
    await click(buttonByText(en.mapVetoAdmin.save));

    expect(savedPayload().slots).toEqual([
      { candidates: [1, 2, 3], reserve_map_id: null },
      { candidates: [8, 9], reserve_map_id: null }
    ]);
  });

  it("disables save and names the slot that has too few candidates", async () => {
    await openEmptySlotEditor();

    // Both cards start empty and both are named, so a check that reports only
    // the first failure cannot pass this.
    expect(text()).toContain(tooFewCandidates(1));
    expect(text()).toContain(tooFewCandidates(2));
    expect(buttonByText(en.mapVetoAdmin.save).disabled).toBe(true);

    await click(slotTile(1, "Busan"));
    await click(slotTile(1, "Ilios"));
    await click(slotTile(2, "Dorado"));

    // Slot 1 is legal, slot 2 is one short: only slot 2 is named, so the message
    // cannot be a fixed string that happens to read correctly.
    expect(text()).not.toContain(tooFewCandidates(1));
    expect(text()).toContain(tooFewCandidates(2));
    expect(buttonByText(en.mapVetoAdmin.save).disabled).toBe(true);

    await click(slotTile(2, "Havana"));
    expect(text()).not.toContain(tooFewCandidates(2));
    expect(buttonByText(en.mapVetoAdmin.save).disabled).toBe(false);
  });

  it("finds each map the regulation spells differently from the catalogue", async () => {
    await openEmptySlotEditor();
    const filter = () => slotCard(1).querySelector("input") as HTMLInputElement;

    // Each query differs from the catalogue name on one axis of the normalized
    // comparison: a trailing suffix, case, a diacritic, and the apostrophe.
    for (const [query, expected] of [
      ["peninsular", "Antarctic Peninsula"],
      ["shambali", "Shambali Monastery"],
      ["Paraiso", "Paraíso"],
      ["King's Row", "King’s Row"]
    ] as const) {
      await type(filter(), query);
      expect(slotVisibleMaps(1)).toEqual([expected]);
      // The query is the card's, so its neighbour still offers everything.
      expect(slotVisibleMaps(2)).toHaveLength(catalogue().length);
    }
  });

  it("names the query that matched nothing instead of showing an empty grid", async () => {
    await openEmptySlotEditor();

    await type(slotCard(1).querySelector("input") as HTMLInputElement, "zzz");
    expect(slotVisibleMaps(1)).toEqual([]);
    expect(slotCard(1).textContent ?? "").toContain(
      en.mapVetoAdmin.slotNameFilterEmpty.replace("{query}", "zzz")
    );
  });

  it("shows each slot's gamemode composition", async () => {
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();
    await selectGroupsRound1();

    // Slot 1 is one map from each of three modes — the cross-mode mistake the
    // chips exist to make visible without counting tiles. The counts cannot be
    // confused with the gamemode filter's, which reports the whole catalogue.
    const cardOne = slotCard(1).textContent ?? "";
    expect(cardOne).toContain("Control (1)");
    expect(cardOne).toContain("Escort (1)");
    expect(cardOne).toContain("Hybrid (1)");

    // Slot 2 holds Eichenwalde and Ilios: no Escort candidate at all.
    const cardTwo = slotCard(2).textContent ?? "";
    expect(cardTwo).toContain("Control (1)");
    expect(cardTwo).toContain("Hybrid (1)");
    expect(cardTwo).not.toContain("Escort (1)");
  });

  it("never offers a slot's own candidates as its reserve", async () => {
    upsertVetoConfig.mockResolvedValue({});
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();
    await selectGroupsRound1();

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
    await click(buttonByText(en.mapVetoAdmin.save));
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
    await selectGroupsRound1();

    // Slot 2 reserves Havana (id 9). Adding Havana there makes the replay map
    // the very map that drew, which the upsert refuses.
    await click(slotTile(2, "Havana"));
    await click(buttonByText(en.mapVetoAdmin.save));

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
    await selectGroupsRound1();

    // The stored config really is custom, so `isCustom` is true when the shape
    // flips. Without this the assertion below would hold for the wrong reason:
    // a bracket-preset fixture never reaches the guard at all.
    expect(pressed(en.mapVetoAdmin.orderModeCustom)).toBe("true");

    await click(toggleByText(en.mapVetoAdmin.poolShapeSlots));
    for (const [position, names] of [
      [1, ["Busan", "Ilios"]],
      [2, ["Dorado", "Havana"]]
    ] as const) {
      for (const name of names) await click(slotTile(position, name));
    }
    await click(buttonByText(en.mapVetoAdmin.save));

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
    await selectGroupsRound1();

    // Three stored slots against a Bo2 round: both numbers named, and the third
    // slot has no card because the bracket does not play it.
    expect(text()).toContain(SLOT_COUNT_MISMATCH_THREE_TWO);
    expect(() => slotCard(3)).toThrow();
  });

  it("chooses who bans first, and keeps the choice on the wire", async () => {
    upsertVetoConfig.mockResolvedValue({});
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();
    await selectGroupsRound1();

    // The fixture stores "alternate", so the control opens on it.
    expect(pressed(en.mapVetoAdmin.firstBanAlternate)).toBe("true");
    expect(pressed(en.mapVetoAdmin.firstBanFixed)).toBe("false");

    await click(toggleByText(en.mapVetoAdmin.firstBanFixed));
    await click(buttonByText(en.mapVetoAdmin.save));
    expect(savedPayload().first_ban_rotation).toBe("fixed");
  });
});
