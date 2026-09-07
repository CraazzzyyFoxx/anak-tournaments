// @vitest-environment happy-dom
//
// Carried over from app/admin/subscriptions/_components with the import path as
// the only change. The requirement is workspace-wide, so the two things this
// card must get right are both about blast radius: which providers it will even
// offer, and telling the admin that ANY change to the rule -- emptying it or
// merely tightening it -- re-decides admission for every tournament at once.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type {
  SubscriptionProviderConfigRead,
  SubscriptionRequirement
} from "@/types/registration.types";

import { WorkspaceRequirementCard } from "./workspace-requirement";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const listSubscriptionProviders = vi.fn();
const getSubscriptionRequirement = vi.fn();
const upsertSubscriptionRequirement = vi.fn();

vi.mock("@/services/balancer-admin.service", () => ({
  default: {
    listSubscriptionProviders: (...args: unknown[]) => listSubscriptionProviders(...args),
    getSubscriptionRequirement: (...args: unknown[]) => getSubscriptionRequirement(...args),
    upsertSubscriptionRequirement: (...args: unknown[]) => upsertSubscriptionRequirement(...args)
  }
}));

vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn() }
}));

const BOOSTY_RULE: SubscriptionRequirement = {
  mode: "all",
  requirements: [{ provider: "boosty", min_tier_rank: 2 }]
};

function config(provider: string, enabled: boolean): SubscriptionProviderConfigRead {
  return {
    provider,
    enabled,
    role_tiers: [],
    codes: [],
    verification_method: "any"
  };
}

async function mount(
  requirement: SubscriptionRequirement,
  configs: SubscriptionProviderConfigRead[]
) {
  getSubscriptionRequirement.mockResolvedValue({ requirement, enforcing_tournaments: 3 });
  listSubscriptionProviders.mockResolvedValue({ configs, discord_guild_id: null });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <QueryClientProvider client={client}>
          <WorkspaceRequirementCard workspaceId={7} />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  // React Query resolves through real macrotasks, not microtasks: a bare
  // `Promise.resolve()` flush lands while the card still says "Loading…".
  for (let i = 0; i < 50 && container.textContent?.includes("Loading…"); i += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
  if (container.textContent?.includes("Loading…")) {
    throw new Error("the requirement query never resolved");
  }
  return container;
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((el) =>
    (el.textContent ?? "").includes(text)
  );
  if (!found) throw new Error(`no button matching ${text}`);
  return found as HTMLButtonElement;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

// Both messages are keyed on `enforcing_tournaments`, so the copy quotes a real count.
const DISARM_WARNING = "Clearing the rule stops enforcement for all 3 tournaments";
const CHANGE_WARNING = "Changing the rule changes who is admitted across all 3 tournaments";

beforeEach(() => {
  document.body.innerHTML = "";
  listSubscriptionProviders.mockReset();
  getSubscriptionRequirement.mockReset();
  upsertSubscriptionRequirement.mockReset();
  upsertSubscriptionRequirement.mockResolvedValue({
    requirement: { mode: "all", requirements: [] },
    enforcing_tournaments: 3
  });
});

describe("WorkspaceRequirementCard", () => {
  it("offers only providers the workspace actually enabled", async () => {
    const container = await mount({ mode: "all", requirements: [] }, [
      config("boosty", false),
      config("twitch", false)
    ]);

    // Nothing enabled means nothing the resolver can answer for, so there is no
    // provider to add — the admin enables one in the card above first.
    expect(container.textContent).not.toContain("Add provider");

    const withBoosty = await mount({ mode: "all", requirements: [] }, [
      config("boosty", true),
      config("twitch", false)
    ]);
    expect(withBoosty.textContent).toContain("Add provider");

    // A workspace that never had a rule is not changing one, so the warning must
    // not nag an admin who has touched nothing.
    expect(withBoosty.textContent).not.toContain(DISARM_WARNING);
    expect(withBoosty.textContent).not.toContain(CHANGE_WARNING);
  });

  it("warns about disarming once the stored rule is emptied, quoting the blast radius", async () => {
    const container = await mount(BOOSTY_RULE, [config("boosty", true)]);
    expect(container.textContent).not.toContain(DISARM_WARNING);

    await click(container.querySelector<HTMLElement>('[aria-label="Remove Boosty"]')!);
    expect(container.textContent).toContain(DISARM_WARNING);
  });

  it("warns about a rule that is merely tightened, not only one that is emptied", async () => {
    // The regression this pins: adding a second required provider under `all` mode
    // retroactively refuses patrons the gate already admitted, across every
    // enforcing tournament at once. Warning only on empty-out missed that entirely.
    const container = await mount(BOOSTY_RULE, [config("boosty", true), config("twitch", true)]);
    expect(container.textContent).not.toContain(CHANGE_WARNING);

    await click(button(container, "Add provider"));

    expect(container.textContent).toContain(CHANGE_WARNING);
    // Still armed, so this is not the disarming message.
    expect(container.textContent).not.toContain(DISARM_WARNING);
  });

  it("drops the warning again when an edit is reverted to the stored rule", async () => {
    // `sameRule` compares the rule, not the object: an admin who adds a provider and
    // removes it again has changed nothing and must not be warned about nothing.
    const container = await mount(BOOSTY_RULE, [config("boosty", true), config("twitch", true)]);

    await click(button(container, "Add provider"));
    expect(container.textContent).toContain(CHANGE_WARNING);

    await click(container.querySelector<HTMLElement>('[aria-label="Remove Twitch"]')!);
    expect(container.textContent).not.toContain(CHANGE_WARNING);
    expect(container.textContent).not.toContain(DISARM_WARNING);
  });

  it("saves the rule wholesale and keeps Save inert until something changed", async () => {
    const container = await mount(BOOSTY_RULE, [config("boosty", true)]);
    expect(button(container, "Save").disabled).toBe(true);

    await click(container.querySelector<HTMLElement>('[aria-label="Remove Boosty"]')!);
    await click(button(container, "Save"));

    expect(upsertSubscriptionRequirement).toHaveBeenCalledWith(7, {
      requirement: { mode: "all", requirements: [] }
    });
  });
});
