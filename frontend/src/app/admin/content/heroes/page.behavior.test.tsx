// @vitest-environment happy-dom
//
// The character catalogue per game. A League sync followed by a listing must render real Champion rows under the
// game's own words and classes; Overwatch's catalogue stays its own.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LOL, OVERWATCH, buttonByText, click, mountContentPage, stubMatchMedia } from "../harness.behavior";
import HeroesAdminPage from "./page";

type Call = { path: string; options?: { method?: string; query?: Record<string, unknown>; body?: unknown } };
const calls: Call[] = [];
let lolRows: unknown[] = [];

const row = (id: number, discipline: string, name: string, attrs: Record<string, unknown>) => ({
  id, created_at: "2026-10-14T00:00:00Z", updated_at: null, discipline, kind: "character", slug: name.toLowerCase(),
  name, image_path: null, parent_id: null, attrs, aliases: [], active: true, parent: null
});

vi.mock("@/lib/api/fetch", () => ({
  apiFetch: (path: string, options?: Call["options"]) => {
    calls.push({ path, options });
    if (path === "/api/v1/admin/catalog-sync/lol") {
      lolRows = [row(501, "lol", "Ahri", { class: "Mage", color: "#8844ff" })];
      return Promise.resolve({ json: async () => ({ success: true }) });
    }
    const results =
      path === "/api/v1/admin/catalog/lol/character" ? lolRows
        : path === "/api/v1/admin/catalog/overwatch/character" ? [row(1, "overwatch", "Ana", { class: "support" })] : [];
    return Promise.resolve({ json: async () => ({ results, total: results.length, page: 1, per_page: 25 }) });
  }
}));
vi.mock("@/lib/datetime/client", () => ({ useFormatter: () => ({ dateTime: (value: Date) => value.toISOString() }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ isSuperuser: true, isLoaded: true }) }));
vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() } }));
vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);

let page: Awaited<ReturnType<typeof mountContentPage>> | null = null;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  calls.length = 0;
  lolRows = [];
  window.history.replaceState(null, "", "/admin/content/heroes");
  stubMatchMedia();
});
afterEach(async () => {
  await page?.unmount();
  page = null;
});

it("syncs League's catalogue and then lists the actual Champion rows", async () => {
  page = await mountContentPage(LOL, <HeroesAdminPage />);
  expect(page.container.textContent).toContain("No entries yet");
  expect(page.container.textContent).toContain("Create Champion");

  await click(buttonByText("Sync League of Legends catalog"));

  expect(calls).toContainEqual({ path: "/api/v1/admin/catalog-sync/lol", options: { method: "POST" } });
  expect(page.container.textContent).toContain("Ahri");
  expect(page.container.textContent).toContain("Mage");
  expect(calls.some((call) => call.path.includes("/overwatch/"))).toBe(false);
});

it("lists Overwatch heroes from Overwatch's own catalogue with its classes", async () => {
  page = await mountContentPage(OVERWATCH, <HeroesAdminPage />);

  expect(calls.some((call) => call.path === "/api/v1/admin/catalog/overwatch/character")).toBe(true);
  expect(calls.some((call) => call.path.includes("/lol/"))).toBe(false);
  expect(page.container.textContent).toContain("Ana");
  expect(page.container.textContent).toContain("Support");
  expect(page.container.textContent).toContain("Create Hero");
});
