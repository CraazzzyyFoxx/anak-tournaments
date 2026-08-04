// @vitest-environment happy-dom
/**
 * The phrase field belongs to check-in and nowhere else.
 *
 * Sign-up deliberately shows the same verdicts without ever asking for a secret:
 * the registration gate defers every code-satisfiable provider precisely because
 * this dialog is where the code can be entered and where the requirement is
 * final. These tests pin that this panel does offer the field, that a redemption
 * updates the chip in place (so the patron sees it land before pressing
 * check-in), and that a closed dialog never spends a provider-backed read.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import type { SubscriptionStatus } from "@/types/registration.types";
import CheckInSubscriptionProof from "./CheckInSubscriptionProof";

const getMySubscriptionStatus = vi.fn();
const redeemSubscriptionCode = vi.fn();

// `vi.mock` is hoisted above the import above, so the component sees these fns.
vi.mock("@/services/registration.service", () => ({
  default: {
    getMySubscriptionStatus: (...args: unknown[]) => getMySubscriptionStatus(...args),
    redeemSubscriptionCode: (...args: unknown[]) => redeemSubscriptionCode(...args)
  }
}));

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
      requiredAny: "An active subscription is required: {rule}",
      requiredAll: "Active subscriptions are required: {rule}",
      codeLabel: "Code from the subscriber-only post",
      codePlaceholder: "Paste the code",
      codeSubmit: "Redeem",
      codeAccepted: "Code accepted",
      linkDiscordCta: "Link Discord",
      reconnectTwitchCta: "Reconnect Twitch"
    }
  }
};

const CODE_PENDING: SubscriptionStatus = {
  required: true,
  mode: "any",
  outcome: "refused",
  rule: "Boosty level 2 or Twitch",
  blocks_registration: false,
  verdicts: {
    boosty: { state: "inactive", reason: "no_code_redeemed", code_accepted: true },
    twitch: { state: "inactive", reason: "no_subscription", code_accepted: false }
  }
} as unknown as SubscriptionStatus;

const REQUIREMENT = {
  mode: "any" as const,
  requirements: [{ provider: "boosty", min_tier_rank: 2 }, { provider: "twitch" }]
};

/** One macrotask, wrapped in `act`: react-query resolves its fetch a tick after
 *  render, so a single `act` around `render` can commit an empty tree. */
async function flush() {
  await act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  });
}

async function mount(props: { active: boolean }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
          <CheckInSubscriptionProof tournamentId={7} requirement={REQUIREMENT} {...props} />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });
  await flush();
  return container;
}

/** React tracks the previous value on the node, so a plain `input.value = …`
 *  assignment is treated as no change. Go through the native setter. */
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function redeemButton(container: HTMLElement): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Redeem"));
  if (!found) throw new Error("no Redeem button");
  return found as HTMLButtonElement;
}

beforeEach(() => {
  document.body.innerHTML = "";
  getMySubscriptionStatus.mockReset();
  redeemSubscriptionCode.mockReset();
  getMySubscriptionStatus.mockResolvedValue(CODE_PENDING);
  redeemSubscriptionCode.mockResolvedValue({
    ...CODE_PENDING,
    outcome: "satisfied",
    verdicts: {
      ...CODE_PENDING.verdicts,
      boosty: { state: "active", tier_rank: 2, code_accepted: true }
    }
  });
});

describe("CheckInSubscriptionProof", () => {
  it("offers the phrase field for the provider that accepts one", async () => {
    const container = await mount({ active: true });
    expect(container.textContent).toContain("Code from the subscriber-only post");
  });

  it("states the composed rule, so an `any` requirement does not read as two failures", async () => {
    const container = await mount({ active: true });
    expect(container.textContent).toContain("Boosty level 2 or Twitch");
  });

  it("offers exactly one field, not one per required provider", async () => {
    const container = await mount({ active: true });
    expect(container.querySelectorAll("input")).toHaveLength(1);
  });

  it("does not read the status while the dialog is closed", async () => {
    await mount({ active: false });
    expect(getMySubscriptionStatus).not.toHaveBeenCalled();
  });

  it("redeems for the row's own provider", async () => {
    const container = await mount({ active: true });
    await type(container.querySelector("input") as HTMLInputElement, " secret ");
    await act(async () => {
      redeemButton(container).click();
    });
    await flush();
    expect(redeemSubscriptionCode).toHaveBeenCalledWith(7, "secret", "boosty");
  });

  it("writes the recomposed status back, so the chip turns green in place", async () => {
    const container = await mount({ active: true });
    await type(container.querySelector("input") as HTMLInputElement, "secret");
    await act(async () => {
      redeemButton(container).click();
    });
    await flush();
    expect(container.textContent).toContain("subscribed");
    // A satisfied provider stops offering the field.
    expect(container.textContent).not.toContain("Code from the subscriber-only post");
    // The chip came from the redemption response, not a refetch.
    expect(getMySubscriptionStatus).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when the tournament requires no subscription", async () => {
    getMySubscriptionStatus.mockResolvedValue({ required: false, verdicts: {} } as SubscriptionStatus);
    const container = await mount({ active: true });
    expect(container.textContent).toBe("");
  });
});
