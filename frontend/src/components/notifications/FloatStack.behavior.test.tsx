// @vitest-environment happy-dom
//
// The floating stack: one tray of rows (urgent first, the release last), the
// release on its own as an event card, and "N more" counting only what the
// bell can show. Invite rows name the offered slot from the tournament's own
// game dictionary, localized like every other role label.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/messages/en.json";
import ru from "@/i18n/messages/ru.json";
import type { Release } from "@/lib/changelog/releases";
import type { NotificationItem } from "@/types/notification.types";

import { FloatStack } from "./FloatStack";

// A `vi.mock` factory is hoisted above the imports, so the fixture module has to load inside it.
vi.mock("@/services/discipline.service", async () => (await import("@/test/discipline-metadata")).disciplineServiceMock);

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Item = { id: number; kind: string; workspace_id: number; is_read: boolean; payload: Record<string, unknown> };

let items: Item[] = [];
let announcements: NotificationItem[] = [];
let pathname = "/";
let discipline = "overwatch";

const invite = (id: number, slotCode = "tank"): Item => ({
  id,
  kind: "team_invite.received",
  workspace_id: 3,
  is_read: false,
  payload: { team_name: `Team ${id}`, tournament_name: "Autumn Cup", tournament_id: 5, slot_code: slotCode }
});
const checkIn = (id: number): Item => ({
  id,
  kind: "check_in.opened",
  workspace_id: 3,
  is_read: false,
  payload: { tournament_name: `Cup ${id}`, tournament_id: 5, closes_at: "2030-01-01T00:00:00Z" }
});
const RELEASE: Release = { version: "2.0.0", date: "2026-10-23", title: { ru: "Четыре игры", en: "Four games" } };
const ANNOUNCEMENT: NotificationItem = {
  id: 50,
  audience: "global",
  kind: "announcement.published",
  workspace_id: null,
  published_at: "2026-10-23T10:00:00Z",
  expires_at: null,
  is_read: false,
  payload: { default_locale: "en", href: "/news", locales: { en: { title: "Maintenance tonight", body: "Down for an hour." } } }
};

vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/hooks/useAuthProfile", () => ({ useAuthProfile: () => ({ user: { id: 1 } }) }));
vi.mock("@/hooks/useMinuteClock", () => ({ useMinuteClock: () => 0 }));
vi.mock("@/hooks/useNotifications", () => ({
  useNotifications: () => ({ items, markOneRead: () => {} })
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
  default: new Proxy({}, { get: (_, method) => async () => (method === "activeAnnouncements" ? announcements : []) })
}));

const mounted: Root[] = [];

async function settle() {
  for (let turn = 0; turn < 3; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

async function render(locale: "en" | "ru", release: Release | null = null) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(root);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale={locale} messages={locale === "ru" ? ru : en} timeZone="UTC">
        <QueryClientProvider client={client}>
          <FloatStack initialAnnouncements={announcements} tenantWorkspaceId={null} release={release} />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  await settle();
  return container;
}

const section = (container: HTMLElement, label: string) => container.querySelector(`section[aria-label="${label}"]`);

beforeEach(() => {
  items = [];
  announcements = [];
  pathname = "/";
  discipline = "overwatch";
  window.sessionStorage.clear();
  document.cookie = "owt-release-seen=; max-age=0; path=/";
});

afterEach(async () => {
  await act(async () => {
    for (const root of mounted.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

describe("FloatStack invite row", () => {
  it("names an Overwatch slot in the viewer's language, not as its raw code", async () => {
    items = [invite(9, "tank")];
    const text = (await render("ru")).textContent ?? "";

    expect(text).toContain(ru.common.roles.tank);
    expect(text).not.toMatch(/\btank\b/);
  });

  it("names a League slot from its own game's dictionary", async () => {
    items = [invite(9, "jungle")];
    discipline = "lol";

    expect((await render("en")).textContent).toContain("Jungle");
  });

  it("keeps a code its game does not know as itself, and the open slot localized", async () => {
    items = [invite(9, "unheard-of")];
    expect((await render("en")).textContent).toContain("unheard-of");

    items = [invite(9, "flex")];
    expect((await render("ru")).textContent).toContain(ru.rosterShape.slotCodes.flex);
  });
});

describe("FloatStack tray", () => {
  it("shows a release alone as the event card, and as a tray row beside anything else", async () => {
    const alone = await render("en", RELEASE);
    expect(section(alone, en.notifications.release.label)?.textContent).toContain("Four games");
    expect(section(alone, en.notifications.floatStack.label)).toBeNull();

    items = [checkIn(1)];
    const crowded = await render("en", RELEASE);
    expect(section(crowded, en.notifications.release.label)).toBeNull();
    expect(section(crowded, en.notifications.floatStack.label)?.textContent).toContain("Version 2.0 is out");
  });

  it("folds what does not fit into 'N more', counting only rows the bell holds", async () => {
    items = [checkIn(1), invite(2), invite(3), invite(4)];
    const tray = section(await render("en", RELEASE), en.notifications.floatStack.label);
    const text = tray?.textContent ?? "";

    // Three rows from 640px and two on a phone: one and two items left over.
    expect(text).toContain("1 more in notifications");
    expect(text).toContain("2 more in notifications");
    // No room for the release, and it is not in the bell: it waits instead of counting.
    expect(text).not.toContain("Version 2.0 is out");
    expect(tray?.querySelectorAll("li")).toHaveLength(3);
  });

  it("hides one urgent row for the visit, not the whole stack", async () => {
    items = [checkIn(1), invite(2)];
    const container = await render("en");
    const hide = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(en.notifications.urgent.hide)
    );

    await act(async () => hide?.click());

    const text = container.textContent ?? "";
    expect(text).not.toContain("Check-in for Cup 1 is open");
    expect(text).toContain("Team 2 invited you");
    expect(window.sessionStorage.getItem("owt-urgent-hidden-ids")).toBe("1");
  });

  it("lists the operator's announcement after urgent rows, with its text and link", async () => {
    items = [checkIn(1)];
    announcements = [ANNOUNCEMENT];
    const tray = section(await render("en"), en.notifications.floatStack.label);
    const rows = [...(tray?.querySelectorAll("li") ?? [])].map((row) => row.textContent ?? "");

    expect(rows[0]).toContain("Check-in for Cup 1 is open");
    expect(rows[1]).toContain("Maintenance tonight");
    expect(rows[1]).toContain("Down for an hour.");
    expect(tray?.querySelector('a[href="/news"]')?.textContent).toBe(en.notifications.banner.more);
  });

  it("drops the release card on /changelog and counts the release as seen", async () => {
    pathname = "/changelog";
    const container = await render("en", RELEASE);

    expect(section(container, en.notifications.release.label)).toBeNull();
    expect(document.cookie).toContain("owt-release-seen=2.0.0");
  });
});
