// @vitest-environment happy-dom
//
// The lobby exists to keep two things apart that the old mix panel conflated:
// who is *in* the mix (membership, owned by the pool column) and who is *in the
// balance* (participation, this column's checkbox). Everything pinned here is a
// way that distinction can silently collapse:
//
//  1. unchecking a player patches `is_active` and must NOT rewrite the roster —
//     otherwise "he's late" quietly deletes his rank override and role order;
//  2. a benched player stays listed and re-checkable, instead of vanishing;
//  3. toggling a role on a player whose roles were never configured sends the
//     resolved order explicitly, so priority stops depending on a server default;
//  4. a selected role with no rank is marked on the offending chip, because that
//     case fails the whole balance run server-side;
//  5. Clear asks first — it drops every per-mix override in the lobby;
//  6. a member without edit rights, and a terminal mix, get no write controls.
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

const onPatchPlayer = vi.fn();
const onClear = vi.fn();
const onOpenPlayer = vi.fn();

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
    ...overrides,
  };
}

function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

async function mount(rows: CustomGamePlayer[], props: { canWrite?: boolean } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <PickupLobbyPanel
        canWrite={props.canWrite ?? true}
        hasMix
        rows={rows}
        savingPlayerId={null}
        clearing={false}
        onPatchPlayer={onPatchPlayer}
        onClear={onClear}
        onOpenPlayer={onOpenPlayer}
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
  onOpenPlayer.mockReset();
});

describe("PickupLobbyPanel", () => {
  it("benches a player through a patch, leaving membership alone", async () => {
    const scope = await mount([row()]);

    await click(byLabel(scope, "Include Aria#1111 in the balance"));

    expect(onPatchPlayer).toHaveBeenCalledWith(7, { is_active: false });
    expect(onClear).not.toHaveBeenCalled();
  });

  it("keeps a benched player listed and re-checkable", async () => {
    const scope = await mount([row({ is_active: false })]);

    expect(scope.textContent).toContain("Aria");
    expect(scope.textContent).toContain("1 out");
    const checkbox = byLabel(scope, "Include Aria#1111 in the balance");
    expect(checkbox?.getAttribute("data-state")).toBe("unchecked");

    await click(checkbox);
    expect(onPatchPlayer).toHaveBeenCalledWith(7, { is_active: true });
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

  it("marks an unranked role on the chip without crying blocker", async () => {
    // Tank is unranked but DPS is not, so the balance still has a seat to give:
    // the chip warns, the lobby header does not.
    const scope = await mount([row({ roles: ["tank", "dps"], ranks: { dps: 2600 } })]);

    expect(byLabel(scope, "Tank for Aria#1111, priority 1, no rank")?.getAttribute("class")).toContain(
      "ring-amber-400/70",
    );
    expect(byLabel(scope, "DPS for Aria#1111, priority 2, 2600 points")?.getAttribute("class")).not.toContain(
      "ring-amber",
    );
    expect(scope.textContent).not.toContain("no ranked role");
  });

  it("warns once every selected role of an active player is unranked", async () => {
    const scope = await mount([row({ roles: ["tank"], ranks: { dps: 2600 } })]);

    expect(scope.textContent).toContain("1 player has no ranked role");
    expect(scope.textContent).toContain("balance will reject this mix");
  });

  it("opens the player sheet from the name, not from a role click", async () => {
    const scope = await mount([row()]);

    await click(byName(scope, "Aria#1111"));

    expect(onOpenPlayer).toHaveBeenCalledWith(7);
    expect(onPatchPlayer).not.toHaveBeenCalled();
  });

  it("confirms before emptying the lobby", async () => {
    const scope = await mount([row(), row({ id: 2, workspace_player_id: 8, battle_tag: "Borys#2222" })]);

    await click(byName(scope, "Empty the lobby"));
    expect(onClear).not.toHaveBeenCalled();

    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("removes all 2 players");

    await click(byName(document, "Remove everyone"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("shows the assigned team once a balance has run", async () => {
    const scope = await mount([row({ team_index: 1 })]);

    expect(scope.textContent).toContain("Team 2");
  });

  it("hides every write control for a read-only viewer", async () => {
    const scope = await mount([row()], { canWrite: false });

    expect(byName(scope, "Empty the lobby")).toBeNull();
    expect(byLabel(scope, "Include Aria#1111 in the balance")?.hasAttribute("disabled")).toBe(true);
    expect(
      byLabel(scope, "Tank for Aria#1111, priority 1, 2400 points")?.hasAttribute("disabled"),
    ).toBe(true);
    // Inspecting the setup is not a write.
    expect(byName(scope, "Aria#1111")).not.toBeNull();
  });
});
