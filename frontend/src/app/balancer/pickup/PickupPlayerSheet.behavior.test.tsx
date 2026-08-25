// @vitest-environment happy-dom
//
// The mix sheet edits ranks with no Save button, which makes three things
// load-bearing:
//
//  1. the field shows the *effective* rank and the layer it came from, and typing
//     stores the correction in this host's own book — a host who sees 2700 and
//     types 3000 must not be silently editing a different number;
//  2. one settled edit is one write. Wired straight to the mutation, a four-digit
//     number was four PUTs and a slider drag was one per division;
//  3. Clear only exists where there is an author entry to drop, and it does not
//     wait for the debounce.
//
// There is no fourth field: the per-mix rank pin is gone, so every rank the sheet
// writes goes to the author's book and nowhere else.
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CustomGamePlayer } from "@/services/custom-game.service";

import { PickupPlayerSheet } from "./PickupPlayerSheet";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

vi.mock("@/components/PlayerRoleIcon", () => ({ default: () => null }));
vi.mock("@/components/DivisionIcon", () => ({ default: () => null }));
vi.mock("@/components/RankHistory", () => ({ default: () => null }));
// Drag is not what this pins, and dnd-kit resolves its own React copy under
// pnpm, so the sortable wrapper renders as a plain list here.
vi.mock("@/app/balancer/components/SortableRows", () => ({
  SortableRows: <T,>({
    items,
    children,
  }: {
    items: readonly T[];
    children: (item: T, index: number) => ReactNode;
  }) => <div>{items.map((item, index) => children(item, index))}</div>,
  SortableRow: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/useCurrentWorkspace", () => ({
  useDivisionGrid: () => ({
    tiers: [
      { number: 1, name: "Bronze", rank_min: 1000, rank_max: 1999, icon_url: "" },
      { number: 2, name: "Silver", rank_min: 2000, rank_max: 2999, icon_url: "" },
      { number: 3, name: "Gold", rank_min: 3000, rank_max: 3999, icon_url: "" },
    ],
  }),
}));

const onPatch = vi.fn();
const onSetAuthorRank = vi.fn();

function row(overrides: Partial<CustomGamePlayer> = {}): CustomGamePlayer {
  return {
    id: 1,
    workspace_member_id: 7,
    display_name: null,
    battle_tag: "Aria#1111",
    team_index: null,
    sort_order: 0,
    is_active: true,
    roles: ["tank", "dps"],
    ranks: { tank: 3300, dps: 2700, support: 2900 },
    rank_sources: { tank: "author", dps: "workspace", support: "ow" },
    author_ranks: { tank: 3300 },
    ...overrides,
  };
}

function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

/** Past the sheet's write delay, so a settled edit has had its chance to flush. */
function settle() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 500);
  return promise;
}

async function mount(value: CustomGamePlayer | null = row()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <PickupPlayerSheet
        row={value}
        canEdit
        saving={false}
        onOpenChange={() => {}}
        onPatch={onPatch}
        onSetAuthorRank={onSetAuthorRank}
        onRemove={() => {}}
      />,
    );
  });
  await act(async () => {
    await tick();
  });
  // Radix portals the sheet, so the content is a sibling of the mount point.
  return document.body;
}

/** Every rank field, in render order: tank, dps, support. */
function rankFields(scope: ParentNode) {
  return [...scope.querySelectorAll<HTMLInputElement>('input[inputmode="numeric"]')];
}

/** React tracks the DOM value itself, so a plain assignment is ignored. */
function type(node: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  return act(async () => {
    setter?.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
  });
}

function clearButtons(scope: ParentNode) {
  return [...scope.querySelectorAll("button")].filter(
    (node) => node.textContent?.trim() === "Clear",
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
  onPatch.mockReset();
  onSetAuthorRank.mockReset();
});

describe("PickupPlayerSheet ranks", () => {
  it("shows every role's effective rank and names the layer it came from", async () => {
    const scope = await mount();

    expect(rankFields(scope).map((node) => node.value)).toEqual(["3300", "2700", "2900"]);
    expect(scope.textContent).toContain("Mine");
    expect(scope.textContent).toContain("Workspace");
    expect(scope.textContent).toContain("Overwatch");
  });

  it("writes a typed rank into the host book once the edit settles", async () => {
    const scope = await mount();

    await type(rankFields(scope)[1], "3");
    await type(rankFields(scope)[1], "30");
    await type(rankFields(scope)[1], "3000");
    expect(onSetAuthorRank).not.toHaveBeenCalled();

    await act(async () => {
      await settle();
    });

    expect(onSetAuthorRank.mock.calls).toEqual([["dps", 3000]]);
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("offers Clear only where the host has an entry of their own, and writes it at once", async () => {
    const scope = await mount();

    // Tank alone comes from the author's own book; dps/support are inherited, so
    // a Clear on either would drop nothing.
    const buttons = clearButtons(scope);
    expect(buttons).toHaveLength(1);

    await act(async () => {
      buttons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await tick();
    });

    expect(onSetAuthorRank.mock.calls).toEqual([["tank", null]]);
  });

  it("has no per-mix rank pin left to edit", async () => {
    const scope = await mount();

    // Three role fields and nothing else: the mix-only override is gone, so a
    // rank typed here can only ever land in the author's own book.
    expect(rankFields(scope)).toHaveLength(3);
    expect(scope.textContent).not.toContain("Rank for this mix");

    await type(rankFields(scope)[0], "2500");
    await act(async () => {
      await settle();
    });

    expect(onPatch).not.toHaveBeenCalled();
    expect(onSetAuthorRank.mock.calls).toEqual([["tank", 2500]]);
  });

  // balancer-service resolves a mix's ranks against the GLOBAL, OW-synced grid
  // (`get_effective_division_grid(session, None)` -> the grid with
  // `workspace_id IS NULL`), never the host workspace's. The mocked workspace
  // grid above deliberately disagrees: it calls 3300 "Gold" where the OW ladder
  // calls it "Diamond 2". Reading the workspace grid here renamed a number the
  // backend had already fixed, so the crest and label disagreed with the mix
  // the solver actually balanced.
  it("labels ranks with the global OW ladder, not the workspace's grid", async () => {
    const scope = await mount();

    expect(scope.textContent).toContain("Diamond 2");
    expect(scope.textContent).not.toContain("Gold");
  });
});
