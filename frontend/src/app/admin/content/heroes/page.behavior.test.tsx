// @vitest-environment happy-dom
//
// The character catalogue per game. A League sync runs in the background: the click opens its progress modal, the
// starter's realtime snapshots drive the stage rows, and the finished sync refreshes the table with real Champion
// rows under the game's own words and classes. Overwatch's catalogue stays its own.
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/error";
import { useAuthProfileStore } from "@/stores/auth-profile.store";
import type { CatalogSyncStage, CatalogSyncState } from "@/types/catalog.types";
import type { RealtimeEventEnvelope } from "@/types/realtime.types";

import { LOL, OVERWATCH, buttonByText, click, mountContentPage, settle, stubMatchMedia } from "../harness.behavior";
import HeroesAdminPage from "./page";

type Call = { path: string; options?: { method?: string; query?: Record<string, unknown>; body?: unknown } };
const calls: Call[] = [];
let lolRows: unknown[] = [];
/** What `GET /catalog-sync/lol` answers; a POST answers `started` unless `postError` is set. */
let syncState: CatalogSyncState | null = null;
let postError: Error | null = null;
const realtime = new Map<string, (event: RealtimeEventEnvelope<unknown>) => void>();

const SYNC = "/api/v1/admin/catalog-sync/lol";
const ME = 42;

const row = (id: number, discipline: string, name: string, attrs: Record<string, unknown>) => ({
  id, created_at: "2026-10-14T00:00:00Z", updated_at: null, discipline, kind: "character", slug: name.toLowerCase(),
  name, image_path: null, parent_id: null, attrs, aliases: [], active: true, parent: null
});
const stage = (
  key: CatalogSyncStage["key"],
  state: CatalogSyncStage["state"],
  { done = null, total = null, created = null }: Partial<Pick<CatalogSyncStage, "done" | "total" | "created">> = {}
): CatalogSyncStage => ({ key, state, done, total, created });
const snapshot = (second: string, stages: CatalogSyncStage[], patch: Partial<CatalogSyncState> = {}): CatalogSyncState => ({
  discipline: "lol", status: "running", source: null, started_by: ME, started_at: "2026-10-21T10:00:00Z",
  updated_at: `2026-10-21T10:00:${second}Z`, error: null, stages, ...patch
});
const started = snapshot("00", [stage("source", "running"), stage("map", "pending"), stage("character", "pending")]);

vi.mock("@/lib/api/fetch", () => ({
  apiFetch: (path: string, options?: Call["options"]) => {
    calls.push({ path, options });
    if (path.startsWith("/api/v1/admin/catalog-sync/")) {
      if (options?.method !== "POST") return Promise.resolve({ json: async () => syncState });
      return postError ? Promise.reject(postError) : Promise.resolve({ json: async () => started });
    }
    const results =
      path === "/api/v1/admin/catalog/lol/character" ? lolRows
        : path === "/api/v1/admin/catalog/overwatch/character" ? [row(1, "overwatch", "Ana", { class: "support" })] : [];
    return Promise.resolve({ json: async () => ({ results, total: results.length, page: 1, per_page: 25 }) });
  }
}));
vi.mock("@/services/realtime.service", () => ({
  realtimeClient: {
    subscribe: (topic: string, onEvent: (event: RealtimeEventEnvelope<unknown>) => void) => {
      realtime.set(topic, onEvent);
      return () => realtime.delete(topic);
    }
  }
}));
vi.mock("@/lib/datetime/client", () => ({ useFormatter: () => ({ dateTime: (value: Date) => value.toISOString() }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ isSuperuser: true, isLoaded: true }) }));
vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() } }));
vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);

let page: Awaited<ReturnType<typeof mountContentPage>> | null = null;

const dialog = () => document.querySelector('[role="dialog"]');
const posts = () => calls.filter((call) => call.path === SYNC && call.options?.method === "POST").length;

/** One `catalog_sync.progress` frame on the starter's own topic. */
async function push(data: CatalogSyncState) {
  const onEvent = realtime.get(`user:${ME}:catalog-sync`);
  if (!onEvent) throw new Error("not subscribed to the catalog sync topic");
  await act(async () => {
    onEvent({ event_id: 0, event_type: "catalog_sync.progress", schema_version: 1, occurred_at: data.updated_at, actor_user_id: ME, data });
  });
  await settle();
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  calls.length = 0;
  lolRows = [];
  syncState = null;
  postError = null;
  useAuthProfileStore.setState({ status: "authenticated", user: { id: ME } as never });
  window.history.replaceState(null, "", "/admin/content/heroes");
  stubMatchMedia();
});
afterEach(async () => {
  await page?.unmount();
  page = null;
  realtime.clear();
  useAuthProfileStore.setState({ status: "idle", user: undefined });
});

it("syncs League's catalogue in the background, stage by stage, then lists the actual Champion rows", async () => {
  page = await mountContentPage(LOL, <HeroesAdminPage />);
  expect(page.container.textContent).toContain("No entries yet");
  expect(page.container.textContent).toContain("Create Champion");
  // The page reads the last sync but never opens the modal on its own.
  expect(calls).toContainEqual({ path: SYNC, options: undefined });
  expect(dialog()).toBeNull();

  await click(buttonByText("Sync League of Legends catalog"));

  expect(calls).toContainEqual({ path: SYNC, options: { method: "POST" } });
  expect(dialog()?.textContent).toContain("League of Legends catalog sync");
  expect(dialog()?.textContent).toContain("Fetching data from the source");
  expect(buttonByText("Sync in progress")).toBeDefined();

  await push(
    snapshot("05", [stage("source", "done"), stage("map", "done", { done: 0, total: 0, created: 2 }), stage("character", "running", { done: 23, total: 41 })], {
      source: "Data Dragon"
    })
  );
  expect(dialog()?.textContent).toContain("Fetching data from Data Dragon");
  expect(dialog()?.textContent).toContain("new: 2");
  expect(dialog()?.textContent).toContain("Champion");
  expect(dialog()?.textContent).toContain("images 23/41");
  expect(buttonByText("Hide")).toBeDefined();
  expect(page.container.textContent).not.toContain("Ahri");

  lolRows = [row(501, "lol", "Ahri", { class: "Mage", color: "#8844ff" })];
  await push(
    snapshot(
      "09",
      [stage("source", "done"), stage("map", "done", { done: 0, total: 0, created: 2 }), stage("character", "done", { done: 41, total: 41, created: 5 })],
      { source: "Data Dragon", status: "done" }
    )
  );

  expect(dialog()?.textContent).toContain("Sync finished");
  expect(dialog()?.textContent).toContain("new: 5");
  expect(dialog()?.textContent).not.toContain("images");
  expect(buttonByText("Hide")).toBeUndefined();
  expect(buttonByText("Sync League of Legends catalog")).toBeDefined();
  // The finished sync refreshed the table behind the modal.
  expect(page.container.textContent).toContain("Ahri");
  expect(page.container.textContent).toContain("Mage");
  expect(calls.some((call) => call.path.includes("/overwatch/"))).toBe(false);
});

it("opens the run already going when the start is refused with 409", async () => {
  page = await mountContentPage(LOL, <HeroesAdminPage />);
  // Another admin started it after this page loaded.
  syncState = snapshot("05", [stage("source", "done"), stage("map", "running", { done: 3, total: 41 }), stage("character", "pending")], {
    source: "Data Dragon",
    started_by: 7
  });
  postError = new ApiError(409, [{ msg: "A catalog sync is already running", code: "catalog_sync_running" }]);

  await click(buttonByText("Sync League of Legends catalog"));

  expect(dialog()?.textContent).toContain("images 3/41");
  expect(dialog()?.textContent).toContain("Started by another admin");
  expect(dialog()?.textContent).not.toContain("Could not start");

  // Hiding leaves it running; the toolbar reopens it without another start.
  await click(buttonByText("Hide"));
  expect(dialog()).toBeNull();
  await click(buttonByText("Sync in progress"));
  expect(dialog()?.textContent).toContain("images 3/41");
  expect(posts()).toBe(1);
});

it("lists Overwatch heroes from Overwatch's own catalogue with its classes", async () => {
  page = await mountContentPage(OVERWATCH, <HeroesAdminPage />);

  expect(calls.some((call) => call.path === "/api/v1/admin/catalog/overwatch/character")).toBe(true);
  expect(calls.some((call) => call.path.includes("/lol/"))).toBe(false);
  expect(page.container.textContent).toContain("Ana");
  expect(page.container.textContent).toContain("Support");
  expect(page.container.textContent).toContain("Create Hero");
});
