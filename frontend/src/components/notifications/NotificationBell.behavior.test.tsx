// @vitest-environment happy-dom
//
// The bell is the only surface an in-app notification exists on: nothing else
// tells a user that an invite arrived, that their registration was decided or
// that a report they filed is disputed. So these tests pin the four claims that
// make it a working inbox rather than an icon — the unread count is *announced*,
// the realtime signal actually refetches, "mark all read" clears the badge, and
// an anonymous visitor gets nothing at all — plus the one message that cannot be
// written as a plain interpolation: a disputed report with no pick-ban session
// carries `map_index: 0`, and "map 0" is not a thing that exists.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import ru from "@/i18n/messages/ru.json";
import type { NotificationInbox, NotificationItem } from "@/types/notification.types";

import NotificationBell from "./NotificationBell";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const list = vi.fn();
const markRead = vi.fn();
let authUser: unknown = { id: 1, username: "alice" };

// Topic -> handler, so a test can fire the push the server would send. The
// factory is hoisted above these declarations, so it must reference them lazily.
const realtimeHandlers = new Map<string, (event: unknown) => void>();

vi.mock("@/hooks/useAuthProfile", () => ({
  useAuthProfile: () => ({ status: authUser ? "authenticated" : "anonymous", user: authUser })
}));
vi.mock("@/hooks/useRealtimeTopic", () => ({
  useRealtimeTopic: (topic: string | null | undefined, onEvent: (event: unknown) => void) => {
    if (topic) realtimeHandlers.set(topic, onEvent);
  }
}));
vi.mock("@/services/notification.service", () => ({
  default: {
    list: (...args: unknown[]) => list(...args),
    markRead: (...args: unknown[]) => markRead(...args)
  }
}));

const MESSAGES = { en, ru } as const;

const PUBLISHED = "2026-09-07T10:00:00Z";

function item(overrides: Partial<NotificationItem> & Pick<NotificationItem, "id" | "kind">): NotificationItem {
  return {
    audience: "user",
    payload: {},
    workspace_id: null,
    published_at: PUBLISHED,
    expires_at: null,
    is_read: false,
    ...overrides
  } as NotificationItem;
}

const INVITE = item({
  id: 11,
  kind: "team_invite.received",
  payload: {
    team_id: 7,
    team_name: "Alpha",
    tournament_id: 5,
    tournament_name: "Autumn Cup",
    slot_code: "dps",
    is_substitute: false,
    invite_id: 42
  }
});

const DISPUTED_WITH_MAP = item({
  id: 12,
  kind: "encounter.report_disputed",
  payload: { encounter_id: 9, tournament_id: 5, map_id: 3, map_index: 2 }
});

// The encounter had no pick-ban session, so there is no map ordinal at all.
const DISPUTED_NO_MAP = item({
  id: 13,
  kind: "encounter.report_disputed",
  payload: { encounter_id: 9, tournament_id: 5, map_id: 0, map_index: 0 }
});

// The one kind whose text is operator-written, and the one that carries a link.
const ANNOUNCEMENT = item({
  id: 14,
  kind: "announcement.published",
  audience: "global",
  payload: {
    default_locale: "en",
    href: "/changelog",
    locales: { en: { title: "Maintenance window" } }
  }
});

function inbox(items: NotificationItem[], unreadCount = items.length): NotificationInbox {
  return { items, unread_count: unreadCount, next_cursor: null };
}

async function flush(): Promise<void> {
  await act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  });
}

async function mount(locale: "en" | "ru" = "en"): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  await act(async () => {
    createRoot(container).render(
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
        <QueryClientProvider client={client}>
          <NotificationBell />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  await flush();
  return container;
}

function click(element: Element): Promise<void> {
  return act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** The popover is portalled to `document.body`, not into the mount container. */
function openPanel(): Promise<void> {
  const trigger = document.body.querySelector("button");
  if (!trigger) throw new Error("the bell rendered no trigger");
  return click(trigger);
}

beforeEach(() => {
  authUser = { id: 1, username: "alice" };
  realtimeHandlers.clear();
  list.mockReset().mockResolvedValue(inbox([INVITE, DISPUTED_WITH_MAP]));
  markRead.mockReset().mockResolvedValue({ marked: 2, unread_count: 0 });
  document.body.innerHTML = "";
});

describe("notification bell", () => {
  it("announces the unread count instead of only colouring a dot", async () => {
    const container = await mount();
    const trigger = container.querySelector("button");

    expect(trigger).not.toBeNull();
    // The number is in the accessible name: a badge a screen reader cannot
    // reach is the same as no badge at all.
    expect(trigger?.getAttribute("aria-label")).toContain("2");
    expect(container.textContent).toContain("2");
  });

  it("refetches when the realtime signal arrives, because the event carries no payload", async () => {
    await mount();

    expect(list).toHaveBeenCalledTimes(1);
    const handler = realtimeHandlers.get("user:1:notifications");
    expect(handler, "the bell did not subscribe to the caller's own topic").toBeTypeOf("function");

    list.mockResolvedValue(inbox([INVITE, DISPUTED_WITH_MAP, DISPUTED_NO_MAP]));
    await act(async () => {
      handler?.({ event_id: 0, event_type: "notification.created", data: {} });
    });
    await flush();

    expect(list).toHaveBeenCalledTimes(2);
  });

  it("renders each row from its kind and payload, never from server text", async () => {
    list.mockResolvedValue(inbox([INVITE]));
    await mount();
    await openPanel();
    await flush();

    const panel = document.body.textContent ?? "";
    expect(panel).toContain("Alpha");
    expect(panel).toContain("Autumn Cup");
    // A raw key path here means the kind has no message in this dictionary.
    expect(panel).not.toContain("notifications.kinds");
  });

  it("does not invent a map number for a dispute with no pick-ban session", async () => {
    list.mockResolvedValue(inbox([DISPUTED_WITH_MAP, DISPUTED_NO_MAP]));
    await mount();
    await openPanel();
    await flush();

    const panel = document.body.textContent ?? "";
    // The ordinal is rendered when there is one...
    expect(panel).toContain("map 2");
    // ...and the zero row falls back to a form with no ordinal at all, rather
    // than claiming a "map 0" the encounter never had.
    expect(panel).toContain("A report in your match is disputed");
    expect(panel).not.toMatch(/\bmap\s*(#\s*)?0\b/i);
  });

  it("does not invent a map number in Russian either", async () => {
    list.mockResolvedValue(inbox([DISPUTED_NO_MAP]));
    await mount("ru");
    await openPanel();
    await flush();

    const panel = document.body.textContent ?? "";
    expect(panel).not.toContain("notifications.kinds");
    expect(panel).toContain("Отчёт по вашему матчу оспорен");
    expect(panel).not.toMatch(/карт\S*\s*0\b/i);
  });

  it("clears the badge when the whole inbox is marked read", async () => {
    const container = await mount();
    await openPanel();

    const markAll = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === en.notifications.markAllRead
    );
    expect(markAll, "no mark-all-read control").not.toBeUndefined();

    list.mockResolvedValue(inbox([{ ...INVITE, is_read: true }], 0));
    await click(markAll!);
    await flush();

    // No ids: "mark everything I can currently see" is the server's own
    // semantic for an omitted list, so the client must not enumerate a page.
    expect(markRead).toHaveBeenCalledWith(undefined);
    expect(container.querySelector("button")?.getAttribute("aria-label")).not.toContain("2");
  });

  it("reaches the page behind the cursor instead of stopping at the newest 20", async () => {
    list.mockReset();
    list.mockResolvedValueOnce({ items: [INVITE], unread_count: 21, next_cursor: "cursor-1" });
    list.mockResolvedValueOnce({ items: [DISPUTED_NO_MAP], unread_count: 21, next_cursor: null });

    await mount();
    await openPanel();
    await flush();

    const older = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === en.notifications.loadMore
    );
    expect(older, "no control for the page the cursor points at").not.toBeUndefined();

    await click(older!);
    await flush();

    expect(list).toHaveBeenLastCalledWith({ cursor: "cursor-1" });
    // Both pages are on screen, newest first, and neither replaced the other.
    const panel = document.body.textContent ?? "";
    expect(panel).toContain("Alpha");
    expect(panel).toContain("A report in your match is disputed");
    // Last page: nothing left to ask the server for.
    expect(
      [...document.body.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === en.notifications.loadMore
      )
    ).toBe(false);
  });

  it("links an announcement row to its href, and drops one that is not a safe target", async () => {
    list.mockResolvedValue(inbox([ANNOUNCEMENT]));
    await mount();
    await openPanel();
    await flush();

    const link = document.body.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/changelog");
    expect(link?.textContent).toContain("Maintenance window");

    // A `javascript:` payload on a row every recipient opens is stored XSS —
    // the row keeps its text and loses the anchor.
    document.body.innerHTML = "";
    list.mockResolvedValue(
      inbox([item({ ...ANNOUNCEMENT, payload: { ...ANNOUNCEMENT.payload, href: "javascript:alert(1)" } })])
    );
    await mount();
    await openPanel();
    await flush();

    expect(document.body.querySelector("a")).toBeNull();
    expect(document.body.textContent).toContain("Maintenance window");
  });

  it("renders nothing for an anonymous visitor", async () => {
    authUser = undefined;

    const container = await mount();

    expect(container.textContent).toBe("");
    expect(list).not.toHaveBeenCalled();
    // No identity, no topic: `user:undefined:notifications` would be a
    // subscription the gateway ACL rejects on every reconnect.
    expect([...realtimeHandlers.keys()]).toEqual([]);
  });
});
