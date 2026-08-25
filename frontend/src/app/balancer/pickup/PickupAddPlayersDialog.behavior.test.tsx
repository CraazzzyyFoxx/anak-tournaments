// @vitest-environment happy-dom
//
// This dialog is the only place in the mix tool where two lists have to agree
// with each other in real time — the workspace roster on the left, the lineup on
// the right — so what breaks here is the agreement, not the rendering. Pinned:
//
//  1. the seat counter and the role gauges read from the mix rows, and say
//     "over a full lobby" rather than silently showing an unbalanceable pool;
//  2. a row already in the mix offers Remove, not Add, so a host cannot add
//     somebody twice by rereading the page;
//  3. the keyboard path works without the pointer: the search field keeps focus,
//     the arrows move a cursor and Enter acts on it — the whole point of adding
//     twelve people in twelve keystrokes;
//  4. the "last mix" filter lists that mix's lineup, and searching inside it
//     filters locally instead of re-querying the workspace;
//  5. rank pickers write the *author* layer (this host's own book) and show an
//     inherited workspace value dimmed rather than as an empty slot;
//  6. a read-only mix still reads: ranks stay editable, membership does not.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CustomGame, CustomGamePlayer } from "@/services/custom-game.service";
import type { RosterMember } from "@/services/workspace-player.service";

import { PickupAddPlayersDialog } from "./PickupAddPlayersDialog";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const list = vi.fn();
const upsert = vi.fn();
const setRanks = vi.fn();
const getGame = vi.fn();

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

vi.mock("@/services/custom-game.service", () => ({
  customGameKeys: {
    all: (workspaceId: number) => ["custom-games", workspaceId],
    one: (workspaceId: number, gameId: number) => ["custom-games", workspaceId, gameId],
  },
  customGameService: { get: (...args: unknown[]) => getGame(...args) },
}));

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), apiError: vi.fn() } }));
vi.mock("@/components/PlayerRoleIcon", () => ({ default: () => null }));
vi.mock("@/components/DivisionIcon", () => ({ default: () => null }));
vi.mock("@/hooks/useCurrentWorkspace", () => ({ useDivisionGrid: () => ({ tiers: [] }) }));
// The real picker needs the workspace division grid; the row only needs a
// control that carries its accessible name, its value and its disabled state.
vi.mock("@/app/balancer/components/DivisionRankPicker", () => ({
  DivisionRankPicker: ({
    rank,
    label,
    disabled,
    onChange,
  }: {
    rank: number | null | undefined;
    label: string;
    disabled?: boolean;
    onChange: (rank: number | null) => void;
  }) => (
    <button
      type="button"
      aria-label={label}
      data-rank={rank ?? ""}
      disabled={disabled}
      onClick={() => onChange(1200)}
    />
  ),
}));

const WORKSPACE_ID = 7;

function member(
  memberId: number,
  battleTag: string,
  overrides: Partial<RosterMember> = {},
): RosterMember {
  return {
    member_id: memberId,
    player_id: memberId * 10,
    battle_tag: battleTag,
    display_name: null,
    ranks: {},
    author_ranks: {},
    ...overrides,
  };
}

function seated(memberId: number, battleTag: string, overrides: Partial<CustomGamePlayer> = {}) {
  return {
    id: memberId,
    workspace_member_id: memberId,
    display_name: null,
    battle_tag: battleTag,
    team_index: null,
    sort_order: memberId,
    is_active: true,
    roles: ["tank"],
    ranks: { tank: 2400 },
    rank_sources: { tank: "workspace" as const },
    author_ranks: {},
    ...overrides,
  };
}

const MIXES: CustomGame[] = [
  {
    id: 12,
    workspace_id: WORKSPACE_ID,
    host_user_id: 1,
    name: "Tonight",
    status: "draft",
    config_json: null,
    result_json: null,
    outcome_json: null,
  },
  {
    id: 11,
    workspace_id: WORKSPACE_ID,
    host_user_id: 1,
    name: "Averet",
    status: "completed",
    config_json: null,
    result_json: null,
    outcome_json: null,
  },
];

function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

const onTogglePlayer = vi.fn();

async function mount(
  props: {
    rows?: CustomGamePlayer[];
    canEdit?: boolean;
    canWrite?: boolean;
    games?: CustomGame[];
  } = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(container).render(
      <QueryClientProvider client={client}>
        <PickupAddPlayersDialog
          open
          onOpenChange={vi.fn()}
          workspaceId={WORKSPACE_ID}
          canEdit={props.canEdit ?? true}
          canWrite={props.canWrite ?? true}
          rows={props.rows ?? []}
          games={props.games ?? MIXES}
          currentGameId={12}
          onTogglePlayer={onTogglePlayer}
        />
      </QueryClientProvider>,
    );
  });
  // Both queries resolve after the first commit; a second flush lets their state
  // updates land inside `act`.
  await act(async () => {
    await tick();
  });
  // The dialog renders in a portal, so the assertions read the document.
  return document.body;
}

function click(node: Element | null | undefined) {
  if (!node) throw new Error("Expected a clickable node");
  return act(async () => {
    node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
  });
}

function key(node: Element | null | undefined, name: string) {
  if (!node) throw new Error("Expected a focusable node");
  return act(async () => {
    node.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
    await tick();
  });
}

function byLabel(label: string) {
  return document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`);
}

function search() {
  return byLabel("Search the workspace roster") as HTMLInputElement;
}

/**
 * Types into a controlled field and drains the follow-up work: React only sees
 * the change through the prototype's value setter, and the deferred search value
 * re-renders once more after that.
 */
function type(value: string) {
  const input = search();
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
 * lower priority than the one `type` flushes.
 */
function settle() {
  return act(async () => {
    await tick();
    await tick();
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  list.mockResolvedValue({
    results: [member(1, "Aria#1111"), member(2, "Borys#2222"), member(3, "Cleo#3333")],
    total: 3,
    page: 1,
    per_page: 24,
  });
  getGame.mockResolvedValue({
    ...MIXES[1],
    players: [seated(2, "Borys#2222"), seated(9, "Dima#9999")],
  });
});

describe("PickupAddPlayersDialog", () => {
  it("counts the lobby against a full one and names the overflow", async () => {
    const rows = Array.from({ length: 12 }, (_unused, index) =>
      seated(100 + index, `P${index}#1000`),
    );
    const scope = await mount({ rows });

    expect(scope.textContent).toContain("2 over a full lobby");
    // 12 tanks against a demand of 2, and nothing for the other two roles.
    expect(scope.textContent).toContain("12/2");
    expect(scope.textContent).toContain("0/4");
  });

  it("says how many more a lobby needs while it is short", async () => {
    const scope = await mount({ rows: [seated(1, "Aria#1111")] });

    expect(scope.textContent).toContain("9 more for a full lobby");
  });

  it("offers Remove for somebody already in the mix and Add for everyone else", async () => {
    await mount({ rows: [seated(2, "Borys#2222")] });

    expect(byLabel("Remove Borys#2222 from this mix")).not.toBeNull();
    expect(byLabel("Add Aria#1111 to this mix")).not.toBeNull();
    expect(byLabel("Add Borys#2222 to this mix")).toBeNull();
  });

  it("adds the row under the keyboard cursor without touching the pointer", async () => {
    await mount();

    // The cursor starts on the first row, so two downs land on the third.
    await key(search(), "ArrowDown");
    await key(search(), "ArrowDown");
    await key(search(), "Enter");

    expect(onTogglePlayer).toHaveBeenCalledWith(3);
  });

  it("keeps the cursor inside the list at both ends", async () => {
    await mount();

    await key(search(), "ArrowUp");
    await key(search(), "Enter");
    expect(onTogglePlayer).toHaveBeenCalledWith(1);

    onTogglePlayer.mockClear();
    for (let step = 0; step < 8; step += 1) {
      await key(search(), "ArrowDown");
    }
    await key(search(), "Enter");
    expect(onTogglePlayer).toHaveBeenCalledWith(3);
  });

  it("swaps the roster for the last mix's lineup, and filters that locally", async () => {
    const scope = await mount();

    await click(findChip(scope, "Averet #11"));

    // Dima is not on the workspace page above, so his row proves the list came
    // from the mix rather than from a re-query.
    expect(byLabel("Add Dima#9999 to this mix")).not.toBeNull();
    expect(byLabel("Add Aria#1111 to this mix")).toBeNull();

    const callsBefore = list.mock.calls.length;
    await type("dima");
    await settle();

    expect(byLabel("Add Dima#9999 to this mix")).not.toBeNull();
    expect(byLabel("Add Borys#2222 to this mix")).toBeNull();
    // Local filtering only: the workspace query must not be asked again.
    expect(list.mock.calls.length).toBe(callsBefore);
  });

  it("writes a rank into this host's own book, one role at a time", async () => {
    await mount();

    await click(byLabel("Tank rank for Aria#1111"));

    expect(setRanks).toHaveBeenCalledWith(WORKSPACE_ID, 1, {
      scope: "author",
      ranks: { tank: 1200 },
      clear: [],
    });
  });

  it("shows an inherited workspace rank rather than an empty slot", async () => {
    list.mockResolvedValue({
      results: [member(1, "Aria#1111", { ranks: { tank: 2400 }, author_ranks: { dps: 2600 } })],
      total: 1,
      page: 1,
      per_page: 24,
    });
    await mount();

    // Inherited: the value shows, and the label says where it came from.
    expect(
      byLabel("Tank rank for Aria#1111, inherited 2400 from the workspace")?.dataset.rank,
    ).toBe("2400");
    // The host's own entry keeps the plain label.
    expect(byLabel("DPS rank for Aria#1111")?.dataset.rank).toBe("2600");
  });

  it("locks membership on a closed mix but still lets ranks be corrected", async () => {
    await mount({ canWrite: false, rows: [seated(2, "Borys#2222")] });

    expect(byLabel("Add Aria#1111 to this mix")?.hasAttribute("disabled")).toBe(true);
    expect(byLabel("Remove Borys#2222 from this mix")?.hasAttribute("disabled")).toBe(true);
    expect(byLabel("Tank rank for Aria#1111")?.hasAttribute("disabled")).toBe(false);

    // Enter must not smuggle a write past the lock either.
    await key(search(), "Enter");
    expect(onTogglePlayer).not.toHaveBeenCalled();
  });

  it("separates an empty workspace from a search that matched nothing", async () => {
    list.mockResolvedValue({ results: [], total: 0, page: 1, per_page: 24 });
    const scope = await mount();
    expect(scope.textContent).toContain("No players in this workspace yet");

    await type("zzz");
    await settle();
    expect(scope.textContent).toContain("Nobody matches");
  });

  it("offers no last-mix filter when this is the only mix", async () => {
    const scope = await mount({ games: [MIXES[0]] });

    expect(findChip(scope, "Averet #11")).toBeUndefined();
    expect(getGame).not.toHaveBeenCalled();
  });
});

function findChip(scope: Element, label: string) {
  return [...scope.querySelectorAll("button")].find((node) => node.textContent?.includes(label));
}
