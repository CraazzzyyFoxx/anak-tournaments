// @vitest-environment happy-dom
//
// The workspace roster is the one panel on the balancer page that talks to the
// network on its own, so the states around the happy path are what break in
// production. Four things are pinned here:
//
//  1. "nothing here" and "nothing matched your search" are different messages,
//     and the second one offers the way back;
//  2. a failed request says so and offers a retry, instead of rendering the
//     empty state and telling an admin the workspace has no players;
//  3. the add field validates on submit rather than sitting behind a disabled
//     button, so the reason nothing happens is visible;
//  4. saving one player's rank disables that player's pickers only — the whole
//     list used to grey out on every single edit.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspacePlayer } from "@/services/workspace-player.service";

import { WorkspacePlayersSidebar } from "./WorkspacePlayersSidebar";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const list = vi.fn();
const upsert = vi.fn();
const setRanks = vi.fn();

vi.mock("@/services/workspace-player.service", () => ({
  workspacePlayerKeys: {
    all: (workspaceId: number) => ["workspace-players", workspaceId],
    list: (workspaceId: number, params: { page?: number; query?: string } = {}) => [
      "workspace-players",
      workspaceId,
      params.page ?? 1,
      params.query ?? "",
    ],
  },
  workspacePlayerService: {
    list: (...args: unknown[]) => list(...args),
    upsert: (...args: unknown[]) => upsert(...args),
    setRanks: (...args: unknown[]) => setRanks(...args),
  },
}));

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), apiError: vi.fn() } }));
vi.mock("@/components/PlayerRoleIcon", () => ({ default: () => null }));
// The real picker needs the workspace division grid; the row only needs a
// control that carries its accessible name and disabled state.
vi.mock("@/components/DivisionIcon", () => ({ default: () => null }));
vi.mock("@/hooks/useCurrentWorkspace", () => ({ useDivisionGrid: () => ({ tiers: [] }) }));
vi.mock("@/app/balancer/components/DivisionRankPicker", () => ({
  DivisionRankPicker: ({
    label,
    disabled,
    onChange,
  }: {
    label: string;
    disabled?: boolean;
    onChange: (rank: number | null) => void;
  }) => (
    <button type="button" aria-label={label} disabled={disabled} onClick={() => onChange(1200)} />
  ),
}));

const WORKSPACE_ID = 7;

function player(id: number, battleTag: string): WorkspacePlayer {
  return {
    id,
    workspace_id: WORKSPACE_ID,
    battle_tag: battleTag,
    display_name: null,
    player_id: null,
    ranks: {},
  };
}

const ROSTER = [player(1, "Aria#1111"), player(2, "Borys#2222")];

function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

async function mount(
  props: {
    canEdit?: boolean;
    collapsed?: boolean;
    selectedIds?: number[];
    onTogglePlayer?: (player: WorkspacePlayer) => void;
  } = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(container).render(
      <QueryClientProvider client={client}>
        <WorkspacePlayersSidebar
          workspaceId={WORKSPACE_ID}
          canEdit={props.canEdit ?? true}
          collapsed={props.collapsed ?? false}
          selectedIds={props.selectedIds}
          onTogglePlayer={props.onTogglePlayer}
        />
      </QueryClientProvider>,
    );
  });
  // The list query resolves after the first commit; a second flush lets its
  // state update land inside `act`.
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

/**
 * Types into a controlled field and drains the follow-up work: the deferred
 * search value re-renders once, and the query it triggers resolves after that.
 */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  return act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    await tick();
    await tick();
  });
}

/**
 * A second `act` pass: `useDeferredValue` schedules the search re-render at a
 * lower priority than the one `type` flushes, and the query it starts resolves
 * after that.
 */
function settle() {
  return act(async () => {
    await tick();
    await tick();
  });
}

function button(scope: Element, text: string) {
  return [...scope.querySelectorAll("button")].find((node) => node.textContent?.includes(text));
}

function field(scope: Element, label: string) {
  return scope.querySelector<HTMLInputElement>(`input[aria-label='${label}']`);
}

beforeEach(() => {
  document.body.innerHTML = "";
  list.mockReset();
  upsert.mockReset();
  setRanks.mockReset();
  list.mockImplementation((_workspaceId: number, params: { query?: string }) => {
    const results = params.query ? [] : ROSTER;
    return Promise.resolve({ results, total: results.length, page: 1, per_page: 30 });
  });
  upsert.mockResolvedValue(player(3, "Cyrus#3333"));
  setRanks.mockResolvedValue({});
});

describe("WorkspacePlayersSidebar", () => {
  it("separates an empty roster from a search that matched nothing, and offers the way back", async () => {
    const scope = await mount();
    const search = field(scope, "Search workspace players");
    if (!search) throw new Error("Expected the roster search field");

    await type(search, "zzz");
    await settle();

    expect(scope.textContent).toContain("No players match");
    expect(scope.textContent).toContain("zzz");
    // The single "No workspace players yet." message used to claim an empty
    // workspace whenever a query simply matched nothing.
    expect(scope.textContent).not.toContain("No workspace players yet");

    await click(button(scope, "Clear search"));
    await settle();

    expect(scope.textContent).toContain("Aria#1111");
    expect(search.value).toBe("");
  });

  it("reports a failed request with a retry instead of an empty roster", async () => {
    list.mockRejectedValue(new Error("offline"));

    const scope = await mount();

    expect(scope.textContent).toContain("Unable to load workspace players");
    expect(scope.textContent).not.toContain("No workspace players yet");
    expect(button(scope, "Retry")).toBeDefined();
  });

  it("keeps adding a player secondary and validates it on submit", async () => {
    const scope = await mount();

    // The permanent three-row form is gone: the panel is a roster first.
    expect(scope.querySelector("input[placeholder='Name#1234']")).toBeNull();

    await click(button(scope, "Add a workspace player"));

    // Radix portals the popover, so the form lives outside the panel subtree.
    const submit = button(document.body, "Add player");
    const battleTag = document.body.querySelector<HTMLInputElement>("input[placeholder='Name#1234']");
    if (!submit || !battleTag) throw new Error("Expected the add-player form");

    expect(submit.disabled).toBe(false);

    await click(submit);

    expect(upsert).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Enter a BattleTag");
    expect(battleTag.getAttribute("aria-invalid")).toBe("true");

    await type(battleTag, "Cyrus#3333");
    await click(button(document.body, "Add player"));

    expect(upsert).toHaveBeenCalledWith(WORKSPACE_ID, "Cyrus#3333");
  });

  it("disables the pickers of the row being saved, not the whole roster", async () => {
    setRanks.mockReturnValue(Promise.withResolvers<Record<string, number>>().promise);

    const scope = await mount();
    const ariaTank = scope.querySelector<HTMLButtonElement>("button[aria-label='Tank rank for Aria#1111']");
    const borysTank = scope.querySelector<HTMLButtonElement>("button[aria-label='Tank rank for Borys#2222']");
    if (!ariaTank || !borysTank) throw new Error("Expected a rank picker per role per row");

    await click(ariaTank);

    expect(
      scope.querySelector<HTMLButtonElement>("button[aria-label='Tank rank for Aria#1111']")?.disabled,
    ).toBe(true);
    expect(
      scope.querySelector<HTMLButtonElement>("button[aria-label='Tank rank for Borys#2222']")?.disabled,
    ).toBe(false);
  });

  it("keeps the collapsed rail count honest while the first page is in flight", async () => {
    list.mockReturnValue(Promise.withResolvers<never>().promise);

    const scope = await mount({ collapsed: true });

    // `?? 0` used to render a confident "0" for every workspace during load.
    expect(scope.textContent).not.toMatch(/\d/);
    expect(scope.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("toggles lineup membership from the row's own control, not from the name", async () => {
    const onTogglePlayer = vi.fn();
    const scope = await mount({ onTogglePlayer });

    const add = scope.querySelector("button[aria-label='Add Aria#1111 to the lineup']");
    expect(add?.getAttribute("aria-pressed")).toBe("false");

    await click(add);
    expect(onTogglePlayer).toHaveBeenCalledTimes(1);
    expect(onTogglePlayer.mock.calls[0][0].id).toBe(1);

    // The name used to be the toggle, so reading a row risked changing it.
    const nameNodes = [...scope.querySelectorAll("button")].filter(
      (node) => node.textContent?.trim() === "Aria#1111",
    );
    expect(nameNodes).toEqual([]);
  });

  it("announces a row already in the lineup as the way back out", async () => {
    const onTogglePlayer = vi.fn();
    const scope = await mount({ selectedIds: [1], onTogglePlayer });

    const remove = scope.querySelector("button[aria-label='Remove Aria#1111 from the lineup']");
    expect(remove?.getAttribute("aria-pressed")).toBe("true");
    expect(scope.querySelector("button[aria-label='Add Borys#2222 to the lineup']")).not.toBeNull();

    await click(remove);
    expect(onTogglePlayer.mock.calls[0][0].id).toBe(1);
  });

  it("stays the simplified pool row: no status, no exclude, no state chips", async () => {
    // Statuses and pool exclusion belong to a tournament registration, which a
    // workspace player does not have; both are already edited from the
    // registrations table. Re-adding them here would be a third copy.
    const scope = await mount({ selectedIds: [1], onTogglePlayer: vi.fn() });

    expect(scope.textContent).not.toMatch(/Exclude|Include in balancer|Ready|Flex/);
    expect(scope.querySelector("[data-slot='badge']")).toBeNull();
    // What the pool row does give it, and it keeps: role glyphs, the top rank
    // and a BattleTag copy control.
    expect(scope.querySelector("button[title='Copy BattleTag']")).not.toBeNull();
  });
});
