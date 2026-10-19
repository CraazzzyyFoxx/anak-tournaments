// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import SubscriptionProvidersCard, { type ProviderDraft } from "./SubscriptionProviderCard";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const listSubscriptionProviders = vi.fn();
// The card saves nothing itself: every editor reports its draft to the
// section's one SaveBar, so the draft IS the request that would be sent.
const onDraftChange = vi.fn<(provider: string, draft: ProviderDraft | null) => void>();

vi.mock("@/services/balancer-admin.service", () => ({
  default: {
    listSubscriptionProviders: (...args: unknown[]) => listSubscriptionProviders(...args)
  }
}));

const BOOSTY_WITH_STORED_CODE = {
  provider: "boosty",
  enabled: true,
  role_tiers: [{ role_id: "9876543210987654321", tier_rank: 2, tier_label: "Уровень 2" }],
  codes: [{ tier_rank: 3, tier_label: "Уровень 3" }]
};

/** `discord_guild_id` is response-level now: it belongs to the workspace, not to
 *  a provider. Default it to a real snowflake so the "no guild" warning stays out
 *  of every test that is not about it. */
async function mount(
  configs: unknown[],
  response: { discord_guild_id?: string | null } = {}
) {
  listSubscriptionProviders.mockResolvedValue({
    configs,
    discord_guild_id: "1234567890123456789",
    ...response
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <QueryClientProvider client={client}>
          <SubscriptionProvidersCard workspaceId={7} resetKey={0} onDraftChange={onDraftChange} />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  // React Query resolves through the real task queue, not just microtasks, so a
  // `Promise.resolve()` flush is not enough — it lands while the card still shows
  // its skeleton and every assertion below races it. Yield real macrotasks instead.
  const loading = () => container.querySelector(".animate-pulse") !== null;
  for (let i = 0; i < 50 && loading(); i += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
  if (loading()) {
    throw new Error("the providers query never resolved");
  }
  return container;
}

/** The last draft the editor reported for `provider`; `null` = nothing to save. */
function lastDraft(provider = "boosty"): ProviderDraft | null {
  const calls = onDraftChange.mock.calls.filter(([name]) => name === provider);
  return calls.at(-1)?.[1] ?? null;
}

/** Any edit: flipping the provider's enabled checkbox makes a draft. */
async function edit(container: HTMLElement) {
  await click(container.querySelector<HTMLElement>('button[role="checkbox"]')!);
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

/** Radix Select: the trigger opens on pointerdown, and the listbox is portalled
 *  out of the container, so options are looked up on the document. */
async function pickMethod(container: HTMLElement, label: string) {
  const trigger = container.querySelector<HTMLElement>('button[role="combobox"]');
  if (!trigger) throw new Error("no method select rendered");
  await act(async () => {
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (el) => (el.textContent ?? "").trim() === label
  );
  if (!option) throw new Error(`no method option matching ${label}`);
  await act(async () => {
    option.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
  listSubscriptionProviders.mockReset();
  onDraftChange.mockReset();
});

describe("SubscriptionProvidersCard", () => {
  it("omits `codes` when the admin typed none, so a save cannot wipe what they cannot see", async () => {
    const container = await mount([BOOSTY_WITH_STORED_CODE]);
    // Untouched: nothing to save.
    expect(lastDraft()).toBeNull();

    await edit(container);

    const body = lastDraft()!.payload;
    expect(body.enabled).toBe(false);
    expect("codes" in body).toBe(false);
  });

  it("sends the typed codes when there are any", async () => {
    const container = await mount([BOOSTY_WITH_STORED_CODE]);

    await click(button(container, "Add code"));
    const codeInput = [...container.querySelectorAll("input")].find(
      (el) => (el as HTMLInputElement).placeholder === "code from the post"
    ) as HTMLInputElement;
    await type(codeInput, "fresh-secret");

    expect(lastDraft()!.payload.codes).toEqual([{ code: "fresh-secret", tier_rank: 1 }]);
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

    expect(container.textContent).toContain(en.subscriptionProviders.warnings.duplicateRole);
    await edit(container);
    expect(lastDraft()!.blocked).toBe(true);
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

    await edit(container);

    const body = lastDraft("twitch")!.payload;
    expect(body).toMatchObject({
      provider: "twitch",
      broadcaster_id: "12345",
      broadcaster_login: "streamer"
    });
    expect("guild_id" in body).toBe(false);
    expect("role_tiers" in body).toBe(false);
  });

  it("never posts a guild — it belongs to the workspace now", async () => {
    const container = await mount([BOOSTY_WITH_STORED_CODE]);

    await edit(container);

    expect("guild_id" in lastDraft()!.payload).toBe(false);
  });

  it("warns when live verification is on but the workspace has no guild", async () => {
    const container = await mount(
      [{ ...BOOSTY_WITH_STORED_CODE, enabled: true, role_tiers: [] }],
      { discord_guild_id: null }
    );

    expect(container.textContent).toContain(en.subscriptionProviders.guild.missing);
    // Deliberate precedence: fix the guild first. With no guild AND no roles, only
    // the guild warning shows — dropping `Boolean(discordGuildId)` from `rolesMissing`
    // would surface both and leave the operator guessing which to act on.
    expect(container.textContent).not.toContain("without a role mapping");
  });

  it("renders one editor per provider the server offers", async () => {
    const container = await mount([
      BOOSTY_WITH_STORED_CODE,
      { provider: "twitch", enabled: false, role_tiers: [], codes: [] }
    ]);

    expect(container.textContent).toContain("Boosty");
    expect(container.textContent).toContain("Twitch");
    // No per-provider Save: the section's one SaveBar stores every draft.
    expect(
      [...container.querySelectorAll("button")].filter((el) => el.textContent === "Save")
    ).toHaveLength(0);
  });
});

describe("verification method", () => {
  it("defaults to either when the server sends nothing, so no mechanism is silently off", async () => {
    const container = await mount([BOOSTY_WITH_STORED_CODE]);

    await edit(container);

    expect(lastDraft()!.payload.verification_method).toBe("any");
  });

  it("labels the live option after the mechanism the provider actually uses", async () => {
    const boosty = await mount([{ ...BOOSTY_WITH_STORED_CODE, verification_method: "live" }]);
    expect(boosty.textContent).toContain(en.subscriptionProviders.methods.live.boosty.label);

    document.body.innerHTML = "";
    const twitch = await mount([
      { provider: "twitch", enabled: true, role_tiers: [], codes: [], verification_method: "live" }
    ]);
    expect(twitch.textContent).toContain(en.subscriptionProviders.methods.live.twitch.label);
    expect(twitch.textContent).not.toContain(en.subscriptionProviders.methods.live.boosty.label);
  });

  // The radio list spelled every consequence out at once; a dropdown shows one
  // label. Keeping the selected mechanism's description on screen is what makes
  // the trade acceptable, so it is a contract, not decoration.
  it("keeps only the selected mechanism's consequence on screen", async () => {
    const container = await mount([{ ...BOOSTY_WITH_STORED_CODE, verification_method: "code" }]);

    expect(container.textContent).toContain(en.subscriptionProviders.methods.code.description);
    expect(container.textContent).not.toContain(en.subscriptionProviders.methods.any.description);
  });

  it("hides the code input under live-only, and the role mapping under code-only", async () => {
    const live = await mount([{ ...BOOSTY_WITH_STORED_CODE, verification_method: "live" }]);
    expect(live.textContent).toContain(en.subscriptionProviders.guild.hint);
    expect(live.textContent).not.toContain("Challenge codes");

    document.body.innerHTML = "";
    const code = await mount([{ ...BOOSTY_WITH_STORED_CODE, verification_method: "code" }]);
    expect(code.textContent).toContain("Challenge codes");
    expect(code.textContent).not.toContain(en.subscriptionProviders.guild.hint);
  });

  it("offers challenge codes for twitch too — code-only with no input would fail open", async () => {
    const container = await mount([
      { provider: "twitch", enabled: true, role_tiers: [], codes: [], verification_method: "code" }
    ]);
    expect(container.textContent).toContain("Challenge codes");
    expect(container.textContent).not.toContain(en.subscriptionProviders.broadcaster.idLabel);
  });

  it("omits the fields of a rejected mechanism instead of blanking them", async () => {
    const container = await mount([{ ...BOOSTY_WITH_STORED_CODE, verification_method: "code" }]);

    await edit(container);

    const body = lastDraft()!.payload;
    expect(body.verification_method).toBe("code");
    // Leaving them out preserves the stored guild and roles for a switch back;
    // sending empties would destroy them on a radio click.
    expect("guild_id" in body).toBe(false);
    expect("role_tiers" in body).toBe(false);
  });

  it("sends the method the admin picked", async () => {
    const container = await mount([{ ...BOOSTY_WITH_STORED_CODE, verification_method: "any" }]);

    await pickMethod(container, en.subscriptionProviders.methods.live.boosty.label);

    expect(lastDraft()!.payload.verification_method).toBe("live");
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
