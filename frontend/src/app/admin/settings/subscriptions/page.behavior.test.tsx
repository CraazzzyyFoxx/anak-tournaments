// @vitest-environment happy-dom
//
// The section's own job is small: gate on `team.update`, and mount BOTH halves
// of the workspace configuration. The requirement editor without the provider
// card is the bug this pins — the editor's provider options come from the card,
// so a section that showed only one of them offers a rule nobody can populate.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import WorkspaceSubscriptionsSettingsPage from "./page";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const listSubscriptionProviders = vi.fn();
const getSubscriptionRequirement = vi.fn();
const upsertSubscriptionProvider = vi.fn();
const upsertSubscriptionRequirement = vi.fn();

vi.mock("@/services/balancer-admin.service", () => ({
  default: {
    listSubscriptionProviders: (...args: unknown[]) => listSubscriptionProviders(...args),
    getSubscriptionRequirement: (...args: unknown[]) => getSubscriptionRequirement(...args),
    upsertSubscriptionProvider: (...args: unknown[]) => upsertSubscriptionProvider(...args),
    upsertSubscriptionRequirement: (...args: unknown[]) => upsertSubscriptionRequirement(...args)
  }
}));
vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() }
}));
// The SaveBar's leave guard routes through the router.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}));

// Whether the workspace has a Discord server bound is the provider card's own
// question, not part of this section's contract.
vi.mock("@/components/discord/DiscordServerStatus", () => ({
  DiscordServerStatus: () => null
}));

let canManage = true;
let workspaceId: number | null = 7;
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ canAccessPermission: () => canManage })
}));
vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (selector: (state: { currentWorkspaceId: number | null }) => unknown) =>
    selector({ currentWorkspaceId: workspaceId })
}));

function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <QueryClientProvider client={client}>
          <WorkspaceSubscriptionsSettingsPage />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  for (let turn = 0; turn < 10; turn += 1) {
    await act(async () => {
      await tick();
    });
  }
  return container;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      await tick();
    });
  }
}

function saveButton() {
  return [...document.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === "Save changes"
  );
}

function addProvider(container: HTMLElement) {
  return [...container.querySelectorAll("button")].find((node) =>
    node.textContent?.includes("Add provider")
  )!;
}

beforeEach(() => {
  document.body.innerHTML = "";
  canManage = true;
  workspaceId = 7;
  listSubscriptionProviders.mockReset().mockResolvedValue({
    configs: [
      {
        provider: "boosty",
        enabled: true,
        role_tiers: [],
        codes: [],
        verification_method: "any"
      }
    ],
    discord_guild_id: null
  });
  getSubscriptionRequirement
    .mockReset()
    .mockResolvedValue({ requirement: { mode: "all", requirements: [] }, enforcing_tournaments: 0 });
  upsertSubscriptionProvider.mockReset().mockResolvedValue({});
  upsertSubscriptionRequirement.mockReset().mockResolvedValue({});
});

describe("WorkspaceSubscriptionsSettingsPage", () => {
  it("mounts providers and the workspace rule together, scoped to the active workspace", async () => {
    const container = await mount();

    expect(listSubscriptionProviders).toHaveBeenCalledWith(7);
    expect(getSubscriptionRequirement).toHaveBeenCalledWith(7);
    // Enabling a provider above is what makes it selectable in the rule below.
    expect(container.textContent).toContain("Add provider");
    // No header of its own: app/admin/settings/layout.tsx owns the chrome.
    expect([...container.querySelectorAll("h1")]).toHaveLength(0);
  });

  it("refuses the section without team.update instead of rendering a read-only editor", async () => {
    canManage = false;
    const container = await mount();

    expect(container.textContent).toContain("You cannot configure subscriptions");
    expect(listSubscriptionProviders).not.toHaveBeenCalled();
    expect(getSubscriptionRequirement).not.toHaveBeenCalled();
  });

  it("asks for a workspace before querying anything", async () => {
    workspaceId = null;
    const container = await mount();

    expect(container.textContent).toContain("Pick a workspace in the sidebar");
    expect(listSubscriptionProviders).not.toHaveBeenCalled();
  });

  it("stores provider edits and the rule together behind one SaveBar", async () => {
    const container = await mount();
    // Nothing edited: no Save anywhere on the section.
    expect(saveButton()).toBeUndefined();

    await click(container.querySelector('button[role="checkbox"]')!);
    await click(addProvider(container));
    expect(container.querySelector('[role="region"]')?.textContent).toContain(
      "Boosty · Subscription requirement"
    );

    await click(saveButton()!);

    expect(upsertSubscriptionProvider).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ provider: "boosty", enabled: false })
    );
    expect(upsertSubscriptionRequirement).toHaveBeenCalledWith(7, {
      requirement: { mode: "all", requirements: [{ provider: "boosty", min_tier_rank: 1 }] }
    });
    // Saved: every editor restarts from what is stored, so the bar is gone.
    expect(saveButton()).toBeUndefined();
  });
});
