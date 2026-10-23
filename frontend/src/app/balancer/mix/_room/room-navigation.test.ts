// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { navigateRoom, roomNavigationActive } from "./room-navigation";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

type Update = () => Promise<void>;

/** A `document.startViewTransition` that runs the update when told to and records the names at each capture. */
function fakeTransitions() {
  let update: Update | undefined;
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => (finish = resolve));
  const start = vi.fn((callback: Update) => {
    update = callback;
    return { finished };
  });
  Object.assign(document, { startViewTransition: start });
  Object.assign(window, { matchMedia: () => ({ matches: false }) });
  const named = () =>
    [...document.querySelectorAll<HTMLElement>("*")].filter((el) => el.style.viewTransitionName === "mix-lobby");
  const runUpdate = () => {
    if (update == null) throw new Error("no transition started");
    return update();
  };
  return { start, runUpdate, finish, named };
}

afterEach(() => {
  document.body.innerHTML = "";
  Reflect.deleteProperty(document, "startViewTransition");
  delete document.documentElement.dataset.mixNav;
});

describe("navigateRoom", () => {
  it("just navigates without the View Transitions API", () => {
    const navigate = vi.fn();
    navigateRoom("enter", 1, navigate);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("grows the lobby's card into the room, capturing the room once it is on screen", async () => {
    document.body.innerHTML = `<li data-mix-lobby="0"></li><li data-mix-lobby="1"></li>`;
    const card = document.querySelector<HTMLElement>('[data-mix-lobby="1"]')!;
    const fake = fakeTransitions();
    const navigate = vi.fn(() => {
      // The router swaps the page: the card goes, the room comes.
      queueMicrotask(() => (document.body.innerHTML = `<div data-mix-room></div>`));
    });

    navigateRoom("enter", 1, navigate);
    // Old state: only the clicked lobby's card wears the name, and the room's own transitions stand down.
    expect(fake.named()).toEqual([card]);
    expect(document.documentElement.dataset.mixNav).toBe("enter");
    expect(roomNavigationActive()).toBe(true);
    expect(navigate).not.toHaveBeenCalled();

    await fake.runUpdate();
    expect(navigate).toHaveBeenCalledOnce();
    // New state: the room's frame wears it.
    expect(fake.named()).toEqual([document.querySelector("[data-mix-room]")]);

    fake.finish();
    await vi.waitFor(() => expect(roomNavigationActive()).toBe(false));
    expect(fake.named()).toEqual([]);
    expect(document.documentElement.dataset.mixNav).toBeUndefined();
  });

  it("lets the old page go when the next one never lands", async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `<div data-mix-room></div>`;
      const fake = fakeTransitions();
      navigateRoom("leave", 0, vi.fn());
      const update = fake.runUpdate();
      await vi.advanceTimersByTimeAsync(1000);
      await update;
      // Still the room: nothing on the mix page to wear the name, and no duplicate.
      expect(fake.named()).toEqual([document.querySelector("[data-mix-room]")]);
      fake.finish();
    } finally {
      vi.useRealTimers();
    }
  });
});
