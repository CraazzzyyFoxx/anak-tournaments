// @vitest-environment happy-dom
//
// The editor's job is to make an unwritable config unwritable, and a written
// one mean what it says. Three claims are pinned here:
//
//   1. nothing is typed. The previous editor asked for stage ids, catalogue item
//      ids and step tokens as comma-separated free text, so a valid config
//      required knowing three numbering schemes the page never showed. The only
//      text field left is the turn timer, and it says what empty means;
//   2. an invalid config cannot be sent. Save stays visible but inert while a
//      rejection the server would return still stands, with the reason on screen;
//   3. a stored custom order survives a round trip. `preset` and `sequence` used
//      to drift apart silently, and a hand-authored order was discarded by the
//      engine without the organizer ever being told.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type { PickBanConfig, Stage } from "@/types/tournament.types";

import { PickBanConfigsTab } from "./PickBanConfigsTab";
import type { PickBanScopeEncounter } from "./pickBanConfig.helpers";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const listConfigs = vi.fn();
const upsertConfig = vi.fn();
const deleteConfig = vi.fn();
const getMaps = vi.fn();
const getHeroes = vi.fn();

vi.mock("@/services/pickBan.service", () => ({
  default: {
    listConfigs: (...args: unknown[]) => listConfigs(...args),
    upsertConfig: (...args: unknown[]) => upsertConfig(...args),
    deleteConfig: (...args: unknown[]) => deleteConfig(...args),
  },
}));

vi.mock("@/services/map.service", () => ({
  default: { getAll: (...args: unknown[]) => getMaps(...args) },
}));

vi.mock("@/services/hero.service", () => ({
  default: { getAll: (...args: unknown[]) => getHeroes(...args) },
}));

vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() },
}));

const MAPS = ["Busan", "Ilios", "King's Row", "Numbani", "Route 66", "Colosseo"].map(
  (name, index) => ({
    id: index + 1,
    name,
    image_path: `/maps/${index + 1}.png`,
    in_competitive: true,
    gamemode: { id: 1, name: "Control" },
  })
);

const STAGES = [
  {
    id: 10,
    tournament_id: 84,
    name: "Group stage",
    description: null,
    stage_type: "round_robin",
    max_rounds: 3,
    advance_count: null,
    split_lower_bracket: false,
    order: 1,
    is_active: true,
    is_completed: false,
    settings_json: { best_of: { default: 3 } },
    challonge_id: null,
    challonge_slug: null,
    items: [],
  },
  {
    id: 11,
    tournament_id: 84,
    name: "Playoffs",
    description: null,
    stage_type: "single_elimination",
    max_rounds: 2,
    advance_count: null,
    split_lower_bracket: false,
    order: 2,
    is_active: false,
    is_completed: false,
    settings_json: { best_of: { default: 5 } },
    challonge_id: null,
    challonge_slug: null,
    items: [],
  },
] as unknown as Stage[];

const ENCOUNTERS: PickBanScopeEncounter[] = [
  { stage_id: 10, round: 1, best_of: 3 },
  { stage_id: 10, round: 2, best_of: 3 },
];

const CUSTOM_MAP_CONFIG: PickBanConfig = {
  id: 7,
  tournament_id: 84,
  kind: "map",
  stage_id: 11,
  round: null,
  mode: "pool",
  first_pick_rule: "higher_seed",
  first_ban_rotation: "alternate",
  turn_timer_seconds: 45,
  preset: "custom",
  sequence: ["ban_first", "ban_second", "pick_first", "decider"],
  no_repeat_scope: "encounter",
  unique_attribute_per_side_per_round: null,
  allow_protect: false,
  item_ids: [1, 2, 3, 4, 5],
  slots: [],
};

let container: HTMLDivElement;
let root: Root;

async function settle(times = 12) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

async function mount(configs: PickBanConfig[] = []) {
  listConfigs.mockResolvedValue({ configs });
  getMaps.mockResolvedValue({ results: MAPS });
  getHeroes.mockResolvedValue({ results: [] });

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <PickBanConfigsTab
            tournamentId={84}
            stages={STAGES}
            encounters={ENCOUNTERS}
            canManage
          />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  await settle();
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    (element as HTMLElement).click();
  });
  await settle(4);
}

/** Every button in the document, portalled popovers included. */
function byName(name: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("button")].filter(
    (element) =>
      (element.getAttribute("aria-label") ?? "").trim() === name ||
      (element.textContent ?? "").trim() === name
  );
}

function only(name: string): HTMLElement {
  const matches = byName(name);
  if (matches.length === 0) throw new Error(`no control named "${name}"`);
  return matches[0];
}

/**
 * One catalogue row of an open picker. A row reads "Busan" then its game mode,
 * so it is addressed by its name cell rather than by the row's whole text.
 */
function option(name: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>("[cmdk-item]")].find((item) =>
    [...item.querySelectorAll("span")].some(
      (cell) => (cell.textContent ?? "").trim() === name
    )
  );
  if (!found) throw new Error(`no catalogue row named "${name}"`);
  return found;
}

/** Which editor heading `editor()` looks for; create and edit differ. */
let editorHeading = "New map rules";

/** The editor, addressed by its heading. */
function editor(): HTMLElement {
  const heading = [...container.querySelectorAll("h4")].find(
    (element) => (element.textContent ?? "").trim() === editorHeading
  );
  const found = heading?.closest("div.border-dashed");
  if (!(found instanceof HTMLElement)) throw new Error("editor is not open");
  return found;
}

/** Turn a numeric field's value the way React's synthetic layer sees it. */
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

beforeEach(() => {
  vi.clearAllMocks();
  if (root) {
    // Unmounting rather than clearing the body: the picker's content is
    // portalled, and React still owns those nodes.
    act(() => root.unmount());
    container.remove();
  }
  editorHeading = "New map rules";
  upsertConfig.mockResolvedValue({});
});

describe("PickBanConfigsTab asks for nothing an organizer has to look up", () => {
  it("offers one text field, the turn timer, and says what leaving it empty does", async () => {
    await mount();
    await click(only("Add map rules"));

    const inputs = [...editor().querySelectorAll<HTMLInputElement>("input")];
    expect(inputs).toHaveLength(1);

    const timer = inputs[0];
    const label = editor().querySelector<HTMLLabelElement>(`label[for="${timer.id}"]`);
    expect(label?.textContent).toBe("Turn timer");

    // The hint is the ask: an empty timer is not an unset field, it is "no limit".
    const hint = document.getElementById(timer.getAttribute("aria-describedby") ?? "");
    expect(hint?.textContent).toContain("Leave it empty for no time limit");
    expect(timer.placeholder).toBe("No limit");
  });

  it("names every icon-only control, including the row it deletes", async () => {
    await mount([CUSTOM_MAP_CONFIG]);

    const unnamed = [...container.querySelectorAll("button")].filter(
      (button) =>
        (button.textContent ?? "").trim() === "" && button.getAttribute("aria-label") == null
    );
    expect(unnamed).toEqual([]);
    expect(byName("Delete the rules for Playoffs — all rounds")).not.toHaveLength(0);
  });

  it("scopes rules by name, starting at the whole tournament", async () => {
    await mount();
    await click(only("Add map rules"));

    const scope = editor().querySelector<HTMLElement>('[id$="-scope"]');
    expect(scope?.textContent).toBe("Whole tournament");
    // The round picker cannot mean anything yet, and says so instead of
    // accepting a number the server would reject.
    const round = editor().querySelector<HTMLElement>('[id$="-round"]');
    expect(round?.getAttribute("data-disabled")).not.toBeNull();
  });
});

describe("PickBanConfigsTab will not send a config the server rejects", () => {
  it("keeps save inert with the reason on screen until the pool has candidates", async () => {
    await mount();
    await click(only("Add map rules"));

    const save = only("Save rules");
    expect(save.getAttribute("disabled")).not.toBeNull();
    expect(editor().textContent).toContain("Add at least one candidate to the pool.");

    await click(only("Add maps"));
    await click(option("Busan"));
    await click(option("Ilios"));
    await click(option("King's Row"));

    expect(editor().textContent).not.toContain("Add at least one candidate to the pool.");
    expect(only("Save rules").getAttribute("disabled")).toBeNull();
  });

  it("sends the pool in pick order, with a generated order and no turn limit", async () => {
    await mount();
    await click(only("Add map rules"));
    await click(only("Add maps"));
    await click(option("Ilios"));
    await click(option("Busan"));
    await click(option("Numbani"));
    await click(only("Save rules"));

    expect(upsertConfig).toHaveBeenCalledTimes(1);
    const [tournamentId, body] = upsertConfig.mock.calls[0];
    expect(tournamentId).toBe(84);
    expect(body.kind).toBe("map");
    expect(body.item_ids).toEqual([2, 1, 4]);
    expect(body.stage_id).toBeNull();
    expect(body.round).toBeNull();
    expect(body.turn_timer_seconds).toBeNull();
    expect(body.preset).not.toBe("custom");
    expect(body.sequence.length).toBeGreaterThan(0);
  });

  it("sends the timer as a number once one is typed", async () => {
    await mount();
    await click(only("Add map rules"));
    await click(only("Add maps"));
    await click(option("Busan"));
    await click(option("Ilios"));
    await type(editor().querySelector<HTMLInputElement>("input")!, "30");
    await click(only("Save rules"));

    expect(upsertConfig.mock.calls[0][1].turn_timer_seconds).toBe(30);
  });
});

describe("PickBanConfigsTab keeps a stored custom order", () => {
  it("reopens it as custom and saves the same steps back", async () => {
    await mount([CUSTOM_MAP_CONFIG]);
    await click(only("Edit"));

    editorHeading = "Edit map rules";
    expect(editor().textContent).toContain("Custom");

    await click(only("Save rules"));

    const body = upsertConfig.mock.calls[0][1];
    // The regression that made the old editor lie: a custom sequence saved
    // without `preset: "custom"` is regenerated from `best_of` and discarded.
    expect(body.preset).toBe("custom");
    expect(body.sequence).toEqual(["ban_first", "ban_second", "pick_first", "decider"]);
    expect(body.stage_id).toBe(11);
    expect(body.turn_timer_seconds).toBe(45);
    expect(body.no_repeat_scope).toBe("encounter");
    expect(body.first_ban_rotation).toBe("alternate");
  });
});
