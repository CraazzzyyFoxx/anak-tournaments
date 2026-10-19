// @vitest-environment happy-dom
//
// The urgent invite card names the offered slot. The notification carries only the slot CODE and the tournament,
// so the name comes from the tournament's own game dictionary, localized like every other role label.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/messages/en.json";
import ru from "@/i18n/messages/ru.json";

import { FloatStack } from "./FloatStack";

vi.mock("@/services/discipline.service", async () => (await import("@/test/discipline-metadata")).disciplineServiceMock);

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let slotCode = "tank";
let discipline = "overwatch";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/hooks/useAuthProfile", () => ({ useAuthProfile: () => ({ user: { id: 1 } }) }));
vi.mock("@/hooks/useMinuteClock", () => ({ useMinuteClock: () => 0 }));
vi.mock("@/hooks/useNotifications", () => ({
  useNotifications: () => ({
    items: [
      {
        id: 9,
        kind: "team_invite.received",
        workspace_id: 3,
        is_read: false,
        payload: { team_name: "Alpha", tournament_name: "Autumn Cup", tournament_id: 5, slot_code: slotCode }
      }
    ],
    markOneRead: () => {}
  })
}));
vi.mock("@/hooks/useTournamentClientData", () => ({
  useTournamentQuery: () => ({ data: { id: 5, workspace_id: 3, discipline } })
}));
vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (select: (state: unknown) => unknown) =>
    select({ workspaces: [{ id: 3, name: "Club", slug: "club" }], fetchWorkspaces: () => {} })
}));
vi.mock("@/components/notifications/NotificationActions", () => ({ NotificationActions: () => null }));
vi.mock("@/services/notification.service", () => ({
  default: new Proxy({}, { get: () => async () => [] })
}));

const mounted: Root[] = [];

async function render(locale: "en" | "ru") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(root);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale={locale} messages={locale === "ru" ? ru : en} timeZone="UTC">
        <QueryClientProvider client={client}>
          <FloatStack initialAnnouncements={[]} tenantWorkspaceId={null} />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  for (let turn = 0; turn < 3; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
  return container;
}

afterEach(async () => {
  await act(async () => {
    for (const root of mounted.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

describe("FloatStack invite card", () => {
  it("names an Overwatch slot in the viewer's language, not as its raw code", async () => {
    slotCode = "tank";
    discipline = "overwatch";
    const text = (await render("ru")).textContent ?? "";

    expect(text).toContain(ru.common.roles.tank);
    expect(text).not.toMatch(/\btank\b/);
  });

  it("names a League slot from its own game's dictionary", async () => {
    slotCode = "jungle";
    discipline = "lol";

    expect((await render("en")).textContent).toContain("Jungle");
  });

  it("keeps a code its game does not know as itself, and the open slot localized", async () => {
    slotCode = "unheard-of";
    discipline = "overwatch";
    expect((await render("en")).textContent).toContain("unheard-of");

    slotCode = "flex";
    expect((await render("ru")).textContent).toContain(ru.rosterShape.slotCodes.flex);
  });
});
