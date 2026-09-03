// @vitest-environment happy-dom
//
// The superuser shell. Each section is implemented once and mounted twice, and
// the only difference is where the workspace id comes from: this route reads it
// from the path (workspace 8), `/admin/settings/*` reads the current workspace
// out of the store. If the two ever diverge, a superuser opening someone
// else's workspace would silently edit their own.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "@/types/workspace.types";
import GeneralSettingsPage from "./page";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getById = vi.fn();

vi.mock("@/services/workspace.service", () => ({
  default: {
    getById: (...args: unknown[]) => getById(...args),
    update: vi.fn(),
    uploadIcon: vi.fn(),
    deleteIcon: vi.fn()
  }
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "8" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}));

let superuser = true;
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isLoaded: true,
    isSuperuser: superuser,
    // A superuser is the only caller of this route who is not a member of the
    // workspace it names, so the membership grant must not be what lets them in.
    isWorkspaceAdmin: () => false,
    canAccessPermission: () => true
  })
}));

vi.mock("@/components/admin/AuditTrailSheet", () => ({ AuditTrailButton: () => null }));

vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), apiError: vi.fn() }
}));

vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (
    selector: (state: { currentWorkspaceId: number; fetchWorkspaces: () => void }) => unknown
  ) => selector({ currentWorkspaceId: 1, fetchWorkspaces: vi.fn() })
}));

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

const OTHER_WORKSPACE: Workspace = {
  id: 8,
  slug: "rivals",
  name: "Rivals Cup",
  description: "Someone else's league",
  icon_url: null,
  is_active: true,
  is_hidden: false,
  timezone: "UTC",
  branding_enabled: false,
  brand_primary: null,
  brand_secondary: null,
  brand_background: null,
  brand_surface: null,
  brand_accent: null,
  brand_foreground: null,
  brand_muted: null,
  brand_border: null,
  brand_ring: null,
  brand_destructive: null,
  subdomain: null,
  seo_title: null,
  seo_description: null,
  custom_domain: null,
  custom_domain_verified_at: null,
  custom_domain_verification_token: null,
  discord_guild_id: null,
  default_division_grid_version_id: null,
  default_division_grid_version: null,
  newcomer_scope: "workspace"
};

let container: HTMLDivElement;
let root: Root;

async function settle(times = 4) {
  for (let turn = 0; turn < times; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
      >
        <GeneralSettingsPage />
      </QueryClientProvider>
    );
  });
  await settle();
}

beforeEach(() => {
  superuser = true;
  getById.mockReset().mockResolvedValue(OTHER_WORKSPACE);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("Workspaces › [id] › General", () => {
  it("edits the workspace named in the route, not the one in the picker", async () => {
    await render();

    expect(getById).toHaveBeenCalledWith(8);
    expect(container.querySelector<HTMLInputElement>("#workspace-name")?.value).toBe(
      "Rivals Cup"
    );
  });

  it("refuses a caller who neither owns the platform nor administers workspace 8", async () => {
    superuser = false;
    await render();

    expect(container.textContent).toContain("Not your workspace");
    expect(container.querySelector("#workspace-name")).toBeNull();
  });
});
