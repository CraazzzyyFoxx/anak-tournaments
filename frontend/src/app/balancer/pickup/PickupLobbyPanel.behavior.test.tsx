// @vitest-environment happy-dom
//
// The lineup keeps two things apart that one panel used to conflate: who is *in*
// the mix (membership, owned by the player pool) and who is *in the balance*
// (participation, this column's switch). Everything pinned here is a way that
// distinction can silently collapse, plus the pre-flight the panel exists to
// give a host:
//
//  1. benching patches `is_active` and must NOT rewrite the roster — otherwise
//     "he's late" quietly deletes his rank override and role order;
//  2. removing is a separate control that does rewrite membership;
//  3. a benched player moves to its own section but stays switchable back;
//  4. toggling a role on a player whose roles were never configured sends the
//     resolved order explicitly, so priority stops depending on a server default;
//  5. the role-supply strip counts the way the solver does — a selected role with
//     no rank is not supply — and says which role is short before Balance runs;
//  6. Clear asks first, since it drops every per-mix override in the lobby;
//  7. the whole row opens the drawer, but a control inside it does NOT — that
//     containment is the only thing keeping "bench him" from also opening a
//     sheet over the lineup the host was reading;
//  8. a read-only viewer gets no write controls but can still read the setup.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CustomGamePlayer, CustomGamePlayerPatch } from "@/services/custom-game.service";

import { PickupLobbyPanel } from "./PickupLobbyPanel";

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

const onPatchPlayer = vi.fn();
const onClear = vi.fn();
const onRemovePlayer = vi.fn();
const onOpenPlayer = vi.fn();
const onOpenPool = vi.fn();

function row(overrides: Partial<CustomGamePlayer> = {}): CustomGamePlayer {
  return {
    id: 1,
    workspace_player_id: 7,
    display_name: null,
    battle_tag: "Aria#1111",
    rank_value: null,
    team_index: null,
    sort_order: 0,
    is_active: true,
    roles: null,
    ranks: { tank: 2400, dps: 2600, support: 2500 },
    rank_sources: { tank: "canon", dps: "canon", support: "canon" },
    host_ranks: {},
    ...overrides,
  };
}

function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

async function mount(rows: CustomGamePlayer[], props: { canWrite?: boolean; hasMix?: boolean } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <PickupLobbyPanel
        canWrite={props.canWrite ?? true}
        hasMix={props.hasMix ?? true}
        rows={rows}
        savingPlayerId={null}
        clearing={false}
        onPatchPlayer={onPatchPlayer}
        onClear={onClear}
        onRemovePlayer={onRemovePlayer}
        onOpenPlayer={onOpenPlayer}
        onOpenPool={onOpenPool}
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

function byLabel(scope: ParentNode, label: string) {
  return scope.querySelector(`[aria-label="${label}"]`);
}

/** Icon-only controls carry their name in an `sr-only` span, not `aria-label`. */
function byName(scope: ParentNode, name: string) {
  return [...scope.querySelectorAll("button")].find((node) => node.textContent?.trim() === name) ?? null;
}

function patchOf(playerId: number): CustomGamePlayerPatch {
  const call = onPatchPlayer.mock.calls.find(([id]) => id === playerId);
  if (!call) throw new Error(`No patch recorded for player ${playerId}`);
  return call[1] as CustomGamePlayerPatch;
}

beforeEach(() => {
  document.body.innerHTML = "";
  onPatchPlayer.mockReset();
  onClear.mockReset();
  onRemovePlayer.mockReset();
  onOpenPlayer.mockReset();
  onOpenPool.mockReset();
});

describe("PickupLobbyPanel", () => {
  it("benches a player through a patch, leaving membership alone", async () => {
    const scope = await mount([row()]);

    await click(byLabel(scope, "Include Aria#1111 in the balance"));

    expect(onPatchPlayer).toHaveBeenCalledWith(7, { is_active: false });
    expect(onRemovePlayer).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });

  it("removes a player through its own control, not through the switch", async () => {
    const scope = await mount([row()]);

    await click(byName(scope, "Remove Aria#1111 from this mix"));

    expect(onRemovePlayer).toHaveBeenCalledWith(7);
    expect(onPatchPlayer).not.toHaveBeenCalled();
  });

  it("moves a benched player to its own section and keeps it switchable back", async () => {
    const scope = await mount([
      row(),
      row({ id: 2, workspace_player_id: 8, battle_tag: "Borys#2222", is_active: false }),
    ]);

    expect(scope.textContent).toContain("1 in the balance");
    expect(scope.textContent).toContain("1 benched");
    expect(scope.textContent).toContain("Benched · 1");

    const bench = byLabel(scope, "Include Borys#2222 in the balance");
    expect(bench?.getAttribute("data-state")).toBe("unchecked");

    await click(bench);
    expect(onPatchPlayer).toHaveBeenCalledWith(8, { is_active: true });
  });

  it("writes an explicit role order the first time a role is toggled", async () => {
    // `roles: null` is "not configured"; the panel must not leave priority to a
    // server-side default once the host has touched it.
    const scope = await mount([row({ roles: null })]);

    await click(byLabel(scope, "Tank for Aria#1111, priority 1, 2400 points"));

    expect(patchOf(7)).toEqual({ roles: ["dps", "support"] });
  });

  it("appends a switched-off role as the lowest priority", async () => {
    const scope = await mount([row({ roles: ["tank"] })]);

    await click(byLabel(scope, "Support for Aria#1111, off"));

    expect(patchOf(7)).toEqual({ roles: ["tank", "support"] });
  });

  it("counts role supply the way the solver does, not the way the chips look", async () => {
    // Tank is selected but unranked, so it is not supply: 5v5 wants 2 tanks and
    // this lineup can seat none.
    const scope = await mount([
      row({ roles: ["tank", "dps"], ranks: { dps: 2600 } }),
      row({ id: 2, workspace_player_id: 8, battle_tag: "Borys#2222", roles: ["dps"], ranks: { dps: 2500 } }),
    ]);

    expect(scope.textContent).toContain("0 of 2 · short 2");
    expect(scope.textContent).toContain("2 of 4");
  });

  it("warns once every selected role of an active player is unranked", async () => {
    const scope = await mount([row({ roles: ["tank"], ranks: { dps: 2600 } })]);

    expect(scope.textContent).toContain("1 player has no ranked role");
  });

  it("opens the player sheet from the row, but not from a role click", async () => {
    const scope = await mount([row()]);

    // The whole row is the target; a role chip inside it must not ride along.
    await click(scope.querySelector('[aria-label="Mix lineup"] li'));
    expect(onOpenPlayer).toHaveBeenCalledWith(7);

    onOpenPlayer.mockClear();
    await click(byLabel(scope, "Tank for Aria#1111, priority 1, 2400 points"));
    expect(onPatchPlayer).toHaveBeenCalled();
  });

  it("keeps the settings control reachable without a pointer", async () => {
    // The row's own click is a pointer affordance; the button is what a keyboard
    // reaches, so it has to stay even when nothing else on the row is writable.
    const scope = await mount([row()], { canWrite: false });

    expect(byName(scope, "Advanced settings for Aria#1111")).not.toBeNull();
  });

  it("hands adding players back to the pool", async () => {
    const scope = await mount([row()]);

    await click(byName(scope, "Add players →"));

    expect(onOpenPool).toHaveBeenCalledTimes(1);
  });

  it("confirms before emptying the lobby", async () => {
    const scope = await mount([row(), row({ id: 2, workspace_player_id: 8, battle_tag: "Borys#2222" })]);

    await click(byName(scope, "Empty the lobby"));
    expect(onClear).not.toHaveBeenCalled();

    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("removes all 2 players");

    await click(byName(document, "Remove everyone"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("separates no mix from an empty lineup", async () => {
    const withoutMix = await mount([], { hasMix: false });
    expect(withoutMix.textContent).toContain("No mix selected");

    document.body.innerHTML = "";
    const empty = await mount([]);
    expect(empty.textContent).toContain("Lineup is empty");
  });

  it("hides every write control for a read-only viewer", async () => {
    const scope = await mount([row()], { canWrite: false });

    expect(byName(scope, "Empty the lobby")).toBeNull();
    expect(byName(scope, "Add players →")).toBeNull();
    expect(byName(scope, "Remove Aria#1111 from this mix")).toBeNull();
    expect(byLabel(scope, "Include Aria#1111 in the balance")?.hasAttribute("disabled")).toBe(true);
    expect(
      byLabel(scope, "Tank for Aria#1111, priority 1, 2400 points")?.hasAttribute("disabled"),
    ).toBe(true);
  });

  it("opens the drawer from anywhere on the card", async () => {
    const scope = await mount([row()]);

    await click(scope.querySelector('li[title*="Aria#1111"]'));

    expect(onOpenPlayer).toHaveBeenCalledWith(7);
    expect(onPatchPlayer).not.toHaveBeenCalled();
  });

  it("keeps the row's own controls from opening the drawer", async () => {
    // The wrappers that stop propagation are the whole point: without them the
    // sheet lands on top of the lineup every time a host benches someone.
    const scope = await mount([row()]);

    await click(byLabel(scope, "Include Aria#1111 in the balance"));
    await click(byLabel(scope, "Tank for Aria#1111, priority 1, 2400 points"));
    await click(byName(scope, "Remove Aria#1111 from this mix"));

    expect(onPatchPlayer).toHaveBeenCalled();
    expect(onRemovePlayer).toHaveBeenCalledWith(7);
    expect(onOpenPlayer).not.toHaveBeenCalled();
  });
});
