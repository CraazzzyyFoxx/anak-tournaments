// @vitest-environment happy-dom
//
// The invite ledger. Two gaps it closes, and both are about invisibility:
//
// 1. The team read returns only LIVE pending invites, because occupancy depends on
//    them reserving roster slots. So a DECLINED offer vanished — the captain saw
//    the slot reopen with no idea whether they were refused or the link lapsed.
// 2. The cap counts every invite ever created, so an invite→revoke→invite loop
//    burned the ceiling silently and produced a refusal with no cause on screen.
//
// The collapsed-costs-nothing promise is asserted too: this sits inside a panel
// most captains open for other reasons.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import ru from "@/i18n/messages/ru.json";

import InviteHistorySection from "./InviteHistorySection";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const listInviteHistory = vi.fn();

vi.mock("@/services/registration-team.service", () => ({
  default: { listInviteHistory: (...args: unknown[]) => listInviteHistory(...args) },
}));

const MESSAGES = { en, ru } as const;

const ENTRY = {
  id: 1,
  slot_code: "dps",
  is_substitute: false,
  state: "declined",
  target_battle_tag: "Ana#1111",
  is_link: false,
  invited_at: "2026-08-20T12:00:00Z",
  expires_at: null,
  answered_at: "2026-08-21T09:00:00Z",
  revoked_by_organizer: false,
};

const LEDGER = { items: [{ ...ENTRY }], cap_used: 12, cap_limit: 60, cap_reset_at: null };

async function mount(
  { expanded = true, locale = "en" as "en" | "ru" } = {},
): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  await act(async () => {
    createRoot(container).render(
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
        <QueryClientProvider client={client}>
          <InviteHistorySection
            workspaceId={1}
            teamId={7}
            expanded={expanded}
            onToggle={() => {}}
          />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  });
  return container;
}

beforeEach(() => {
  listInviteHistory.mockReset().mockResolvedValue({ ...LEDGER });
  document.body.innerHTML = "";
});

describe("invite history section", () => {
  it("costs nothing while collapsed", async () => {
    // It lives inside a panel captains open to manage a roster, not to read a
    // ledger. A request on every mount would tax everyone for a rare need.
    const container = await mount({ expanded: false });

    expect(listInviteHistory).not.toHaveBeenCalled();
    // The disclosure itself must still be there, or the data is unreachable.
    expect(container.querySelector("button")).not.toBeNull();
    expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the declined offer that used to vanish", async () => {
    const container = await mount();

    expect(listInviteHistory).toHaveBeenCalledWith(7);
    expect(container.textContent).toContain("Declined");
    expect(container.textContent).toContain("Ana#1111");
    // The slot reads through the shared translations, not as a raw wire code.
    expect(container.textContent).toContain("Damage");
    expect(container.textContent).not.toContain("dps");
  });

  it("explains the ceiling the refusal talks about", async () => {
    const container = await mount();

    expect(container.textContent).toContain("12 of 60");
  });

  it("says the count has a floor when an organizer moved it", async () => {
    // Without this "12 of 60" reads as the team's whole lifetime, which is exactly
    // the confusion a reset would otherwise create.
    listInviteHistory.mockResolvedValue({ ...LEDGER, cap_reset_at: "2026-08-01T00:00:00Z" });

    const container = await mount();

    expect(container.textContent).toContain("Counted since");
  });

  it("warns before the ceiling instead of after it", async () => {
    listInviteHistory.mockResolvedValue({ ...LEDGER, cap_used: 57 });

    const container = await mount();

    // Names both ways out; a bare number would leave the captain stuck.
    expect(container.textContent).toContain("Revoke an outstanding invite");
    expect(container.textContent).toContain("organizer");
  });

  it("stays quiet about the ceiling when it is far away", async () => {
    const container = await mount();

    expect(container.textContent).not.toContain("Close to the limit");
  });

  it("names an organizer withdrawal as such", async () => {
    // Same `revoked` state, materially different event — and the reason the write
    // path records provenance instead of the reader guessing from who captains now.
    listInviteHistory.mockResolvedValue({
      ...LEDGER,
      items: [{ ...ENTRY, state: "revoked", revoked_by_organizer: true }],
    });

    const container = await mount();

    expect(container.textContent).toContain("Withdrawn by an organizer");
  });

  it("labels a link invite instead of leaving its addressee blank", async () => {
    listInviteHistory.mockResolvedValue({
      ...LEDGER,
      items: [{ ...ENTRY, target_battle_tag: null, is_link: true }],
    });

    const container = await mount();

    expect(container.textContent).toContain("Shareable link");
  });

  it("renders a state it does not know as itself", async () => {
    // A sixth server state must not turn a row into a raw key path. This is the
    // third place in this feature where a typed translator would otherwise render
    // `registrationTeams.history.state.<x>` to a user.
    listInviteHistory.mockResolvedValue({ ...LEDGER, items: [{ ...ENTRY, state: "quarantined" }] });

    const container = await mount();

    expect(container.textContent).toContain("quarantined");
    expect(container.textContent).not.toMatch(/history\.state\./);
  });

  it("says an expanded ledger is empty rather than showing a gap", async () => {
    // Distinct from collapsed: the captain asked, so silence would read as broken.
    listInviteHistory.mockResolvedValue({ ...LEDGER, items: [] });

    const container = await mount();

    expect(container.textContent).toContain("No invites have been issued yet");
  });

  it("renders every key it asks for in Russian too", async () => {
    const container = await mount({ locale: "ru" });

    expect(container.textContent).toContain("Отклонено");
    expect(container.textContent).not.toMatch(/registrationTeams\.|rosterShape\./);
  });
});
