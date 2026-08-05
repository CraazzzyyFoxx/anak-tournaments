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
  preset: "bo3",
  first_pick_rule: "higher_seed",
  turn_timer_seconds: 30,
  sequence: ["ban_first", "ban_second", "pick_first", "pick_second", "decider"],
  map_ids: [1, 4, 7, 2, 5]
};

// Groups runs Bo2, so a config carrying a Bo3 template disagrees with the
// bracket — which is exactly the divergence the bracket now settles.
const STAGES = [
  stage(188, "Groups", 0, 5, { default: 2 }),
  stage(189, "Playoffs", 1, 3, { default: 3, final: 5 })
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
  /** The mode toggles are the only aria-pressed controls without an aria-label. */
  function modeButton(label: string): HTMLButtonElement {
    const match = [...container.querySelectorAll("button[aria-pressed]")].find(
      (element) => (element.textContent ?? "").includes(label)
    );
    if (!match) throw new Error(`no mode button for ${JSON.stringify(label)}`);
    return match as HTMLButtonElement;
  }

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
    expect(modeButton(en.mapVetoAdmin.orderModeBracket).getAttribute("aria-pressed")).toBe("true");
    expect(modeButton(en.mapVetoAdmin.orderModeCustom).getAttribute("aria-pressed")).toBe("false");
  });

  it("opens an explicitly custom config in custom mode", async () => {
    listVetoConfigs.mockResolvedValue({
      configs: [{ ...TOURNAMENT_DEFAULT, preset: "custom" }]
    });
    await mount();
    await settle();

    expect(modeButton(en.mapVetoAdmin.orderModeCustom).getAttribute("aria-pressed")).toBe("true");
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
