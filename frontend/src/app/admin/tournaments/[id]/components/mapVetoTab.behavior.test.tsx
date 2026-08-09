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

const GAMEMODES: Record<string, number> = { Control: 4, Hybrid: 5, Escort: 2 };

/** Nine competitive maps across three gamemodes — ids 1..9. */
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
    ["Havana", "Escort"]
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
 *  - two slots against the Bo3 tournament default, so the slot count is never
 *    the same number as the bracket's best-of;
 *  - `first_ban_rotation` is "alternate", so a save that omits it reads back as
 *    the server's "fixed" default.
 */
const SLOT_CONFIG: MapVetoConfig = {
  ...TOURNAMENT_DEFAULT,
  id: 910,
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
 * Pool tiles are `aria-pressed` buttons whose accessible name is
 * `"{map}, {gamemode}"`. Preset buttons are also `aria-pressed` and also carry
 * an `aria-label`, so match on the map name rather than on the attributes.
 */
function mapTile(name: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button[aria-pressed][aria-label]")].find(
    (element) => (element.getAttribute("aria-label") ?? "").split(",")[0] === name
  );
  if (!match) throw new Error(`no pool tile for ${JSON.stringify(name)}`);
  return match as HTMLButtonElement;
}

function selectedTiles(): string[] {
  return [...container.querySelectorAll('button[aria-pressed="true"][aria-label]')]
    .map((element) => (element.getAttribute("aria-label") ?? "").split(",")[0])
    .filter((name) => MAP_NAMES[name])
    .sort();
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

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  // A fresh array every call: this is exactly the identity change that used to
  // re-run the seeding `useMemo` and wipe the form.
  getAll.mockImplementation(async () => ({
    page: 1,
    per_page: -1,
    total: 9,
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
    // The config selects 5 of 9 maps; seeding from the default would select 9.
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
        id: 10,
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

describe("TournamentMapVetoTab pool shape", () => {
  function pressed(label: string): string | null {
    return toggleByText(label).getAttribute("aria-pressed");
  }

  /** The single payload of the one save this test performed. */
  function savedPayload(): Record<string, unknown> {
    expect(upsertVetoConfig).toHaveBeenCalledTimes(1);
    const [, payload] = upsertVetoConfig.mock.calls[0] as [number, Record<string, unknown>];
    return payload;
  }

  async function click(button: HTMLButtonElement) {
    await act(async () => {
      button.click();
    });
    await settle(3);
  }

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

    expect(pressed(en.mapVetoAdmin.poolShapeSlots)).toBe("true");
    expect(pressed(en.mapVetoAdmin.poolShapeFlat)).toBe("false");
    expect(text()).toContain(en.mapVetoAdmin.slotsDescription);
    // A flat pool grid here would collect selections the slot-mode payload
    // discards, and a step-order choice cannot coexist with slots at all.
    expect(text()).not.toContain(en.mapVetoAdmin.poolDescription);
    expect(text()).not.toContain(en.mapVetoAdmin.orderModeTitle);
    expect(container.querySelectorAll("button[aria-pressed][aria-label]")).toHaveLength(0);
  });

  it("preserves the slot draft across a pool-shape toggle", async () => {
    upsertVetoConfig.mockResolvedValue({});
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();

    await click(toggleByText(en.mapVetoAdmin.poolShapeFlat));
    expect(pressed(en.mapVetoAdmin.poolShapeFlat)).toBe("true");
    expect(text()).toContain(en.mapVetoAdmin.orderModeTitle);

    await click(toggleByText(en.mapVetoAdmin.poolShapeSlots));
    expect(pressed(en.mapVetoAdmin.poolShapeSlots)).toBe("true");

    // The draft has no on-screen editor yet, so the save payload is where its
    // survival is observable: a discarded draft saves an empty slot list.
    await click(buttonByText(en.mapVetoAdmin.save));
    expect(savedPayload().slots).toEqual(SLOT_DRAFT);
  });

  it("preserves the flat pool selection across a pool-shape toggle", async () => {
    await mount();
    await settle();

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
    // The tournament default arrives with five maps and a five-step sequence,
    // so both fields hold real content the shape switch has to drop.
    expect(selectedTiles()).toHaveLength(5);

    await click(toggleByText(en.mapVetoAdmin.poolShapeSlots));
    await click(buttonByText(en.mapVetoAdmin.save));

    const payload = savedPayload();
    expect(payload.mode).toBe("slots");
    // Both are 422s in slot mode, and the pool selection is still in state.
    expect(payload.map_ids).toEqual([]);
    expect(payload.sequence).toEqual([]);
    expect(payload.slots).toEqual([]);
  });

  it("empties the slot list when a slot config is switched to pool shape", async () => {
    upsertVetoConfig.mockResolvedValue({});
    listVetoConfigs.mockResolvedValue({ configs: [SLOT_CONFIG] });
    await mount();
    await settle();

    await click(toggleByText(en.mapVetoAdmin.poolShapeFlat));
    // A slot config carries no flat pool, and the Bo3 default's five steps need
    // five maps before the form will enable a save at all.
    for (const name of ["Busan", "Dorado", "Havana", "Ilios", "Midtown"]) {
      await click(mapTile(name));
    }

    await click(buttonByText(en.mapVetoAdmin.save));

    const payload = savedPayload();
    expect(payload.mode).toBe("pool");
    // Click order, not id order: the pool order is persisted.
    expect(payload.map_ids).toEqual([2, 8, 9, 3, 6]);
    expect(payload.sequence).toEqual([
      "ban_first",
      "ban_second",
      "pick_first",
      "pick_second",
      "decider"
    ]);
    // The slot draft survives the toggle, so it must be emptied on the wire
    // rather than merely absent: a non-empty list here is a 422.
    expect(payload.slots).toEqual([]);
  });
});
