// @vitest-environment happy-dom
//
// The teams column replaced a `<pre>{JSON.stringify(result_json)}</pre>`, so
// what is pinned here is that it actually reads the payload, and that the two
// writes it owns cannot fire by accident:
//
//  1. seats render per team with the rating the solver assigned, not raw JSON;
//  2. the solver returns many equally-scored options and the pager walks them
//     without re-running the balance — the index is owned by the page, so the
//     panel reports the move instead of keeping its own copy;
//  3. the index is clamped, so a shorter result cannot point past the end;
//  4. Balance is refused while nobody is checked in the lineup, which is the
//     `empty_lineup` 422 the server would raise;
//  5. recording a result is a deliberate click, repeatable, and carries the
//     page's variant index; closing the mix is a separate, explicit action;
//  6. a read-only viewer gets no writes but still sees teams;
//  7. the verdict pills sit inside the captured block with the team card, so
//     "Copy image" exports them together, while "Show lobby"/"Copy image"/
//     "Copy battletags" stay outside it -- exporting its own toolbar would be
//     a screenshot of a screenshot button;
//  8. every seat is a drag source and drop target, gated on both write access
//     and the page actually offering a swap handler -- a read-only viewer or
//     a page with nothing to call must not present drag affordance for a
//     write that cannot happen.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CustomGame, CustomGameMatch } from "@/services/custom-game.service";

import { PickupTeamsPanel } from "./PickupTeamsPanel";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/PlayerRoleIcon", () => ({ default: () => null }));
vi.mock("@/components/DivisionIcon", () => ({ default: () => null }));
// Drag itself is not what this pins, and dnd-kit resolves its own React copy
// under pnpm (see PickupPlayerSheet.behavior.test.tsx), so it renders inertly
// here: children mount as plain DOM, no real drag/drop wiring.
const dndSpies = vi.hoisted(() => ({
  useDraggable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    isDragging: false,
  })),
  useDroppable: vi.fn(() => ({ setNodeRef: () => {}, isOver: false })),
}));
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => children,
  DragOverlay: () => null,
  PointerSensor: class {},
  useSensor: () => null,
  useSensors: () => [],
  useDraggable: dndSpies.useDraggable,
  useDroppable: dndSpies.useDroppable,
}));

const onBalance = vi.fn();
const onVariantIndexChange = vi.fn();
const onRecordOutcome = vi.fn();
const onMapIdChange = vi.fn();
const onCloseMix = vi.fn();
const onShowBoard = vi.fn();
const onCopyBattleTags = vi.fn();
const onRenameTeam = vi.fn();
const onSwapSeats = vi.fn();

function variant(offset: number) {
  return {
    teams: [
      {
        id: 1,
        average_mmr: 3000 + offset,
        roster: {
          Tank: [{ uuid: "7", name: "karin", assigned_rating: 2900 + offset, role_preferences: ["Tank"] }],
          Damage: [
            { uuid: "8", name: "DemonDimon", assigned_rating: 4100, role_preferences: ["Tank", "Damage"] },
          ],
        },
      },
      {
        id: 2,
        average_mmr: 2950,
        roster: { Support: [{ uuid: "9", name: "Tolgrn", assigned_rating: 3450 }] },
      },
    ],
    statistics: { composite_score: 0.87, mmr_std_dev: 12.34, off_role_count: 1 },
    benched_players: [{ uuid: "10", name: "Egor" }],
  };
}

function game(overrides: Partial<CustomGame> = {}): CustomGame {
  return {
    id: 3,
    workspace_id: 7,
    host_user_id: 9,
    co_hosts: [],
    name: "Thursday scrim",
    status: "balanced",
    config_json: null,
    result_json: { variants: [variant(0), variant(100), variant(200)] },
    outcome_json: null,
    players: [],
    ...overrides,
  };
}

function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

async function mount(
  current: CustomGame | undefined,
  props: {
    canWrite?: boolean;
    activeCount?: number;
    variantIndex?: number;
    hasMix?: boolean;
    omitSwapSeats?: boolean;
    maps?: { id: number; name: string }[];
    mapId?: number | null;
    matches?: CustomGameMatch[];
  } = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <PickupTeamsPanel
        canWrite={props.canWrite ?? true}
        gamesLoading={false}
        gamesError={false}
        onRetryGames={vi.fn()}
        game={current}
        gameLoading={false}
        hasMix={props.hasMix ?? current != null}
        balancing={false}
        activeCount={props.activeCount ?? 10}
        onBalance={onBalance}
        variantIndex={props.variantIndex ?? 0}
        onVariantIndexChange={onVariantIndexChange}
        recordingOutcome={false}
        onRecordOutcome={onRecordOutcome}
        matches={props.matches ?? []}
        maps={props.maps ?? []}
        mapId={props.mapId ?? null}
        onMapIdChange={onMapIdChange}
        closingMix={false}
        onCloseMix={onCloseMix}
        onRenameTeam={onRenameTeam}
        onSwapSeats={props.omitSwapSeats ? undefined : onSwapSeats}
        onShowBoard={onShowBoard}
        onCopyBattleTags={onCopyBattleTags}
      />,
    );
  });
  await act(async () => {
    await tick();
  });
  return container;
}

function click(node: Element | null | undefined) {
  if (!node) throw new Error("Expected a clickable node");
  return act(async () => {
    node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
  });
}

function byName(scope: ParentNode, name: string) {
  return [...scope.querySelectorAll("button")].find((node) => node.textContent?.trim() === name) ?? null;
}

function inputByLabel(scope: ParentNode, label: string) {
  return scope.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
}

// React overrides the input's own `value` setter to track changes; assigning
// through it makes React think nothing changed, so write via the prototype
// setter instead (mirrors InlineEditText.behavior.test.tsx).
const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

async function typeInto(field: HTMLInputElement, value: string) {
  await act(async () => {
    nativeValueSetter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pagerLabel(scope: ParentNode) {
  return scope.querySelector('[role="status"]')?.textContent?.trim();
}

beforeEach(() => {
  document.body.innerHTML = "";
  onBalance.mockReset();
  onVariantIndexChange.mockReset();
  onRecordOutcome.mockReset();
  onMapIdChange.mockReset();
  onCloseMix.mockReset();
  onShowBoard.mockReset();
  onCopyBattleTags.mockReset();
  onRenameTeam.mockReset();
  onSwapSeats.mockReset();
  dndSpies.useDraggable.mockClear();
  dndSpies.useDroppable.mockClear();
});

describe("PickupTeamsPanel", () => {
  it("renders seats and ratings from the payload instead of raw JSON", async () => {
    const scope = await mount(game());

    expect(scope.textContent).toContain("karin");
    expect(scope.textContent).toContain("2900");
    expect(scope.textContent).toContain("Tolgrn");
    expect(scope.textContent).toContain("3450");
    expect(scope.textContent).not.toContain("result_json");
    expect(scope.textContent).not.toContain('"uuid"');
  });

  it("shows the option's own verdict and who it left out", async () => {
    const scope = await mount(game());

    expect(scope.textContent).toContain("0.87");
    expect(scope.textContent).toContain("12.3");
    expect(scope.textContent).toContain("Egor");
  });

  it("captures the verdict pills with the teams block, not the action buttons beside it", async () => {
    const scope = await mount(game());

    const captured = scope.querySelector('[data-testid="teams-capture"]');
    expect(captured).not.toBeNull();
    expect(captured?.textContent).toContain("0.87");
    expect(captured?.textContent).toContain("karin");
    expect(captured?.textContent).not.toContain("Show lobby");
    expect(captured?.textContent).not.toContain("Copy image");
    expect(captured?.textContent).not.toContain("Copy battletags");
  });

  it("reports a pager move to the page instead of keeping its own index", async () => {
    const scope = await mount(game());

    expect(pagerLabel(scope)).toBe("1 / 3");
    expect(byName(scope, "Previous balance option")?.hasAttribute("disabled")).toBe(true);

    await click(byName(scope, "Next balance option"));

    expect(onVariantIndexChange).toHaveBeenCalledWith(1);
    expect(onBalance).not.toHaveBeenCalled();
  });

  it("renders the option the page selected", async () => {
    const scope = await mount(game(), { variantIndex: 2 });

    expect(pagerLabel(scope)).toBe("3 / 3");
    expect(scope.textContent).toContain("3100");
  });

  it("clamps an index left pointing past a shorter result", async () => {
    const scope = await mount(game({ result_json: { variants: [variant(0)] } }), { variantIndex: 7 });

    // One option left: the pager is gone and the first option is on screen.
    expect(pagerLabel(scope)).toBeUndefined();
    expect(scope.textContent).toContain("karin");
  });

  it("offers the empty state for a mix that has not been balanced", async () => {
    const scope = await mount(game({ status: "draft", result_json: null }));

    expect(scope.textContent).toContain("No teams yet");
    expect(byName(scope, "Balance teams")).not.toBeNull();
  });

  it("refuses to balance an empty lineup and says why", async () => {
    const scope = await mount(game({ status: "draft", result_json: null }), { activeCount: 0 });

    expect(byName(scope, "Balance teams")?.hasAttribute("disabled")).toBe(true);
    expect(scope.textContent).toContain("Check at least one player in the lobby");
  });

  it("balances on request when the lineup is not empty", async () => {
    const scope = await mount(game({ status: "draft", result_json: null }));

    await click(byName(scope, "Balance teams"));

    expect(onBalance).toHaveBeenCalledTimes(1);
  });

  it("records a result only on a deliberate click, without closing the mix", async () => {
    const scope = await mount(game());

    expect(scope.textContent).toContain("Record who won");
    expect(onRecordOutcome).not.toHaveBeenCalled();

    await click(byName(scope, "Draw"));
    expect(onRecordOutcome).toHaveBeenCalledWith({ outcome: { winner: null }, variantIndex: 0, mapId: null });

    await click(byName(scope, "Team 2 win"));
    expect(onRecordOutcome).toHaveBeenLastCalledWith({
      outcome: { winner: 2 },
      variantIndex: 0,
      mapId: null,
    });
  });

  it("reports the page's variant index alongside a recorded result", async () => {
    const scope = await mount(game(), { variantIndex: 1 });

    await click(byName(scope, "Team 1 win"));
    expect(onRecordOutcome).toHaveBeenCalledWith({ outcome: { winner: 1 }, variantIndex: 1, mapId: null });
  });

  it("carries the page's selected map into a recorded result", async () => {
    const scope = await mount(game(), {
      maps: [{ id: 5, name: "King's Row" }],
      mapId: 5,
    });

    expect(scope.textContent).toContain("King's Row");

    await click(byName(scope, "Team 1 win"));
    expect(onRecordOutcome).toHaveBeenCalledWith({ outcome: { winner: 1 }, variantIndex: 0, mapId: 5 });
  });

  it("opens the map combobox and picks a map, notifying the page", async () => {
    const scope = await mount(game(), {
      maps: [
        { id: 5, name: "King's Row" },
        { id: 6, name: "Ilios" },
      ],
    });

    await click(byName(scope, "No map"));
    const option = [...document.body.querySelectorAll<HTMLElement>("[cmdk-item]")].find(
      (node) => node.textContent?.trim() === "Ilios",
    );
    await click(option);

    expect(onMapIdChange).toHaveBeenCalledWith(6);
  });

  it("lets the host close the mix independently of recording a result", async () => {
    const scope = await mount(game());

    await click(byName(scope, "Close mix"));
    expect(onCloseMix).toHaveBeenCalledTimes(1);
  });

  it("never persists a pressed state -- a completed mix's buttons are plain read-only controls", async () => {
    const scope = await mount(game({ status: "completed" }), { canWrite: false });

    expect(byName(scope, "Team 1 win")?.hasAttribute("aria-pressed")).toBe(false);
    expect(byName(scope, "Draw")?.hasAttribute("disabled")).toBe(true);
    expect(scope.textContent).not.toContain("Recorded. Log another match");
  });

  it("shows the configured points-per-win on the win buttons, never on Draw", async () => {
    const scope = await mount(game({ config_json: { points_per_win: 25 } }));

    expect(byName(scope, "Team 1 win +25")).not.toBeNull();
    expect(byName(scope, "Team 2 win +25")).not.toBeNull();
    expect(byName(scope, "Draw")).not.toBeNull();
  });

  it("omits the points hint once no rank-adjustment is configured", async () => {
    const scope = await mount(game());

    expect(byName(scope, "Team 1 win")).not.toBeNull();
  });

  it("renders the recorded match history the page hands it", async () => {
    const scope = await mount(game(), {
      matches: [
        {
          id: 2,
          home_team_name: "Wolves",
          away_team_name: "Bears",
          home_score: 1,
          away_score: 0,
          winner: 1,
          map_id: 5,
          map_name: "King's Row",
          map_image_path: null,
          recorded_by: 9,
          recorded_at: new Date().toISOString(),
        },
      ],
    });

    expect(scope.textContent).toContain("Match history");
    expect(scope.textContent).toContain("Wolves");
    expect(scope.textContent).toContain("Bears");
    expect(scope.textContent).toContain("King's Row");
  });

  it("hides the match history section until something has been recorded", async () => {
    const scope = await mount(game());

    expect(scope.textContent).not.toContain("Match history");
  });

  it("hands the fullscreen board and the tag copy to the page", async () => {
    const scope = await mount(game());

    await click(byName(scope, "Show lobby"));
    expect(onShowBoard).toHaveBeenCalledTimes(1);

    await click(byName(scope, "Copy battletags"));
    expect(onCopyBattleTags).toHaveBeenCalledTimes(1);
  });

  it("hides write controls for a read-only viewer but still shows the teams", async () => {
    const scope = await mount(game(), { canWrite: false });

    expect(byName(scope, "Balance teams")).toBeNull();
    expect(scope.textContent).toContain("karin");
    expect(pagerLabel(scope)).toBe("1 / 3");
  });

  it("separates no mix at all from a mix with no teams", async () => {
    const scope = await mount(undefined, { hasMix: false });

    expect(scope.textContent).toContain("No mixes yet");
    expect(scope.textContent).not.toContain("No teams yet");
  });

  it("lets the host rename a team through the pencil affordance", async () => {
    const scope = await mount(game());

    const pencils = [...scope.querySelectorAll('button[aria-label="Edit team name"]')];
    expect(pencils).toHaveLength(2);

    await click(pencils[0]);
    const field = inputByLabel(scope, "team name");
    expect(field?.value).toBe("Team 1");
    await typeInto(field as HTMLInputElement, "Wolves");
    await click(scope.querySelector('button[aria-label="Save team name"]'));

    expect(onRenameTeam).toHaveBeenCalledWith(0, "Wolves");
  });

  it("hides the rename pencil for a read-only viewer", async () => {
    const scope = await mount(game(), { canWrite: false });

    expect(scope.querySelectorAll('button[aria-label="Edit team name"]')).toHaveLength(0);
  });

  it("shows a host's saved team name instead of the computed default", async () => {
    const scope = await mount(game({ config_json: { team_names: { "0": "Wolves" } } }));

    expect(scope.textContent).toContain("Wolves");
    // The second team keeps its computed default; the win buttons pick up
    // the same override so the scoreline reads the same name as the column.
    expect(byName(scope, "Wolves win")).not.toBeNull();
    expect(byName(scope, "Team 2 win")).not.toBeNull();
  });

  it("wires every seat as a drag source and drop target for a host who can rebalance manually", async () => {
    await mount(game());

    // Every seat across both teams (3 in the fixture) is both draggable and
    // droppable, and none of them are disabled for a host with a swap handler.
    expect(dndSpies.useDraggable).toHaveBeenCalledTimes(3);
    expect(dndSpies.useDroppable).toHaveBeenCalledTimes(3);
    for (const call of dndSpies.useDraggable.mock.calls) {
      expect(call[0]).toMatchObject({ disabled: false });
    }
    for (const call of dndSpies.useDroppable.mock.calls) {
      expect(call[0]).toMatchObject({ disabled: false });
    }
  });

  it("disables seat dragging for a read-only viewer", async () => {
    await mount(game(), { canWrite: false });

    for (const call of dndSpies.useDraggable.mock.calls) {
      expect(call[0]).toMatchObject({ disabled: true });
    }
  });

  it("disables seat dragging when the page offers no swap handler", async () => {
    await mount(game(), { omitSwapSeats: true });

    for (const call of dndSpies.useDraggable.mock.calls) {
      expect(call[0]).toMatchObject({ disabled: true });
    }
  });
});
