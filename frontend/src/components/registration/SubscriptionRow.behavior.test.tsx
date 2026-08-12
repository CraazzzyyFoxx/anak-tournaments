// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import SubscriptionRow from "./SubscriptionRow";
import type { SubscriptionStatus } from "@/types/registration.types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MESSAGES = {
  common: {
    subscription: {
      satisfied: "Subscription confirmed",
      refused: "No subscription",
      undetermined: "Subscription not checked",
      none: "not subscribed",
      unchecked: "not checked",
      active: "subscribed",
      codeLabel: "Code from the subscriber-only post",
      codePlaceholder: "Paste the code",
      codeSubmit: "Redeem",
      codeAccepted: "Code accepted",
      linkDiscordCta: "Link Discord to confirm your Boosty subscription",
      reconnectTwitchCta: "Reconnect Twitch to confirm your subscription"
    }
  }
};

function status(verdict: Record<string, unknown>): SubscriptionStatus {
  return {
    required: true,
    mode: "any",
    outcome: "refused",
    rule: "Boosty",
    verdicts: { boosty: verdict }
  } as unknown as SubscriptionStatus;
}

async function mount(props: {
  subscription?: SubscriptionStatus | null;
  onRedeemCode?: (code: string) => Promise<void>;
  onLinkAccounts?: () => void;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <SubscriptionRow provider="boosty" providerLabel="Boosty" {...props} />
      </NextIntlClientProvider>
    );
  });
  return container;
}

const redeem = vi.fn();

beforeEach(() => {
  document.body.innerHTML = "";
  redeem.mockReset();
  redeem.mockResolvedValue(undefined);
});

describe("SubscriptionRow code input", () => {
  it("is offered when the server says a code is accepted", async () => {
    const container = await mount({
      subscription: status({ state: "inactive", reason: "no_code_redeemed", code_accepted: true }),
      onRedeemCode: redeem
    });
    expect(container.textContent).toContain("Code from the subscriber-only post");
  });

  it("is hidden when the tournament does not verify by code — the paste would 400", async () => {
    const container = await mount({
      subscription: status({ state: "inactive", reason: "no_mapped_role", code_accepted: false }),
      onRedeemCode: redeem
    });
    expect(container.textContent).not.toContain("Code from the subscriber-only post");
  });

  it("is hidden when the flag is absent, so an old server cannot produce a trap", async () => {
    const container = await mount({
      subscription: status({ state: "inactive", reason: "no_mapped_role" }),
      onRedeemCode: redeem
    });
    expect(container.textContent).not.toContain("Code from the subscriber-only post");
  });

  it("is hidden once the provider is already satisfied", async () => {
    const container = await mount({
      subscription: status({ state: "active", tier_rank: 2, code_accepted: true }),
      onRedeemCode: redeem
    });
    expect(container.textContent).not.toContain("Code from the subscriber-only post");
  });

  it("is independent of the reason — a code can fix an unlinked account too", async () => {
    const container = await mount({
      subscription: status({
        state: "unknown",
        reason: "no_linked_discord_account",
        code_accepted: true
      }),
      onRedeemCode: redeem
    });
    // Both routes are offered, because under the permissive method both work.
    expect(container.textContent).toContain("Code from the subscriber-only post");
  });
});

describe("SubscriptionRow call to action", () => {
  it("offers linking Discord when that is the blocker", async () => {
    const container = await mount({
      subscription: status({ state: "unknown", reason: "no_linked_discord_account" }),
      onLinkAccounts: vi.fn()
    });
    expect(container.textContent).toContain("Link Discord");
  });

  it("offers reconnecting Twitch on a missing scope", async () => {
    const container = await mount({
      subscription: status({ state: "unknown", reason: "missing_scope" }),
      onLinkAccounts: vi.fn()
    });
    expect(container.textContent).toContain("Reconnect Twitch");
  });

  it("offers no linking under code-only, where linking fixes nothing", async () => {
    const container = await mount({
      subscription: status({ state: "inactive", reason: "no_code_redeemed", code_accepted: true }),
      onLinkAccounts: vi.fn(),
      onRedeemCode: redeem
    });
    expect(container.textContent).not.toContain("Link Discord");
    expect(container.textContent).not.toContain("Reconnect Twitch");
  });
});

describe("SubscriptionRow visibility", () => {
  it("renders nothing when the tournament does not require a subscription", async () => {
    const container = await mount({ subscription: { required: false } as SubscriptionStatus });
    expect(container.textContent).toBe("");
  });

  it("renders nothing when this provider has no verdict", async () => {
    const container = await mount({
      subscription: { required: true, verdicts: {} } as unknown as SubscriptionStatus
    });
    expect(container.textContent).toBe("");
  });
});

describe("SubscriptionRow verdict text", () => {
  it("spells the refusal out in visible text", async () => {
    const container = await mount({
      subscription: status({ state: "inactive", reason: "no_mapped_role" })
    });
    expect(container.textContent).toContain("Boosty: not subscribed");
  });

  it("names the tier when the subscription is active", async () => {
    const container = await mount({
      subscription: status({ state: "active", tier_rank: 2, tier_label: "Уровень 2" })
    });
    expect(container.textContent).toContain("Boosty: Уровень 2");
  });

  it("falls back to a plain confirmation when the provider has no tier label", async () => {
    const container = await mount({
      subscription: status({ state: "active", tier_rank: 1 })
    });
    expect(container.textContent).toContain("Boosty: subscribed");
  });

  it("says the verdict is unresolved rather than showing nothing", async () => {
    const container = await mount({
      subscription: status({ state: "unknown", reason: "provider_unavailable" })
    });
    expect(container.textContent).toContain("Boosty: not checked");
  });
});
