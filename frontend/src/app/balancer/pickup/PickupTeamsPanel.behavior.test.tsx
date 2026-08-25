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
//  5. recording a result is terminal, so it is a deliberate click and a recorded
//     mix renders its scoreline instead of three live buttons;
//  6. a read-only viewer and a terminal mix get no writes but still see teams.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CustomGame } from "@/services/custom-game.service";

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

const onBalance = vi.fn();
const onVariantIndexChange = vi.fn();
const onRecordOutcome = vi.fn();
const onShowBoard = vi.fn();
const onCopyBattleTags = vi.fn();

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
  props: { canWrite?: boolean; activeCount?: number; variantIndex?: number; hasMix?: boolean } = {},
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

function pagerLabel(scope: ParentNode) {
  return scope.querySelector('[role="status"]')?.textContent?.trim();
}

beforeEach(() => {
  document.body.innerHTML = "";
  onBalance.mockReset();
  onVariantIndexChange.mockReset();
  onRecordOutcome.mockReset();
  onShowBoard.mockReset();
  onCopyBattleTags.mockReset();
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

  it("records a result only on a deliberate click, and says it closes the mix", async () => {
    const scope = await mount(game());

    expect(scope.textContent).toContain("Recording a result closes the mix");
    expect(onRecordOutcome).not.toHaveBeenCalled();

    await click(byName(scope, "Draw"));
    expect(onRecordOutcome).toHaveBeenCalledWith({ winner: null });

    await click(byName(scope, "Team 2 win"));
    expect(onRecordOutcome).toHaveBeenLastCalledWith({ winner: 2 });
  });

  it("reads a recorded result back as the pressed scoreline", async () => {
    const scope = await mount(game({ status: "completed", outcome_json: { winner: 1 } }), {
      canWrite: false,
    });

    expect(byName(scope, "Team 1 win")?.getAttribute("aria-pressed")).toBe("true");
    expect(byName(scope, "Draw")?.getAttribute("aria-pressed")).toBe("false");
    expect(byName(scope, "Draw")?.hasAttribute("disabled")).toBe(true);
    expect(scope.textContent).toContain("Recorded. This mix is closed.");
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
});
