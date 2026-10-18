import { useSyncExternalStore } from "react";

/**
 * A history-backed stand-in for `next/navigation`, for tests whose subject is URL
 * state: `push` adds an entry, `replace` rewrites the current one, `back`/`forward`
 * move through the entries, and every reader re-renders on any of them — the parts of
 * app-router navigation a query-string-driven page depends on.
 *
 *   vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
 */
const listeners = new Set<() => void>();
let entries = ["/"];
let index = 0;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const emit = () => listeners.forEach((listener) => listener());
const current = () => entries[index] as string;

export const navigation = {
  /** Every URL pushed / replaced since the last `reset`, in order. */
  pushes: [] as string[],
  replaces: [] as string[],
  entries: () => [...entries],
  current,
  reset(url = "/") {
    entries = [url];
    index = 0;
    navigation.pushes = [];
    navigation.replaces = [];
    emit();
  },
  back() {
    index = Math.max(0, index - 1);
    emit();
  },
  forward() {
    index = Math.min(entries.length - 1, index + 1);
    emit();
  },
  /** A navigation made from outside the page under test (a link, the address bar). */
  push: (url: string) => router.push(url),
};

const router = {
  push(url: string) {
    entries = [...entries.slice(0, index + 1), url];
    index = entries.length - 1;
    navigation.pushes.push(url);
    emit();
  },
  replace(url: string) {
    entries = entries.map((entry, i) => (i === index ? url : entry));
    navigation.replaces.push(url);
    emit();
  },
  refresh() {},
  back: () => navigation.back(),
  forward: () => navigation.forward(),
  prefetch() {},
};

export const nextNavigationMock = {
  useRouter: () => router,
  usePathname: () => new URL(useSyncExternalStore(subscribe, current, current), "http://x").pathname,
  useSearchParams: () =>
    new URLSearchParams(new URL(useSyncExternalStore(subscribe, current, current), "http://x").search),
};
