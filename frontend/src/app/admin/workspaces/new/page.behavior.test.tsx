// @vitest-environment happy-dom
//
// The workspace creation wizard on the T6 `WizardShell`. What is pinned here:
//  1. the route is gated on `workspace.self_create`, the same right the list's
//     create link and the backend check;
//  2. step 1 suggests the address from the name, Create POSTs `{slug, name}`
//     and the URL gains the new id and step 2, so a reload keeps the place;
//  3. every step past basics edits an existing workspace, so `?step=` without
//     an `?id=` falls back to basics instead of rendering a form with no target.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "@/types/workspace.types";
import NewWorkspacePage from "./page";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let currentSearch = "";
let rerender: (() => void) | null = null;
let mayCreate = true;

const navigate = vi.fn((url: string) => {
  window.history.replaceState(null, "", url);
  currentSearch = new URL(url, "http://localhost").search;
  rerender?.();
});

const created = {
  id: 8,
  slug: "vesyolyy-kubok",
  name: "Весёлый Кубок",
  description: null,
  tagline: null,
  about: null,
  discord_url: null,
  twitch_url: null,
  boosty_url: null,
  icon_url: null,
  timezone: "Europe/Moscow",
  branding_enabled: false,
  brand_primary: null,
  brand_secondary: null,
  brand_background: null,
  brand_surface: null,
  discord_guild_id: null
} as Workspace;

const create = vi.fn();
const getById = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/workspaces/new",
  useRouter: () => ({ push: navigate, replace: navigate }),
  useSearchParams: () => new URLSearchParams(currentSearch)
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ isLoaded: true, canUseCapability: () => mayCreate })
}));
vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (
    selector: (state: {
      fetchWorkspaces: () => Promise<void>;
      setCurrentWorkspace: (id: number) => void;
    }) => unknown
  ) => selector({ fetchWorkspaces: async () => undefined, setCurrentWorkspace: () => undefined })
}));
vi.mock("@/services/workspace.service", () => ({
  default: {
    create: (...args: unknown[]) => create(...args),
    getById: (...args: unknown[]) => getById(...args),
    update: vi.fn(),
    uploadIcon: vi.fn()
  }
}));
vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() }
}));

let container: HTMLElement;
let root: Root;

function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

async function settle(turns = 3) {
  for (let turn = 0; turn < turns; turn += 1) {
    await act(async () => {
      await tick();
    });
  }
}

function Harness() {
  // `useSearchParams` is mocked from a module-level string, so a URL write has
  // to force the re-render a real router would have caused.
  const [, force] = useState(0);
  useEffect(() => {
    rerender = () => force((value) => value + 1);
  }, []);
  return <NewWorkspacePage />;
}

async function render(search = "") {
  currentSearch = search;
  window.history.replaceState(null, "", `/admin/workspaces/new${search}`);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    );
  });
  await settle();
}

async function type(input: HTMLInputElement, value: string) {
  // React tracks the DOM value on the node; the native setter is what makes
  // `onChange` fire.
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function button(label: string) {
  return [...container.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === label
  );
}

function heading() {
  return container.querySelector("h2")?.textContent?.trim();
}

beforeEach(() => {
  mayCreate = true;
  navigate.mockClear();
  create.mockReset().mockResolvedValue(created);
  getById.mockReset().mockResolvedValue(created);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("NewWorkspacePage", () => {
  it("blocks the route without workspace.self_create", async () => {
    mayCreate = false;
    await render();

    expect(container.textContent).toContain("No access");
    expect(container.querySelector('ol[aria-label="Steps"]')).toBeNull();
  });

  it("suggests the address from the name and creates into step 2", async () => {
    await render();

    await type(container.querySelector<HTMLInputElement>("#workspace-name")!, "Весёлый Кубок");
    expect(container.querySelector<HTMLInputElement>("#workspace-slug")?.value).toBe(
      "vesyolyy-kubok"
    );

    await act(async () => {
      button("Create")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(create).toHaveBeenCalledWith({ slug: "vesyolyy-kubok", name: "Весёлый Кубок" });
    const params = new URLSearchParams(currentSearch);
    expect(params.get("id")).toBe("8");
    expect(params.get("step")).toBe("profile");
    expect(heading()).toBe("Profile");
  });

  it("falls back to basics for a later step without an id", async () => {
    await render("?step=branding");

    expect(heading()).toBe("Basics");
    expect(container.querySelector("#workspace-name")).not.toBeNull();
    expect(getById).not.toHaveBeenCalled();
  });
});
