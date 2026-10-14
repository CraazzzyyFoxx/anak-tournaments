// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import MapsAdminPage from "./page";

const calls: { path: string; options?: { method?: string; query?: Record<string, unknown>; body?: unknown } }[] = [];
const MODE = {
  id: 907, created_at: "2026-10-14T00:00:00Z", updated_at: null,
  discipline: "overwatch", kind: "mode", slug: "push", name: "Push", image_path: null,
  parent_id: null, attrs: {}, aliases: [], active: true, parent: null
};
const LEGACY_MODE = { id: 7, name: "Legacy push" };

vi.mock("@/lib/api/fetch", () => ({
  apiFetch: (path: string, options?: (typeof calls)[number]["options"]) => {
    calls.push({ path, options });
    const results = path === "/api/v1/admin/catalog/overwatch/mode" ? [MODE]
      : path === "/api/v1/gamemodes" ? [LEGACY_MODE] : [];
    const reply = options?.method === "POST"
      ? { ...MODE, id: 908, kind: "map", name: "Ilios", parent_id: 907, attrs: { in_competitive: true }, parent: { id: 907, slug: "push", name: "Push" } }
      : { results, total: results.length, page: 1, per_page: -1 };
    return Promise.resolve({ json: async () => reply });
  }
}));
vi.mock("next-intl", async () => {
  const { default: messages } = await import("@/i18n/messages/en.json");
  return {
    useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
      let value: unknown = messages;
      for (const part of `${namespace}.${key}`.split(".")) {
        if (value == null) return key;
        value = (value as Record<string, unknown>)[part];
      }
      return typeof value === "string"
        ? value.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? `{${name}}`)) : key;
    }
  };
});
vi.mock("@/lib/datetime/client", () => ({
  useFormatter: () => ({ dateTime: (value: Date) => value.toISOString() })
}));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ isSuperuser: true, isLoaded: true }) }));
vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() } }));

let rerender: (() => void) | null = null;
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/content/maps",
  useRouter: () => ({ replace: (url: string) => {
    window.history.replaceState(null, "", url);
    rerender?.();
  } }),
  useSearchParams: () => new URLSearchParams(window.location.search)
}));

let root: Root;
let client: QueryClient;

function Harness() {
  const [, force] = useState(0);
  useEffect(() => { rerender = () => force((value) => value + 1); }, []);
  return <MapsAdminPage />;
}

async function settle() {
  for (let turn = 0; turn < 8; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

async function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => {
    element!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  calls.length = 0;
  window.history.replaceState(null, "", "/admin/content/maps");
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => false
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } } });
  // The public catalogue still contains legacy ids until Task 5. It must not feed the admin options.
  client.setQueryData(["gamemodes"], [LEGACY_MODE]);
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
  });
  await settle();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  client.clear();
  rerender = null;
  document.body.innerHTML = "";
});

it("uses catalog mode ids for the create dialog instead of the cached public legacy ids", async () => {
  expect(calls).toContainEqual({ path: "/api/v1/admin/catalog/overwatch/mode", options: { query: { per_page: -1 } } });
  await click(Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Create map"));
  await click(document.querySelector('[role="dialog"] [role="combobox"]'));
  const option = Array.from(document.querySelectorAll('[role="option"]')).find((element) => element.textContent?.trim() === "Push");
  await click(option);
  const input = document.querySelector('[role="dialog"] input[placeholder="Map name"]') as HTMLInputElement;
  expect(input).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Ilios");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(document.querySelector('[role="dialog"] button[type="submit"]'));
  expect(calls).toContainEqual({
    path: "/api/v1/admin/catalog/overwatch/map",
    options: { method: "POST", body: { name: "Ilios", parent_id: 907, aliases: [], attrs: { in_competitive: true } } }
  });
});

it("uses the catalog mode id in the mode filter and generic map request", async () => {
  await click(document.querySelector('[aria-label="Add filter"]'));
  await click(Array.from(document.querySelectorAll('[cmdk-item=""]')).find((element) => element.textContent?.trim().startsWith("Gamemode")));
  await click(Array.from(document.querySelectorAll('[cmdk-item=""]')).find((element) => element.textContent?.trim().startsWith("Push")));
  expect(window.location.search).toContain("gamemode_id=907");
  const mapCall = calls.filter((call) => call.path === "/api/v1/admin/catalog/overwatch/map").at(-1);
  expect(mapCall?.options?.query?.parent_id).toBe(907);
});
