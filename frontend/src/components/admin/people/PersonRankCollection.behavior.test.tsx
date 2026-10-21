// @vitest-environment happy-dom
//
// The person's rank collection list in the Ranks tab's game. Three things it must get right:
//
//  1. a status says something only when it needs attention: `ok` draws no pill, a failure streak shows its count;
//  2. a re-fetch is posted under the game the list shows, for one account or for all of them;
//  3. "No account linked" is a fact about a successful read of a game that collects ranks. While the read runs, when
//     it fails, or for a game that collects no ranks, the list says that instead.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type { RankCollectionStatusRow } from "@/types/admin.types";

import { PersonRankCollection } from "./PersonRankCollection";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getRankCollectionStatus = vi.fn();
const triggerRankCollection = vi.fn();

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
vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn(), warning: vi.fn() }
}));

const account = (id: number, handle: string, overrides: Partial<RankCollectionStatusRow> = {}): RankCollectionStatusRow => ({
  social_account_id: id,
  handle,
  status: "ok",
  last_checked_at: null,
  last_success_at: null,
  last_error: null,
  consecutive_failures: 0,
  next_eligible_at: null,
  priority_tier: 1,
  ...overrides
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

/** Renders (or re-renders) the list the tab keys by game. */
async function render(game = "overwatch", supported = true) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <QueryClientProvider client={client}>
          <PersonRankCollection key={game} personId={42} game={game} supported={supported} />
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

const collectFor = (handle: string) => container.querySelector(`button[aria-label="Collect rank for ${handle}"]`);
const collectAll = () =>
  [...container.querySelectorAll("button")].find((button) => button.textContent === en.adminPeople.rank.collectAll);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  getRankCollectionStatus.mockReset().mockImplementation(async (_userId: number, discipline: string) =>
    discipline === "overwatch"
      ? [
          account(1, "Alice#2100"),
          account(2, "Alice#2200", { status: "not_found", consecutive_failures: 3, last_error: "404 from the provider" })
        ]
      : [account(5, "Alice#EUW")]
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

describe("PersonRankCollection", () => {
  it("lists the accounts without selection, a pill only for the one that needs attention", async () => {
    await render();

    const rows = [...container.querySelectorAll("li")];
    expect(rows).toHaveLength(2);
    expect(container.querySelector('[role="checkbox"]')).toBeNull();
    expect(rows[0].textContent).not.toContain(en.collectors.rank.status.ok);
    expect(rows[1].textContent).toContain(en.collectors.rank.status.not_found);
    const failures = [...rows[1].querySelectorAll("span")].find((span) => span.textContent === "3 failures");
    expect(failures?.getAttribute("title")).toBe("404 from the provider");
  });

  it("posts one account or all of them under the game it shows", async () => {
    await render();
    await click(collectFor("Alice#2200"));
    expect(triggerRankCollection).toHaveBeenLastCalledWith("overwatch", { user_id: 42, social_account_ids: [2] });

    await render("lol");
    expect(getRankCollectionStatus).toHaveBeenLastCalledWith(42, "lol");
    await click(collectAll());
    expect(triggerRankCollection).toHaveBeenLastCalledWith("lol", { user_id: 42, social_account_ids: null });
  });

  it("shows the error, not an empty account list, when the read fails", async () => {
    getRankCollectionStatus.mockRejectedValue(new Error("boom"));
    await render();

    expect(container.querySelector("[role=alert]")).not.toBeNull();
    expect(container.textContent).not.toContain(en.adminPeople.rank.noTags);
  });

  it("says the game collects no ranks instead of claiming no account is linked", async () => {
    await render("lol", false);

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
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(container.textContent).not.toContain(en.adminPeople.rank.noTags);

    await act(async () => answer([]));
    await settle();
    expect(container.textContent).toContain(en.adminPeople.rank.noTags);
    expect(collectAll()).toBeUndefined();
  });
});
