// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LOL, OVERWATCH, buttonByText, click, mountContentPage, settle, stubMatchMedia } from "../harness.behavior";
import MapsAdminPage from "./page";
import { act } from "react";

type Call = { path: string; options?: { method?: string; query?: Record<string, unknown>; body?: unknown } };
const calls: Call[] = [];
const MODE = {
  id: 907, created_at: "2026-10-14T00:00:00Z", updated_at: null,
  discipline: "overwatch", kind: "mode", slug: "push", name: "Push", image_path: null,
  parent_id: null, attrs: {}, aliases: [], active: true, parent: null
};

vi.mock("@/lib/api/fetch", () => ({
  apiFetch: (path: string, options?: Call["options"]) => {
    calls.push({ path, options });
    // No sync ran lately.
    if (path.startsWith("/api/v1/admin/catalog-sync/")) return Promise.resolve({ json: async () => null });
    // Two modes: a filter with a single option is not offered.
    const results = path === "/api/v1/admin/catalog/overwatch/mode" ? [MODE, { ...MODE, id: 909, slug: "control", name: "Control" }] : [];
    const reply = options?.method === "POST"
      ? { ...MODE, id: 908, kind: "map", name: "Ilios", parent_id: 907, attrs: { in_competitive: true }, parent: MODE }
      : { results, total: results.length, page: 1, per_page: -1 };
    return Promise.resolve({ json: async () => reply });
  }
}));
vi.mock("@/lib/datetime/client", () => ({
  useFormatter: () => ({ dateTime: (value: Date) => value.toISOString() })
}));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ isSuperuser: true, isLoaded: true }) }));
vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() } }));
vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);

let page: Awaited<ReturnType<typeof mountContentPage>> | null = null;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  calls.length = 0;
  window.history.replaceState(null, "", "/admin/content/maps");
  stubMatchMedia();
});

afterEach(async () => {
  await page?.unmount();
  page = null;
});

async function fillName(value: string) {
  const label = Array.from(document.querySelectorAll('[role="dialog"] label')).find((element) => element.textContent === "Name");
  const input = document.getElementById(label?.getAttribute("for") ?? "") as HTMLInputElement;
  expect(input).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("loads the selected game's own modes for the create dialog and files the map under one", async () => {
  page = await mountContentPage(OVERWATCH, <MapsAdminPage />);
  expect(calls).toContainEqual({ path: "/api/v1/admin/catalog/overwatch/mode", options: { signal: expect.anything(), query: { per_page: -1 } } });
  expect(calls.some((call) => call.path.includes("/lol/"))).toBe(false);

  await click(buttonByText("Create Map"));
  await click(document.querySelector('[role="dialog"] [role="combobox"]'));
  await click(Array.from(document.querySelectorAll('[role="option"]')).find((element) => element.textContent?.trim() === "Push"));
  await fillName("Ilios");
  await click(document.querySelector('[role="dialog"] button[type="submit"]'));

  expect(calls).toContainEqual({
    path: "/api/v1/admin/catalog/overwatch/map",
    options: {
      method: "POST",
      body: { name: "Ilios", image_path: null, aliases: [], active: true, parent_id: 907, attrs: { in_competitive: true } }
    }
  });
});

it("narrows the list by the selected mode through parent_id", async () => {
  page = await mountContentPage(OVERWATCH, <MapsAdminPage />);
  await click(document.querySelector('[aria-label="Add filter"]'));
  await click(Array.from(document.querySelectorAll('[cmdk-item=""]')).find((element) => element.textContent?.trim().startsWith("Mode")));
  await click(Array.from(document.querySelectorAll('[cmdk-item=""]')).find((element) => element.textContent?.trim().startsWith("Push")));

  const mapCall = calls.filter((call) => call.path === "/api/v1/admin/catalog/overwatch/map").at(-1);
  expect(mapCall?.options?.query?.parent_id).toBe(907);
});

it("offers the status chip even without modes, and Inactive goes out as active=false", async () => {
  page = await mountContentPage(LOL, <MapsAdminPage />);
  await click(document.querySelector('[aria-label="Add filter"]'));
  await click(Array.from(document.querySelectorAll('[cmdk-item=""]')).find((element) => element.textContent?.trim().startsWith("Status")));
  await click(Array.from(document.querySelectorAll('[cmdk-item=""]')).find((element) => element.textContent?.trim().startsWith("Inactive")));

  const mapCall = calls.filter((call) => call.path === "/api/v1/admin/catalog/lol/map").at(-1);
  expect(mapCall?.options?.query?.active).toBe(false);
});

it("for a game without modes asks for no modes and files a map under nothing", async () => {
  page = await mountContentPage(LOL, <MapsAdminPage />);
  await settle();
  expect(calls.some((call) => call.path.endsWith("/mode"))).toBe(false);
  expect(calls).toContainEqual({ path: "/api/v1/admin/catalog/lol/map", options: expect.objectContaining({ query: expect.any(Object) }) });

  await click(buttonByText("Create Map"));
  await fillName("Summoner's Rift");
  await click(document.querySelector('[role="dialog"] button[type="submit"]'));

  expect(calls).toContainEqual({
    path: "/api/v1/admin/catalog/lol/map",
    options: { method: "POST", body: { name: "Summoner's Rift", image_path: null, aliases: [], active: true } }
  });
});
