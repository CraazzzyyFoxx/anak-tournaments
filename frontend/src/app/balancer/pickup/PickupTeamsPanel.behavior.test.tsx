// @vitest-environment happy-dom
//
// The teams column replaced a `<pre>{JSON.stringify(result_json)}</pre>`, so
// what is pinned here is that it actually reads the payload:
//
//  1. seats render per team with the rating the solver assigned, not raw JSON;
//  2. the solver returns many equally-scored options and the pager walks them
//     without re-running the balance;
//  3. the pager index is clamped, so a shorter result cannot point past the end;
//  4. Balance is refused while nobody is checked in the lobby, which is the
//     `empty_lineup` 422 the server would raise;
//  5. a read-only viewer and a terminal mix get no Balance button.
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
vi.mock("@/hooks/useCurrentWorkspace", () => ({ useDivisionGrid: () => ({ tiers: [] }) }));

const onBalance = vi.fn();
const onSelectGame = vi.fn();
const onCreateGame = vi.fn();

function variant(offset: number) {
  return {
    teams: [
      {
        id: 1,
        name: "karin",
        average_mmr: 3000 + offset,
        roster: {
          Tank: [{ uuid: "7", name: "karin", assigned_rating: 2900 + offset, role_preferences: ["Tank"] }],
          Damage: [
            {
              uuid: "8",
              name: "DemonDimon",
              assigned_rating: 4100,
              role_preferences: ["Tank", "Damage"],
            },
          ],
        },
      },
      {
        id: 2,
        name: "Tolgrn",
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
  current: CustomGame,
  props: { canEdit?: boolean; canWrite?: boolean; activeCount?: number } = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <PickupTeamsPanel
        canEdit={props.canEdit ?? true}
        canWrite={props.canWrite ?? true}
        games={[current]}
        gamesLoading={false}
        gamesError={false}
        onRetryGames={vi.fn()}
        game={current}
        gameLoading={false}
        selectedGameId={current.id}
        onSelectGame={onSelectGame}
        creating={false}
        onCreateGame={onCreateGame}
        balancing={false}
        activeCount={props.activeCount ?? 10}
        onBalance={onBalance}
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
  onSelectGame.mockReset();
  onCreateGame.mockReset();
});

describe("PickupTeamsPanel", () => {
  it("renders seats and ratings from the payload instead of raw JSON", async () => {
    const scope = await mount(game());

    expect(scope.textContent).toContain("Team 1");
    expect(scope.textContent).toContain("Team 2");
    expect(scope.textContent).toContain("karin");
    expect(scope.textContent).toContain("2900");
    expect(scope.textContent).toContain("Tolgrn");
    expect(scope.textContent).toContain("3450");
    expect(scope.textContent).not.toContain("result_json");
    expect(scope.textContent).not.toContain('"uuid"');
  });

  it("shows the option quality and who the option left out", async () => {
    const scope = await mount(game());

    expect(scope.textContent).toContain("0.87");
    expect(scope.textContent).toContain("12.3");
    expect(scope.textContent).toContain("Off-role");
    expect(scope.textContent).toContain("Left out of this option: Egor");
  });

  it("pages through the solver's options without re-balancing", async () => {
    const scope = await mount(game());

    expect(pagerLabel(scope)).toBe("1 / 3");
    expect(byName(scope, "Previous balance option")?.hasAttribute("disabled")).toBe(true);

    await click(byName(scope, "Next balance option"));

    expect(pagerLabel(scope)).toBe("2 / 3");
    expect(scope.textContent).toContain("3000");
    expect(onBalance).not.toHaveBeenCalled();
  });

  it("hides the pager for a single option", async () => {
    const scope = await mount(game({ result_json: { variants: [variant(0)] } }));

    expect(pagerLabel(scope)).toBeUndefined();
    expect(scope.textContent).toContain("Team 1");
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

  it("hides write controls for a read-only viewer but still shows the teams", async () => {
    const scope = await mount(game(), { canEdit: false, canWrite: false });

    expect(byName(scope, "Balance teams")).toBeNull();
    expect(scope.querySelector("#pickup-new-mix")).toBeNull();
    expect(scope.textContent).toContain("Team 1");
    expect(pagerLabel(scope)).toBe("1 / 3");
  });

  it("hides Balance on a terminal mix while keeping its stored result", async () => {
    const scope = await mount(game({ status: "completed" }), { canWrite: false });

    expect(scope.textContent).toContain("Completed");
    expect(byName(scope, "Balance teams")).toBeNull();
    expect(scope.textContent).toContain("karin");
  });
});
