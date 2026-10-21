// @vitest-environment happy-dom
//
// The invitee's summary names the slot the invite bought. A one-role game's every slot is that role, so the
// summary names none (the single-role rule) and keeps only what still differs: the bench.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type { RegistrationForm } from "@/types/registration.types";

import InviteAcceptWizard from "./InviteAcceptWizard";

// `vi.mock` factories are hoisted above the static imports, so the fixture can only be loaded inside one.
vi.mock("@/services/discipline.service", async () => (await import("@/test/discipline-metadata")).disciplineServiceMock);
vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() } }));
// Signed out: the wizard asks the server nothing but the game's metadata.
vi.mock("@/hooks/useAuthProfile", () => ({ useAuthProfile: () => ({ status: "unauthenticated", user: null }) }));
vi.mock("@/services/registration-team.service", () => ({ default: {} }));
vi.mock("@/services/registration.service", () => ({ default: {} }));
vi.mock("@/services/me.service", () => ({ default: {} }));
// The form's own contract is covered elsewhere; only the summary above it is under test.
vi.mock("./RegistrationSchemaForm", () => ({ default: () => <div data-testid="form" /> }));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function mount(discipline: string, slotCode: string): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const form = { id: 1, tournament_id: 5, workspace_id: 1, discipline } as RegistrationForm;

  await act(async () => {
    createRoot(container).render(
      <NextIntlClientProvider locale="en" messages={en}>
        <QueryClientProvider client={client}>
          <InviteAcceptWizard
            workspaceId={1}
            tournamentId={5}
            form={form}
            teamName="Alpha"
            slotCode={slotCode}
            isSubstitute
            token="token"
            onClose={() => {}}
          />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
  // The slot is named from the owner game's metadata, which resolves after the first render.
  await act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  });
  return container;
}

describe("InviteAcceptWizard summary", () => {
  it("names the locked slot in a game with roles", async () => {
    const text = (await mount("overwatch", "damage")).textContent ?? "";

    expect(text).toContain("Damage");
  });

  it("names no slot in a one-role game, and still says it is a substitute seat", async () => {
    const text = (await mount("deadlock", "agent")).textContent ?? "";

    expect(text).not.toMatch(/agent/i);
    expect(text).toContain(en.registrationTeams.accept.substituteNotice);
  });
});
