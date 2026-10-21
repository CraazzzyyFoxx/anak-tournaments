// @vitest-environment happy-dom
//
// The person's rank collection panel follows the hub's game (`?discipline=`). Two things it must get right:
//
//  1. a selection belongs to one game's accounts. The panel stays mounted across a game switch, so a selection made
//     under Overwatch must not be posted as League's — the collector would queue nothing for ids it does not own;
//  2. "No account linked" is a fact about a successful read of a game that collects ranks. While the game resolves,
//     when its list fails, or for a game that collects no ranks, the panel says that instead.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameScopeState } from "@/hooks/useGameScope";
import type { NativeRankCollector } from "@/hooks/useNativeRankCollector";
import en from "@/i18n/messages/en.json";
import type { RankCollectionStatusRow } from "@/types/admin.types";
import type { DisciplineDescriptor } from "@/types/discipline.types";

import { RankPlayerPanel } from "./PersonRankPanel";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getRankCollectionStatus = vi.fn();
const triggerRankCollection = vi.fn();

const scope = (resolution: unknown, isError = false) =>
  ({ resolution, isError, refetch: vi.fn() }) as unknown as GameScopeState;
const pick = (code: string, supported: boolean): NativeRankCollector => ({
  scope: scope({ game: { kind: "game", code, source: "explicit" }, tabs: false }),
  descriptor: { code, name: code } as DisciplineDescriptor,
  supported
});
let collector: NativeRankCollector = pick("overwatch", true);

vi.mock("@/hooks/useNativeRankCollector", () => ({ useNativeRankCollector: () => collector }));
vi.mock("@/hooks/useCurrentWorkspace", () => ({ useCurrentWorkspaceId: () => 3 }));
vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (selector: (state: { currentWorkspaceId: number | null }) => unknown) =>
    selector({ currentWorkspaceId: 3 })
}));
vi.mock("@/services/admin.service", () => ({
  default: {
    getRankCollectionStatus: (...args: unknown[]) => getRankCollectionStatus(...args),
    triggerRankCollection: (...args: unknown[]) => triggerRankCollection(...args)
  }
}));
vi.mock("@/components/RankHistory", () => ({ default: () => null }));
vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn(), warning: vi.fn() }
}));

const account = (id: number, handle: string): RankCollectionStatusRow => ({
  social_account_id: id,
  handle,
  status: "ok",
  last_checked_at: null,
  last_success_at: null,
  last_error: null,
  consecutive_failures: 0,
  next_eligible_at: null,
  priority_tier: 1
});

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

async function settle(turns = 6) {
  for (let turn = 0; turn < turns; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

/** Renders (or re-renders, after `collector` changed) the panel the person hub keeps mounted. */
async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <QueryClientProvider client={client}>
          <RankPlayerPanel userId={42} />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  await settle();
}

async function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => {
    element!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle(4);
}

const checkbox = (handle: string) => container.querySelector(`[role="checkbox"][aria-label="Select ${handle}"]`);
const collectSelected = () =>
  Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.startsWith("Collect selected")
  );

beforeEach(() => {
  collector = pick("overwatch", true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  getRankCollectionStatus.mockReset().mockImplementation(async (_userId: number, discipline: string) =>
    discipline === "overwatch" ? [account(1, "Alice#2100")] : [account(2, "Alice#EUW")]
  );
  triggerRankCollection.mockReset().mockResolvedValue({ enqueued: 1 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("RankPlayerPanel", () => {
  it("drops the selection when the hub switches game, and posts only the new game's accounts", async () => {
    await render();
    await click(checkbox("Alice#2100"));
    expect(collectSelected()?.textContent).toBe("Collect selected (1)");

    collector = pick("lol", true);
    await render();

    expect(getRankCollectionStatus).toHaveBeenLastCalledWith(42, "lol");
    expect(collectSelected()).toBeUndefined();
    expect(checkbox("Alice#EUW")?.getAttribute("aria-checked")).toBe("false");

    await click(checkbox("Alice#EUW"));
    await click(collectSelected());

    expect(triggerRankCollection).toHaveBeenCalledTimes(1);
    expect(triggerRankCollection).toHaveBeenCalledWith("lol", { user_id: 42, social_account_ids: [2] });
  });

  it("shows a skeleton, not an empty account list, while the game resolves", async () => {
    collector = { scope: scope(null), descriptor: null, supported: false };
    await render();

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(container.textContent).not.toContain(en.adminPeople.rank.noTags);
    expect(getRankCollectionStatus).not.toHaveBeenCalled();
  });

  it("shows the error when the games cannot be read", async () => {
    collector = { scope: scope(null, true), descriptor: null, supported: false };
    await render();

    expect(container.querySelector("[role=alert]")).not.toBeNull();
    expect(container.textContent).not.toContain(en.adminPeople.rank.noTags);
    expect(getRankCollectionStatus).not.toHaveBeenCalled();
  });

  it("says the game collects no ranks instead of claiming no account is linked", async () => {
    collector = pick("lol", false);
    await render();

    expect(container.textContent).toContain(en.common.discipline.widgetUnsupported);
    expect(container.textContent).not.toContain(en.adminPeople.rank.noTags);
    expect(getRankCollectionStatus).not.toHaveBeenCalled();
  });

  it("says no account is linked only after the game's status read succeeds empty", async () => {
    let answer: (rows: RankCollectionStatusRow[]) => void = () => {};
    getRankCollectionStatus.mockImplementation(
      () => new Promise<RankCollectionStatusRow[]>((resolve) => (answer = resolve))
    );
    await render();
    expect(container.textContent).not.toContain(en.adminPeople.rank.noTags);

    await act(async () => answer([]));
    await settle();
    expect(container.textContent).toContain(en.adminPeople.rank.noTags);
  });
});
