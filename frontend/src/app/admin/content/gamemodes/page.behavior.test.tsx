// @vitest-environment happy-dom
//
// A kind the game does not declare is not an empty catalogue: League has no mode, so nothing is requested and the
// page says it does not exist for that game.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LOL, OVERWATCH, mountContentPage, stubMatchMedia } from "../harness.behavior";
import GamemodesAdminPage from "./page";

const paths: string[] = [];
vi.mock("@/lib/api/fetch", () => ({
  apiFetch: (path: string) => {
    paths.push(path);
    return Promise.resolve({ json: async () => ({ results: [], total: 0, page: 1, per_page: 25 }) });
  }
}));
vi.mock("@/lib/datetime/client", () => ({ useFormatter: () => ({ dateTime: (value: Date) => value.toISOString() }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ isSuperuser: true, isLoaded: true }) }));
vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() } }));
vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);

let page: Awaited<ReturnType<typeof mountContentPage>> | null = null;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  paths.length = 0;
  window.history.replaceState(null, "", "/admin/content/gamemodes");
  stubMatchMedia();
});
afterEach(async () => {
  await page?.unmount();
  page = null;
});

it("says the game has no mode catalogue and requests nothing for it", async () => {
  page = await mountContentPage(LOL, <GamemodesAdminPage />);

  expect(page.container.textContent).toContain("League of Legends has no Mode catalog");
  expect(paths).toEqual([]);
});

it("lists a declared kind from that game's catalogue", async () => {
  page = await mountContentPage(OVERWATCH, <GamemodesAdminPage />);

  expect(paths).toContain("/api/v1/admin/catalog/overwatch/mode");
  expect(page.container.textContent).toContain("Create Mode");
});
