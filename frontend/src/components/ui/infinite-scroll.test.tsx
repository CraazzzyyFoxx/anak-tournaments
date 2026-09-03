// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InfiniteScrollFooter } from "@/components/ui/infinite-scroll";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Minimal IntersectionObserver whose intersection we drive from the test. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  observed: Element[] = [];
  disconnected = false;

  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(element: Element) {
    this.observed.push(element);
  }

  disconnect() {
    this.disconnected = true;
  }

  unobserve() {}

  /** Report the sentinel as on screen, the way a real observer would. */
  enter() {
    this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }

  static get live() {
    return FakeIntersectionObserver.instances.filter((observer) => !observer.disconnected);
  }
}

async function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  return {
    container,
    rerender: async (next: ReactNode) => {
      await act(async () => {
        root.render(next);
      });
    }
  };
}

function loadMore(scope: HTMLElement) {
  return scope.querySelector<HTMLButtonElement>("button");
}

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

describe("InfiniteScrollFooter", () => {
  it("loads the next page when the sentinel scrolls into view", async () => {
    const fetchNextPage = vi.fn();
    await mount(
      <InfiniteScrollFooter
        loaded={20}
        total={60}
        unit="logs"
        hasNextPage
        isFetchingNextPage={false}
        fetchNextPage={fetchNextPage}
      />
    );

    FakeIntersectionObserver.live[0]?.enter();
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("stops observing while a page is in flight so one screen cannot queue two fetches", async () => {
    const fetchNextPage = vi.fn();
    const { rerender } = await mount(
      <InfiniteScrollFooter
        loaded={20}
        total={60}
        unit="logs"
        hasNextPage
        isFetchingNextPage={false}
        fetchNextPage={fetchNextPage}
      />
    );

    await rerender(
      <InfiniteScrollFooter
        loaded={20}
        total={60}
        unit="logs"
        hasNextPage
        isFetchingNextPage
        fetchNextPage={fetchNextPage}
      />
    );

    expect(FakeIntersectionObserver.live).toHaveLength(0);
  });

  it("re-observes after a page settles, so a short list keeps filling the viewport", async () => {
    const fetchNextPage = vi.fn();
    const { rerender } = await mount(
      <InfiniteScrollFooter
        loaded={20}
        total={60}
        unit="logs"
        hasNextPage
        isFetchingNextPage
        fetchNextPage={fetchNextPage}
      />
    );

    await rerender(
      <InfiniteScrollFooter
        loaded={40}
        total={60}
        unit="logs"
        hasNextPage
        isFetchingNextPage={false}
        fetchNextPage={fetchNextPage}
      />
    );

    FakeIntersectionObserver.live[0]?.enter();
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("never auto-loads while disabled, and keeps the manual control reachable", async () => {
    const fetchNextPage = vi.fn();
    const { container } = await mount(
      <InfiniteScrollFooter
        loaded={20}
        total={60}
        unit="logs"
        hasNextPage
        isFetchingNextPage={false}
        fetchNextPage={fetchNextPage}
        disabled
      />
    );

    expect(FakeIntersectionObserver.live).toHaveLength(0);

    const button = loadMore(container);
    expect(button?.textContent).toContain("Load more logs");
    expect(button?.disabled).toBe(true);
  });

  it("stops auto-loading after a failed page and asks for an explicit retry", async () => {
    // The sentinel stays on screen after a failure, so re-observing retried
    // forever: 16 requests in 5s against a failing endpoint.
    const fetchNextPage = vi.fn();
    const { container } = await mount(
      <InfiniteScrollFooter
        loaded={20}
        total={60}
        unit="logs"
        hasNextPage
        isFetchingNextPage={false}
        fetchNextPage={fetchNextPage}
        isError
      />
    );

    expect(FakeIntersectionObserver.live).toHaveLength(0);

    const button = loadMore(container);
    expect(button?.textContent).toContain("Try loading logs again");
    expect(button?.disabled).toBe(false);

    // The footer announces through a native <output> (implicit role=status).
    const status = container.querySelector("output");
    expect(status?.textContent).toBe(
      "Unable to load more logs. Check your connection and try again."
    );
  });

  it("announces progress in a status region and drops the control on the last page", async () => {
    const { container } = await mount(
      <InfiniteScrollFooter
        loaded={60}
        total={60}
        unit="logs"
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={() => {}}
      />
    );

    const status = container.querySelector("output");
    expect(status?.textContent).toBe("Showing 60 of 60 logs");
    expect(loadMore(container)).toBeNull();
  });

  it("lets a localized caller replace the built-in English progress and error copy", async () => {
    // The public pages render through next-intl, so the defaults below are
    // wrong there in any locale — the overrides must win outright, not append.
    const { container, rerender } = await mount(
      <InfiniteScrollFooter
        loaded={12}
        total={60}
        unit="logs"
        progressLabel={<span>Показано 12 из 60 турниров</span>}
        errorLabel="Не удалось загрузить ещё."
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={() => {}}
      />
    );

    expect(container.querySelector("output")?.textContent).toBe("Показано 12 из 60 турниров");

    await rerender(
      <InfiniteScrollFooter
        loaded={12}
        total={60}
        unit="logs"
        progressLabel={<span>Показано 12 из 60 турниров</span>}
        errorLabel="Не удалось загрузить ещё."
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={() => {}}
        isError
      />
    );

    expect(container.querySelector("output")?.textContent).toBe("Не удалось загрузить ещё.");
  });
});
