// @vitest-environment happy-dom
//
// The pickup lineup exists to keep two things apart that the old mix panel
// conflated: who is *in* the mix (membership, a roster write) and who is *in the
// balance* (participation, a per-row flag). Everything pinned here is a way that
// distinction can silently collapse:
//
//  1. benching a player patches `is_active` and must NOT rewrite the roster —
//     otherwise "he's late" quietly deletes his rank override and role order;
//  2. a benched player stays visible and switchable, instead of vanishing;
//  3. toggling a role on a player whose roles were never configured sends the
//     resolved order explicitly, so priority stops depending on a server default;
//  4. removing a player sends a roster without them, and nothing else;
//  5. an active player with no ranked role is called out before Balance runs,
//     because that case fails the whole run server-side;
//  6. balanced teams are rendered from `team_index`, not dumped as raw JSON.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CustomGame, CustomGamePlayer, CustomGamePlayerPatch } from "@/services/custom-game.service";

import { PickupLineupPanel } from "./PickupLineupPanel";

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
// The real picker needs the workspace division grid; the sheet only needs a
// control that carries its accessible name.
vi.mock("@/app/balancer/components/DivisionRankPicker", () => ({
  DivisionRankPicker: ({ label }: { label: string }) => <button type="button" aria-label={label} />,
}));

const onPatchPlayer = vi.fn();
const onRemovePlayer = vi.fn();
const onBalance = vi.fn();

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

function game(players: CustomGamePlayer[], overrides: Partial<CustomGame> = {}): CustomGame {
  return {
    id: 3,
    workspace_id: 7,
    host_user_id: 9,
    name: "Thursday scrim",
    status: "draft",
    config_json: null,
    result_json: null,
    players,
    ...overrides,
  };
}

function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

async function mount(current: CustomGame, props: { canEdit?: boolean } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <PickupLineupPanel
        canEdit={props.canEdit ?? true}
        games={[current]}
        gamesLoading={false}
        gamesError={false}
        onRetryGames={vi.fn()}
        game={current}
        gameLoading={false}
        selectedGameId={current.id}
        onSelectGame={vi.fn()}
        creating={false}
        onCreateGame={vi.fn()}
        balancing={false}
        onBalance={onBalance}
        savingPlayerId={null}
        onPatchPlayer={onPatchPlayer}
        onRemovePlayer={onRemovePlayer}
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

function byLabel(scope: Element, label: string) {
  return scope.querySelector(`[aria-label="${label}"]`);
}

/** Icon-only controls carry their name in an `sr-only` span, not `aria-label`. */
function byName(scope: Element, name: string) {
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
  onRemovePlayer.mockReset();
  onBalance.mockReset();
});

describe("PickupLineupPanel", () => {
  it("benches a player through a patch, leaving membership alone", async () => {
    const scope = await mount(game([row()]));

    await click(byLabel(scope, "Include Aria#1111 in the balance"));

    expect(onPatchPlayer).toHaveBeenCalledWith(7, { is_active: false });
    expect(onRemovePlayer).not.toHaveBeenCalled();
  });

  it("keeps a benched player listed and switchable back on", async () => {
    const scope = await mount(game([row({ is_active: false })]));

    expect(scope.textContent).toContain("Aria");
    expect(scope.textContent).toContain("1 benched");
    const bench = byLabel(scope, "Include Aria#1111 in the balance");
    expect(bench?.getAttribute("data-state")).toBe("unchecked");

    await click(bench);
    expect(onPatchPlayer).toHaveBeenCalledWith(7, { is_active: true });
  });

  it("writes an explicit role order the first time a role is toggled", async () => {
    // `roles: null` is "not configured"; the panel must not leave priority to a
    // server-side default once the host has touched it.
    const scope = await mount(game([row({ roles: null })]));

    await click(byLabel(scope, "Tank for Aria#1111, priority 1, 2400 points"));

    expect(patchOf(7)).toEqual({ roles: ["dps", "support"] });
  });

  it("appends a switched-off role as the lowest priority", async () => {
    const scope = await mount(game([row({ roles: ["tank"] })]));

    await click(byLabel(scope, "Support for Aria#1111, off"));

    expect(patchOf(7)).toEqual({ roles: ["tank", "support"] });
  });

  it("marks a selected role the player has no rank for", async () => {
    const scope = await mount(game([row({ roles: ["tank", "dps"], ranks: { dps: 2600 } })]));

    const tank = byLabel(scope, "Tank for Aria#1111, priority 1, no rank");
    expect(tank).not.toBeNull();
    expect(tank?.getAttribute("class")).toContain("ring-amber-400/70");
    expect(byLabel(scope, "DPS for Aria#1111, priority 2, 2600 points")?.getAttribute("class")).not.toContain(
      "ring-amber",
    );
  });

  it("removes a player from the mix without patching them", async () => {
    const scope = await mount(game([row()]));

    await click(byName(scope, "Remove Aria#1111 from this mix"));

    expect(onRemovePlayer).toHaveBeenCalledWith(7);
    expect(onPatchPlayer).not.toHaveBeenCalled();
  });

  it("warns about an active player with no ranked role before Balance runs", async () => {
    const scope = await mount(game([row({ roles: ["tank"], ranks: { dps: 2600 } })]));

    expect(scope.textContent).toContain("1 player has no ranked role");
    expect(scope.textContent).toContain("balance will reject this mix");
  });

  it("disables Balance only when nobody is in the balance", async () => {
    const benched = await mount(game([row({ is_active: false })]));
    expect(byName(benched, "Balance teams")?.hasAttribute("disabled")).toBe(true);

    document.body.innerHTML = "";
    const active = await mount(game([row()]));
    const enabled = byName(active, "Balance teams");
    expect(enabled?.hasAttribute("disabled")).toBe(false);

    await click(enabled);
    expect(onBalance).toHaveBeenCalledTimes(1);
  });

  it("renders balanced teams with assigned roles instead of raw JSON", async () => {
    const scope = await mount(
      game(
        [
          row({ id: 1, workspace_player_id: 7, battle_tag: "Aria#1111", team_index: 0 }),
          row({ id: 2, workspace_player_id: 8, battle_tag: "Borys#2222", team_index: 1 }),
        ],
        {
          status: "balanced",
          result_json: {
            variants: [
              {
                teams: [
                  { roster: { Tank: [{ uuid: "7" }] } },
                  { roster: { Support: [{ uuid: "8" }] } },
                ],
              },
            ],
          },
        },
      ),
    );

    expect(scope.textContent).toContain("Team 1");
    expect(scope.textContent).toContain("Team 2");
    expect(scope.textContent).not.toContain("result_json");
    expect(scope.textContent).not.toContain("\"uuid\"");

    const teamCards = [...scope.querySelectorAll("h3")].map((node) => node.textContent);
    expect(teamCards).toEqual(["Team 1", "Team 2"]);
  });

  it("hides every write control for a member without edit rights", async () => {
    const scope = await mount(game([row()]), { canEdit: false });

    expect(byName(scope, "Remove Aria#1111 from this mix")).toBeNull();
    expect(byLabel(scope, "Include Aria#1111 in the balance")?.hasAttribute("disabled")).toBe(true);
    expect(byName(scope, "Balance teams")).toBeNull();
    // The read-only sheet is still reachable: seeing the setup is not a write.
    expect(byName(scope, "Open mix settings for Aria#1111")).not.toBeNull();
  });

  it("hides write controls on a completed mix even for an editor", async () => {
    const scope = await mount(game([row()], { status: "completed" }));

    expect(scope.textContent).toContain("Completed");
    expect(byName(scope, "Remove Aria#1111 from this mix")).toBeNull();
    expect(byName(scope, "Balance teams")).toBeNull();
    expect(byLabel(scope, "Include Aria#1111 in the balance")?.hasAttribute("disabled")).toBe(true);
  });
});
