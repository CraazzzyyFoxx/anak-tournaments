// @vitest-environment happy-dom
//
// The custom-domain stepper. What is pinned here:
//  1. adding a domain surfaces the DNS records to copy — the domain is not
//     live until a resolver can see them, so the records ARE the next step;
//  2. a pending domain re-checks DNS on its own, without anyone pressing
//     "Verify now", and flips to "Verified · live" when the check passes;
//  3. removing a live domain goes through a confirmation: it takes the
//     workspace off its own address, which no misclick should be able to do.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "@/types/workspace.types";
import { DomainSection } from "./DomainSection";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getById = vi.fn();
const update = vi.fn();
const setCustomDomain = vi.fn();
const verifyCustomDomain = vi.fn();
const clearCustomDomain = vi.fn();

vi.mock("@/services/workspace.service", () => ({
  default: {
    getById: (...args: unknown[]) => getById(...args),
    update: (...args: unknown[]) => update(...args),
    setCustomDomain: (...args: unknown[]) => setCustomDomain(...args),
    verifyCustomDomain: (...args: unknown[]) => verifyCustomDomain(...args),
    clearCustomDomain: (...args: unknown[]) => clearCustomDomain(...args)
  }
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isLoaded: true,
    isSuperuser: true,
    isWorkspaceAdmin: () => true,
    canAccessPermission: () => true
  })
}));

vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), apiError: vi.fn() }
}));

const fetchWorkspaces = vi.fn();
vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (selector: (state: { fetchWorkspaces: () => void }) => unknown) =>
    selector({ fetchWorkspaces })
}));

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

const WORKSPACE: Workspace = {
  id: 7,
  slug: "owt",
  name: "Overwatch Tournaments",
  description: null,
  icon_url: null,
  is_active: true,
  is_hidden: false,
  timezone: "Europe/Moscow",
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
  subdomain: "owt",
  seo_title: null,
  seo_description: null,
  custom_domain: null,
  custom_domain_verified_at: null,
  custom_domain_verification_token: null,
  discord_guild_id: null,
  default_division_grid_version_id: null,
  default_division_grid_version: null,
  newcomer_scope: "global"
};

const PENDING: Workspace = {
  ...WORKSPACE,
  custom_domain: "tourney.example.com",
  custom_domain_verification_token: "owt-verify-token-abc"
};

const VERIFIED: Workspace = {
  ...PENDING,
  custom_domain_verified_at: "2026-03-01T10:00:00Z"
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
        <DomainSection workspaceId={7} />
      </QueryClientProvider>
    );
  });
  await settle();
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(2);
}

async function click(node: Element | undefined) {
  await act(async () => {
    node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

function buttonIn(scope: ParentNode, label: string) {
  return [...scope.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === label
  );
}

const domainInput = () =>
  container.querySelector<HTMLInputElement>("#workspace-custom-domain")!;

beforeEach(() => {
  fetchWorkspaces.mockReset();
  getById.mockReset().mockResolvedValue(WORKSPACE);
  update.mockReset().mockResolvedValue(WORKSPACE);
  setCustomDomain.mockReset().mockResolvedValue(PENDING);
  verifyCustomDomain.mockReset().mockResolvedValue(PENDING);
  clearCustomDomain.mockReset().mockResolvedValue(WORKSPACE);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("Workspace settings › Domain", () => {
  it("shows the DNS records to add once a domain is saved", async () => {
    await render();

    expect(container.textContent).not.toContain("_owt-verify.");

    await type(domainInput(), "tourney.example.com");
    await click(buttonIn(container, "Save domain"));

    expect(setCustomDomain).toHaveBeenCalledWith(7, "tourney.example.com");
    expect(container.textContent).toContain("_owt-verify.tourney.example.com");
    expect(container.textContent).toContain("owt-verify-token-abc");
    expect(buttonIn(container, "Verify now")).toBeTruthy();
    // Step 2 of three is where the user now is: the records exist, DNS does not.
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain(
      "Add DNS records"
    );
  });

  it("re-checks DNS on its own while a domain is pending, and goes live when it passes", async () => {
    getById.mockResolvedValue(PENDING);
    verifyCustomDomain.mockResolvedValue(VERIFIED);
    await render();

    // Nobody pressed "Verify now": the pending state polls by itself.
    expect(verifyCustomDomain).toHaveBeenCalledWith(7);
    expect(container.textContent).toContain("Verified · live");
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain("Verified");
    expect(domainInput().disabled).toBe(true);
  });

  it("will not remove a live domain without a confirmation", async () => {
    getById.mockResolvedValue(VERIFIED);
    verifyCustomDomain.mockResolvedValue(VERIFIED);
    await render();

    await click(buttonIn(container, "Remove domain"));

    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Remove custom domain");
    expect(dialog?.textContent).toContain("Overwatch Tournaments");
    expect(clearCustomDomain).not.toHaveBeenCalled();

    await click(buttonIn(dialog!, "Remove domain"));
    expect(clearCustomDomain).toHaveBeenCalledWith(7);
  });
});
