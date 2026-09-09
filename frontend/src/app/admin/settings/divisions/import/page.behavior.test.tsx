// @vitest-environment happy-dom
//
// Import from workspace (T6, F12b). What is pinned:
//
//  1. the `division_grid.create` gate — importing writes a version, so read
//     access is not enough, and nothing is asked of the marketplace until it
//     is allowed;
//  2. every choice is in the query string, so the step the user is on survives
//     a reload — which matters most on the polling step, where the work is
//     already running server-side and starting over would import twice;
//  3. the preflight preview is shown before anything is written, conflicts
//     included, and it says where they get resolved (the draft's Mappings
//     view, not here);
//  4. the flow ends by opening the created draft with `?tab=mappings`, which
//     is the reason the old wizard's fourth "Conflicts" step is gone.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DivisionGridImportPage from "./page";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getDivisionGridMarketplaceWorkspaces = vi.fn();
const getDivisionGridMarketplace = vi.fn();
const preflightDivisionGridMarketplace = vi.fn();
const importDivisionGridMarketplace = vi.fn();
const getDivisionGridImportJob = vi.fn();
const getDivisionGridVersions = vi.fn();

let permitted = true;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  NextIntlClientProvider: ({ children }: { children: ReactNode }) => children
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    canAccessPermission: () => permitted,
    hasPermission: () => permitted,
    isSuperuser: false,
    isLoaded: true
  })
}));

vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (selector: (state: { currentWorkspaceId: number }) => unknown) =>
    selector({ currentWorkspaceId: 1 })
}));

vi.mock("@/services/workspace.service", () => ({
  default: {
    getDivisionGridMarketplaceWorkspaces: (...args: unknown[]) =>
      getDivisionGridMarketplaceWorkspaces(...args),
    getDivisionGridMarketplace: (...args: unknown[]) => getDivisionGridMarketplace(...args),
    preflightDivisionGridMarketplace: (...args: unknown[]) =>
      preflightDivisionGridMarketplace(...args),
    importDivisionGridMarketplace: (...args: unknown[]) =>
      importDivisionGridMarketplace(...args),
    getDivisionGridImportJob: (...args: unknown[]) => getDivisionGridImportJob(...args),
    getDivisionGridVersions: (...args: unknown[]) => getDivisionGridVersions(...args)
  }
}));

vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() }
}));

const replace = vi.fn((url: string) => {
  window.history.replaceState(null, "", url);
  rerender?.();
});
let rerender: (() => void) | null = null;

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/settings/divisions/import",
  useRouter: () => ({ replace, push: replace }),
  useSearchParams: () => new URLSearchParams(window.location.search)
}));

const mounted: { root: Root; container: HTMLElement }[] = [];

async function settle(turns = 8, delayMs = 0) {
  for (let turn = 0; turn < turns; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, delayMs);
      await promise;
    });
  }
}

function Harness({ render }: Readonly<{ render: () => ReactNode }>) {
  const [, force] = useState(0);
  // Published from an effect, not during render: writing a module-scope binding
  // while rendering is a side effect the react-compiler rules reject.
  useEffect(() => {
    rerender = () => force((value) => value + 1);
  }, []);
  return <>{render()}</>;
}

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Harness render={() => <DivisionGridImportPage />} />
      </QueryClientProvider>
    );
  });
  await settle();
  return container;
}

async function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => {
    (element as HTMLElement).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle(3);
}

/** Scoped to one mount: a test that mounts twice would otherwise keep finding the first. */
function button(scope: HTMLElement, text: string) {
  return Array.from(scope.querySelectorAll("button")).find(
    (element) => element.textContent?.trim() === text
  );
}

beforeEach(() => {
  permitted = true;
  replace.mockClear();
  getDivisionGridMarketplaceWorkspaces.mockReset().mockResolvedValue([
    { id: 2, slug: "owcs", name: "OWCS", grids_count: 1, versions_count: 3 }
  ]);
  getDivisionGridMarketplace.mockReset().mockResolvedValue([
    {
      id: 5,
      slug: "owcs-grid",
      name: "OWCS grid",
      description: null,
      versions_count: 2,
      tiers_count: 18,
      preview_icon_urls: [],
      versions: [
        {
          id: 51,
          version: 2,
          label: "Season 12",
          status: "published",
          tiers_count: 18,
          preview_icon_urls: []
        }
      ]
    }
  ]);
  preflightDivisionGridMarketplace.mockReset().mockResolvedValue({
    source_workspace_id: 2,
    grids_count: 1,
    versions_count: 1,
    tiers_count: 18,
    mappings_count: 1,
    assets_to_copy: 18,
    assets_to_reuse: 0,
    external_assets: 0,
    conflicts: ["division-7"],
    warnings: [],
    source_fingerprint: "abc"
  });
  importDivisionGridMarketplace.mockReset().mockResolvedValue({
    id: 900,
    workspace_id: 1,
    requested_by_user_id: 3,
    source_workspace_id: 2,
    status: "pending",
    progress: 0,
    result: null,
    error: null,
    created_at: "2026-09-01T00:00:00Z",
    started_at: null,
    finished_at: null
  });
  getDivisionGridImportJob.mockReset().mockResolvedValue({
    id: 900,
    workspace_id: 1,
    requested_by_user_id: 3,
    source_workspace_id: 2,
    status: "completed",
    progress: 100,
    result: {
      created_grids: 1,
      created_versions: 1,
      created_tiers: 18,
      copied_images: 18,
      copied_mappings: 1,
      imported_grids: [
        {
          source_grid_id: 5,
          target_grid_id: 77,
          slug: "owcs-grid",
          name: "OWCS grid",
          versions_count: 1,
          tiers_count: 18
        }
      ],
      warnings: []
    },
    error: null,
    created_at: "2026-09-01T00:00:00Z",
    started_at: "2026-09-01T00:00:01Z",
    finished_at: "2026-09-01T00:00:09Z"
  });
  getDivisionGridVersions.mockReset().mockResolvedValue([
    {
      id: 780,
      grid_id: 77,
      version: 1,
      label: "Imported from OWCS",
      status: "draft",
      created_from_version_id: null,
      published_at: null,
      tiers: []
    }
  ]);
  window.history.replaceState(null, "", "/admin/settings/divisions/import");
});

afterEach(async () => {
  for (const entry of mounted.splice(0)) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
  }
  document.body.innerHTML = "";
  rerender = null;
});

describe("Divisions › import from workspace", () => {
  it("refuses the wizard without division_grid.create and asks the marketplace nothing", async () => {
    permitted = false;
    const container = await mount();

    expect(container.textContent).toContain("Importing is not available to you");
    expect(getDivisionGridMarketplaceWorkspaces).not.toHaveBeenCalled();
  });

  it("starts on Source and cannot continue until one is chosen", async () => {
    const container = await mount();

    expect(container.textContent).toContain("Source workspace");
    expect(button(container, "Continue")!.disabled).toBe(true);

    window.history.replaceState(null, "", "/admin/settings/divisions/import?source=2");
    const chosen = await mount();
    expect(button(chosen, "Continue")!.disabled).toBe(false);
  });

  it("previews the import from the query string, conflicts and their home included", async () => {
    window.history.replaceState(
      null,
      "",
      "/admin/settings/divisions/import?step=version&source=2&grid=5&version=51"
    );
    const container = await mount();

    expect(preflightDivisionGridMarketplace).toHaveBeenCalledWith(1, {
      source_workspace_id: 2,
      source_grid_id: 5,
      source_version_id: 51,
      include_icons: true,
      include_ow_rank_mappings: true
    });
    expect(container.textContent).toContain("18 divisions");
    expect(container.textContent).toContain("1 to resolve after import");
    expect(container.textContent).toContain("Mappings view, not here");
  });

  it("starts the job, records it in the URL, and opens the created draft on Mappings", async () => {
    window.history.replaceState(
      null,
      "",
      "/admin/settings/divisions/import?step=version&source=2&grid=5&version=51"
    );
    const container = await mount();

    await click(button(container, "Create draft"));

    expect(importDivisionGridMarketplace).toHaveBeenCalledTimes(1);
    // Step and job id both go into the URL, so a reload resumes the poll
    // instead of starting a second import.
    expect(window.location.search).toContain("step=create");
    expect(window.location.search).toContain("job=900");

    // The same mount followed the URL, so the create step is already on screen.
    expect(container.textContent).toContain("Draft created");

    await click(button(container, "Open the draft"));
    expect(replace).toHaveBeenCalledWith("/admin/settings/divisions/v/780?tab=mappings");
  });
});
