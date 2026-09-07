// @vitest-environment happy-dom
//
// The banner is the one notification surface an anonymous visitor ever sees, so
// its two dismissal paths are genuinely different mechanisms: an account gets a
// read mark on the server (it travels between devices), a visitor without one
// gets a `localStorage` id. These tests pin both, plus the three rendering
// claims that make it a banner rather than a list — the viewer's locale wins
// with a fallback to the publisher's, only the newest announcement shows, and
// an empty list renders nothing at all (not an empty box that still takes
// vertical space under the header).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import ru from "@/i18n/messages/ru.json";
import { DISMISSED_ANNOUNCEMENTS_STORAGE_KEY } from "@/lib/announcement-dismissed";
import type { AnnouncementLocaleText, NotificationItem } from "@/types/notification.types";

import AnnouncementBanner from "./AnnouncementBanner";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const activeAnnouncements = vi.fn();
const markRead = vi.fn();
let authUser: unknown = null;

vi.mock("@/hooks/useAuthProfile", () => ({
  useAuthProfile: () => ({ status: authUser ? "authenticated" : "anonymous", user: authUser })
}));
vi.mock("@/services/notification.service", () => ({
  default: {
    activeAnnouncements: (...args: unknown[]) => activeAnnouncements(...args),
    markRead: (...args: unknown[]) => markRead(...args)
  }
}));

const MESSAGES = { en, ru } as const;

function announcement(
  id: number,
  publishedAt: string,
  locales: Record<string, AnnouncementLocaleText>,
  defaultLocale: string,
  href?: string
): NotificationItem {
  return {
    id,
    audience: "global",
    kind: "announcement.published",
    payload: { locales, default_locale: defaultLocale, ...(href ? { href } : {}) },
    workspace_id: null,
    published_at: publishedAt,
    expires_at: null,
    is_read: false
  };
}

const BILINGUAL = announcement(
  31,
  "2026-09-05T10:00:00Z",
  {
    en: { title: "Maintenance window", body: "Sunday 02:00 UTC" },
    ru: { title: "Технические работы" }
  },
  "en",
  "/changelog"
);

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
          <AnnouncementBanner />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  await flush();
  return container;
}

function dismiss(container: HTMLElement): Promise<void> {
  const button = container.querySelector<HTMLButtonElement>("button");
  if (!button) throw new Error("the banner rendered no dismiss button");
  return act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

// Node exposes its own `localStorage` that is unusable without
// `--localstorage-file`, and happy-dom does not shadow it. A per-test in-memory
// store is also what "the same browser, one reload later" means here: it
// survives a remount inside a test and never leaks into the next one.
beforeEach(() => {
  authUser = null;
  const stored = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return stored.size;
      },
      key: (index: number) => Array.from(stored.keys())[index] ?? null,
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, String(value)),
      removeItem: (key: string) => void stored.delete(key),
      clear: () => stored.clear()
    }
  });
  activeAnnouncements.mockReset().mockResolvedValue([BILINGUAL]);
  markRead.mockReset().mockResolvedValue({ marked: 1, unread_count: 0 });
  document.body.innerHTML = "";
});

describe("announcement banner", () => {
  it("remembers an anonymous visitor's dismissal in localStorage", async () => {
    const container = await mount();
    expect(container.textContent).toContain("Maintenance window");

    await dismiss(container);
    await flush();

    expect(container.textContent).not.toContain("Maintenance window");
    // No account to hang a read mark on, so the id has to live in the browser.
    expect(markRead).not.toHaveBeenCalled();
    expect(
      JSON.parse(window.localStorage.getItem(DISMISSED_ANNOUNCEMENTS_STORAGE_KEY) ?? "[]")
    ).toContain(31);

    const remounted = await mount();
    expect(remounted.textContent).toBe("");
  });

  it("sends the mark-read mutation when the viewer has an account", async () => {
    authUser = { id: 7, username: "alice" };

    const container = await mount();
    await dismiss(container);
    await flush();

    expect(markRead).toHaveBeenCalledWith([31]);
    expect(container.textContent).not.toContain("Maintenance window");
    // The read mark is the record, and it travels between devices; a second
    // local copy would only be a thing to fall out of sync.
    expect(window.localStorage.getItem(DISMISSED_ANNOUNCEMENTS_STORAGE_KEY)).toBeNull();
  });

  it("restores the announcement when saving its dismissal fails", async () => {
    authUser = { id: 7, username: "alice" };
    markRead.mockRejectedValue(new Error("Unavailable"));
    const container = await mount();

    await dismiss(container);
    await flush();

    expect(container.textContent).toContain("Maintenance window");
    expect(container.querySelector("button")?.disabled).toBe(false);
  });

  it("prefers the viewer's locale and falls back to the publisher's default", async () => {
    const russian = await mount("ru");
    expect(russian.textContent).toContain("Технические работы");

    activeAnnouncements.mockResolvedValue([
      announcement(32, "2026-09-05T10:00:00Z", { en: { title: "English only" } }, "en")
    ]);
    const fallback = await mount("ru");
    expect(fallback.textContent).toContain("English only");
  });

  it("shows only the newest active announcement", async () => {
    activeAnnouncements.mockResolvedValue([
      announcement(40, "2026-09-01T10:00:00Z", { en: { title: "Older notice" } }, "en"),
      announcement(41, "2026-09-06T10:00:00Z", { en: { title: "Newest notice" } }, "en")
    ]);

    const container = await mount();
    // A polite live region, not `role="alert"`: the notice is announced at the
    // next pause instead of interrupting, and it is named.
    const region = container.querySelector('[role="status"]');

    expect(region?.getAttribute("aria-label")).toBeTruthy();
    expect(container.textContent).toContain("Newest notice");
    expect(container.textContent).not.toContain("Older notice");
  });

  it("renders nothing when there is no active announcement", async () => {
    activeAnnouncements.mockResolvedValue([]);

    const container = await mount();

    expect(container.textContent).toBe("");
  });
});
