// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import SubscriptionProvidersCard from "./SubscriptionProviderCard";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const listSubscriptionProviders = vi.fn();
const upsertSubscriptionProvider = vi.fn();

vi.mock("@/services/balancer-admin.service", () => ({
  default: {
    listSubscriptionProviders: (...args: unknown[]) => listSubscriptionProviders(...args),
    upsertSubscriptionProvider: (...args: unknown[]) => upsertSubscriptionProvider(...args)
  }
}));

vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn() }
}));

const BOOSTY_WITH_STORED_CODE = {
  provider: "boosty",
  enabled: true,
  guild_id: "1234567890123456789",
  role_tiers: [{ role_id: "9876543210987654321", tier_rank: 2, tier_label: "Уровень 2" }],
  codes: [{ tier_rank: 3, tier_label: "Уровень 3" }]
};

async function mount(configs: unknown[]) {
  listSubscriptionProviders.mockResolvedValue({ configs });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <QueryClientProvider client={client}>
          <SubscriptionProvidersCard workspaceId={7} />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  // React Query resolves through the real task queue, not just microtasks, so a
  // `Promise.resolve()` flush is not enough — it lands while the card still says
  // "Loading…" and every assertion below races it. Yield real macrotasks instead.
  for (let i = 0; i < 50 && container.textContent?.includes("Loading…"); i += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
  if (container.textContent?.includes("Loading…")) {
    throw new Error("the providers query never resolved");
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

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
  listSubscriptionProviders.mockReset();
  upsertSubscriptionProvider.mockReset();
  upsertSubscriptionProvider.mockResolvedValue(BOOSTY_WITH_STORED_CODE);
});

describe("SubscriptionProvidersCard", () => {
  it("omits `codes` when the admin typed none, so a plain save cannot wipe what they cannot see", async () => {
    const container = await mount([BOOSTY_WITH_STORED_CODE]);

    await click(button(container, "Save"));

    expect(upsertSubscriptionProvider).toHaveBeenCalledTimes(1);
    const [, body] = upsertSubscriptionProvider.mock.calls[0];
    expect("codes" in body).toBe(false);
    expect(body.guild_id).toBe("1234567890123456789");
  });

  it("sends the typed codes when there are any", async () => {
    const container = await mount([BOOSTY_WITH_STORED_CODE]);

    await click(button(container, "Add code"));
    const codeInput = [...container.querySelectorAll("input")].find(
      (el) => (el as HTMLInputElement).placeholder === "code from the post"
    ) as HTMLInputElement;
    await type(codeInput, "fresh-secret");
    await click(button(container, "Save"));

    const [, body] = upsertSubscriptionProvider.mock.calls[0];
    expect(body.codes).toEqual([{ code: "fresh-secret", tier_rank: 1 }]);
  });

  it("blocks saving two tiers on the same role — the verdict would depend on ordering", async () => {
    const container = await mount([
      {
        ...BOOSTY_WITH_STORED_CODE,
        role_tiers: [
          { role_id: "111", tier_rank: 1 },
          { role_id: "111", tier_rank: 2 }
        ]
      }
    ]);

    expect(button(container, "Save").disabled).toBe(true);
    expect(container.textContent).toContain("Two tiers on the same role id");
  });

  it("warns that a guild with no role mapping fails open", async () => {
    const container = await mount([{ ...BOOSTY_WITH_STORED_CODE, role_tiers: [], codes: [] }]);

    expect(container.textContent).toContain("fails open");
  });

  it("does not warn once a role is mapped", async () => {
    const container = await mount([BOOSTY_WITH_STORED_CODE]);
    expect(container.textContent).not.toContain("without a role mapping");
  });

  it("sends broadcaster fields for twitch, not guild fields", async () => {
    const container = await mount([
      {
        provider: "twitch",
        enabled: true,
        broadcaster_id: "12345",
        broadcaster_login: "streamer",
        role_tiers: [],
        codes: []
      }
    ]);

    await click(button(container, "Save"));

    const [, body] = upsertSubscriptionProvider.mock.calls[0];
    expect(body).toMatchObject({
      provider: "twitch",
      broadcaster_id: "12345",
      broadcaster_login: "streamer"
    });
    expect("guild_id" in body).toBe(false);
    expect("role_tiers" in body).toBe(false);
  });

  it("renders one editor per provider the server offers", async () => {
    const container = await mount([
      BOOSTY_WITH_STORED_CODE,
      { provider: "twitch", enabled: false, role_tiers: [], codes: [] }
    ]);

    expect(container.textContent).toContain("Boosty");
    expect(container.textContent).toContain("Twitch");
    expect(
      [...container.querySelectorAll("button")].filter((el) => el.textContent === "Save")
    ).toHaveLength(2);
  });
});

describe("verification method", () => {
  it("defaults to either when the server sends nothing, so no mechanism is silently off", async () => {
    const container = await mount([BOOSTY_WITH_STORED_CODE]);

    await click(button(container, "Save"));

    const [, body] = upsertSubscriptionProvider.mock.calls[0];
    expect(body.verification_method).toBe("any");
  });

  it("labels the live option after the mechanism the provider actually uses", async () => {
    const boosty = await mount([BOOSTY_WITH_STORED_CODE]);
    expect(boosty.textContent).toContain("Discord role");

    document.body.innerHTML = "";
    const twitch = await mount([
      { provider: "twitch", enabled: true, role_tiers: [], codes: [], verification_method: "any" }
    ]);
    expect(twitch.textContent).toContain("Twitch subscription");
    expect(twitch.textContent).not.toContain("Discord role");
  });

  it("hides the code input under live-only, and the role mapping under code-only", async () => {
    const live = await mount([{ ...BOOSTY_WITH_STORED_CODE, verification_method: "live" }]);
    expect(live.textContent).toContain("Discord guild id");
    expect(live.textContent).not.toContain("Challenge codes");

    document.body.innerHTML = "";
    const code = await mount([{ ...BOOSTY_WITH_STORED_CODE, verification_method: "code" }]);
    expect(code.textContent).toContain("Challenge codes");
    expect(code.textContent).not.toContain("Discord guild id");
  });

  it("offers challenge codes for twitch too — code-only with no input would fail open", async () => {
    const container = await mount([
      { provider: "twitch", enabled: true, role_tiers: [], codes: [], verification_method: "code" }
    ]);
    expect(container.textContent).toContain("Challenge codes");
    expect(container.textContent).not.toContain("Broadcaster id");
  });

  it("omits the fields of a rejected mechanism instead of blanking them", async () => {
    const container = await mount([{ ...BOOSTY_WITH_STORED_CODE, verification_method: "code" }]);

    await click(button(container, "Save"));

    const [, body] = upsertSubscriptionProvider.mock.calls[0];
    expect(body.verification_method).toBe("code");
    // Leaving them out preserves the stored guild and roles for a switch back;
    // sending empties would destroy them on a radio click.
    expect("guild_id" in body).toBe(false);
    expect("role_tiers" in body).toBe(false);
  });

  it("sends the method the admin picked", async () => {
    const container = await mount([{ ...BOOSTY_WITH_STORED_CODE, verification_method: "any" }]);

    const liveRadio = [...container.querySelectorAll("input")].find(
      (el) => (el as HTMLInputElement).value === "live"
    ) as HTMLInputElement;
    await click(liveRadio);
    await click(button(container, "Save"));

    const [, body] = upsertSubscriptionProvider.mock.calls[0];
    expect(body.verification_method).toBe("live");
  });

  it("warns that code-only with no code configured fails open", async () => {
    const container = await mount([
      { ...BOOSTY_WITH_STORED_CODE, codes: [], verification_method: "code" }
    ]);
    expect(container.textContent).toContain("unsatisfiable");
  });

  it("does not warn once a code is stored", async () => {
    const container = await mount([{ ...BOOSTY_WITH_STORED_CODE, verification_method: "code" }]);
    expect(container.textContent).not.toContain("unsatisfiable");
  });

  it("drops the role-mapping warning under code-only, where roles are irrelevant", async () => {
    const container = await mount([
      { ...BOOSTY_WITH_STORED_CODE, role_tiers: [], verification_method: "code" }
    ]);
    expect(container.textContent).not.toContain("without a role mapping");
  });
});
