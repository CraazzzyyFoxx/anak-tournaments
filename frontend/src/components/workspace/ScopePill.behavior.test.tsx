// @vitest-environment happy-dom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import { GameFilterHint } from "@/components/workspace/GameFilterHint";
import { useGameBoundParams, useScopePillOpen } from "@/components/workspace/scope-pill-store";
import { navigation } from "@/test/url-navigation";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { DisciplineDescriptor } from "@/types/discipline.types";
import type { Workspace } from "@/types/workspace.types";

import { ScopePill } from "./ScopePill";
import { ServerGameTabs } from "./ServerGameTabs";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
vi.mock("next/link", () => ({
  default: ({ prefetch: _prefetch, ...rest }: ComponentProps<"a"> & { prefetch?: boolean | null }) => <a {...rest} />
}));
vi.mock("@/services/discipline.service", () => ({ default: { list: mocks.list } }));
vi.mock("@/hooks/useAuthProfile", () => ({ useAuthProfile: () => ({ status: "anonymous", user: null, error: null }) }));

const game = (code: string, name: string, short_name: string) =>
  ({ code, name, short_name, icon: null, enabled: true }) as DisciplineDescriptor;
const INSTALLED = [game("overwatch", "Overwatch", "OW"), game("lol", "League of Legends", "LoL"), game("chess", "Chess", "CH")];
const workspace = (id: number, name: string, enabled: string[]) =>
  ({ id, slug: `w${id}`, name, icon_url: null, disciplines_enabled: enabled }) as Workspace;
const WORKSPACES = [
  workspace(1, "Both Games", ["overwatch", "lol"]),
  workspace(2, "One Game", ["overwatch"]),
  workspace(3, "No League", ["overwatch", "chess"])
];

let root: Root;

const settle = () => act(() => new Promise<void>((done) => setTimeout(done, 0)));

async function mount(node: ReactNode = <ScopePill />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <QueryClientProvider client={client}>{node}</QueryClientProvider>
      </NextIntlClientProvider>
    )
  );
  await settle();
}

const trigger = () => document.querySelector<HTMLButtonElement>('button[aria-label$="— change scope"]');
const popover = () => document.querySelector('[role="dialog"]');
const group = (heading: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="group"]')].find(
    (candidate) => document.getElementById(candidate.getAttribute("aria-labelledby") ?? "")?.textContent === heading
  );
const option = (scope: HTMLElement | undefined, name: string) =>
  [...(scope?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((button) => button.textContent?.includes(name));

async function click(element: HTMLElement | null | undefined) {
  if (!element) throw new Error("nothing to click");
  await act(async () => element.click());
  await settle();
}

const tab = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((node) => node.textContent?.includes(name));
/** Radix tabs pick on mousedown. */
async function pick(name: string) {
  const target = tab(name);
  if (!target) throw new Error(`no ${name} tab`);
  await act(async () => target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
  await settle();
}

beforeEach(() => {
  document.body.innerHTML = "";
  for (const name of ["owt-discipline", "owt-last-game", "owt-workspace-id", "owt-stats-scope"]) {
    document.cookie = `${name}=; Max-Age=0; path=/`;
  }
  navigation.reset("/tournaments");
  mocks.list.mockReset().mockImplementation(async (axis: number | "all") => {
    const enabled = axis === "all" ? null : (WORKSPACES.find((w) => w.id === axis)?.disciplines_enabled ?? []);
    return INSTALLED.map((g) => ({ ...g, enabled: enabled === null || enabled.includes(g.code) }));
  });
  useScopePillOpen.setState({ open: false, gameBoundParams: [] });
  useWorkspaceStore.setState({
    workspaces: WORKSPACES,
    currentWorkspaceId: 1,
    statsScope: "all",
    hostLockedWorkspaceId: null,
    entityWorkspaceId: null,
    entityDiscipline: null,
    gameScope: "all",
    lastGame: null,
    fetchWorkspaces: async () => undefined
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe("the site scope pill", () => {
  it("names the community and the game in the trigger, and drops the game part where the area runs one game", async () => {
    await mount();
    expect(trigger()?.getAttribute("aria-label")).toBe("All communities · All games — change scope");

    await act(async () => useWorkspaceStore.setState({ statsScope: "workspace", currentWorkspaceId: 2 }));
    await settle();
    expect(trigger()?.getAttribute("aria-label")).toBe("One Game — change scope");
  });

  it("marks the current community and game in two labelled groups", async () => {
    useWorkspaceStore.setState({ statsScope: "workspace", currentWorkspaceId: 1, gameScope: "lol" });
    await mount();
    await click(trigger());

    expect(option(group("Communities"), "Both Games")?.getAttribute("aria-pressed")).toBe("true");
    expect(option(group("Communities"), "All communities")?.getAttribute("aria-pressed")).toBe("false");
    expect(option(group("Game"), "League of Legends")?.getAttribute("aria-pressed")).toBe("true");
    expect(option(group("Game"), "All games")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps the popover open on a community pick and shows that community's games", async () => {
    await mount();
    await click(trigger());
    expect(option(group("Game"), "League of Legends")).toBeDefined();

    await click(option(group("Communities"), "No League"));
    expect(useWorkspaceStore.getState()).toMatchObject({ currentWorkspaceId: 3, statsScope: "workspace" });
    expect(popover()).not.toBeNull();
    expect(option(group("Game"), "League of Legends")).toBeUndefined();
    expect(option(group("Game"), "Chess")).toBeDefined();
  });

  it("drops a URL game the picked community does not run, and keeps the saved game", async () => {
    navigation.reset("/tournaments?discipline=lol&q=cup");
    useWorkspaceStore.setState({ gameScope: "lol" });
    await mount();
    await click(trigger());

    await click(option(group("Communities"), "No League"));
    expect(navigation.replaces).toEqual(["/tournaments?q=cup"]);
    expect(useWorkspaceStore.getState().gameScope).toBe("lol");
  });

  it("a game pick saves the scope and the last game, narrows the page's URL and closes the popover", async () => {
    navigation.reset("/tournaments?page=3");
    await mount();
    await click(trigger());

    await click(option(group("Game"), "League of Legends"));
    expect(document.cookie).toContain("owt-discipline=lol");
    expect(document.cookie).toContain("owt-last-game=lol");
    expect(navigation.pushes).toEqual(["/tournaments?discipline=lol"]);
    expect(popover()).toBeNull();
    expect(trigger()?.getAttribute("aria-label")).toBe("All communities · League of Legends — change scope");
  });

  it("all games forgets the scope and the URL game but keeps the last game", async () => {
    navigation.reset("/tournaments?discipline=lol");
    useWorkspaceStore.setState({ gameScope: "lol", lastGame: "lol" });
    await mount();
    await click(trigger());

    await click(option(group("Game"), "All games"));
    expect(document.cookie).not.toContain("owt-discipline=");
    expect(useWorkspaceStore.getState()).toMatchObject({ gameScope: "all", lastGame: "lol" });
    expect(navigation.pushes).toEqual(["/tournaments"]);
  });

  it("shows all games with a note where the community does not run the saved game, and never rewrites it", async () => {
    useWorkspaceStore.setState({ statsScope: "workspace", currentWorkspaceId: 3, gameScope: "lol" });
    await mount();
    await click(trigger());

    expect(option(group("Game"), "All games")?.getAttribute("aria-pressed")).toBe("true");
    expect(group("Game")?.textContent).toContain("League of Legends isn't played in this community — showing all games");
    expect(useWorkspaceStore.getState().gameScope).toBe("lol");
  });

  it("locks the game to the opened owner's, and says why", async () => {
    navigation.reset("/tournaments/spring-cup");
    useWorkspaceStore.setState({ entityDiscipline: "lol" });
    await mount();
    expect(trigger()?.getAttribute("aria-label")).toBe("All communities · League of Legends — change scope");

    await click(trigger());
    expect(option(group("Game"), "Overwatch")?.disabled).toBe(true);
    expect(option(group("Game"), "League of Legends")?.getAttribute("aria-pressed")).toBe("true");
    expect(group("Game")?.textContent).toContain("Game set by this tournament: League of Legends");
  });

  it("dims the game on a page that does not depend on it", async () => {
    navigation.reset("/privacy");
    await mount();
    expect(trigger()?.querySelector("[data-dimmed]")).not.toBeNull();

    await click(trigger());
    expect(option(group("Game"), "All games")?.disabled).toBe(true);
    expect(group("Game")?.textContent).toContain("This page doesn't depend on the game");
  });

  it("shows only the game on a tenant host, and nothing where the tenant runs one game", async () => {
    useWorkspaceStore.setState({ hostLockedWorkspaceId: 1, currentWorkspaceId: 1, statsScope: "workspace" });
    await mount();
    expect(trigger()?.getAttribute("aria-label")).toBe("All games — change scope");
    await click(trigger());
    expect(group("Communities")).toBeUndefined();
    expect(document.querySelector('a[href="/get-workspace"]')).toBeNull();

    await act(async () => root.unmount());
    useScopePillOpen.setState({ open: false });
    useWorkspaceStore.setState({ hostLockedWorkspaceId: 2, currentWorkspaceId: 2 });
    await mount();
    expect(trigger()).toBeNull();

    // An owner page locks a game, but a one-game tenant has no pill to lock it in.
    await act(async () => root.unmount());
    navigation.reset("/tournaments/spring-cup");
    useWorkspaceStore.setState({ entityDiscipline: "overwatch" });
    await mount();
    expect(trigger()).toBeNull();
  });

  it("opens from a filter hint", async () => {
    await mount(
      <>
        <ScopePill />
        <GameFilterHint />
      </>
    );
    await click([...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Some filters need a game")));
    expect(popover()).not.toBeNull();
  });

  it("drops the page's registered game-bound params on a game pick", async () => {
    function Filters() {
      useGameBoundParams(["role"]);
      return null;
    }
    navigation.reset("/tournaments?role=tank&q=x");
    await mount(
      <>
        <ScopePill />
        <Filters />
      </>
    );
    await click(trigger());

    await click(option(group("Game"), "League of Legends"));
    expect(navigation.pushes).toEqual(["/tournaments?q=x&discipline=lol"]);
  });

  it("works from the keyboard: open, pick a game, and Escape returns focus to the trigger", async () => {
    // happy-dom runs no default actions: a keyboard activation of a native button is its keydown
    // followed by the click the browser fires for it (`detail: 0`), so both are dispatched.
    const press = async (element: Element | null | undefined, key: string) => {
      if (!(element instanceof HTMLElement)) throw new Error(`nothing to press ${key} on`);
      await act(async () => {
        element.focus();
        element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        if (key === "Enter" || key === " ") element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
      });
      await settle();
    };
    await mount();

    await press(trigger(), "Enter");
    expect(popover()).not.toBeNull();
    expect(popover()?.contains(document.activeElement)).toBe(true);

    await press(option(group("Game"), "League of Legends"), " ");
    expect(useWorkspaceStore.getState().gameScope).toBe("lol");
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(trigger());

    await press(trigger(), " ");
    expect(popover()).not.toBeNull();
    await press(document.activeElement, "Escape");
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  describe("beside a page's local game tabs", () => {
    const INITIAL = { stored: "all", lastGame: null, axis: "all", hostLockedWorkspaceId: null, disciplines: null } as const;
    const page = (
      <>
        <ScopePill />
        <ServerGameTabs initial={INITIAL} />
      </>
    );

    it("keeps all games on a single page after a tab pick, which narrows only the page", async () => {
      navigation.reset("/users/compare");
      await mount(page);
      await pick("League of Legends");

      expect(navigation.pushes).toEqual(["/users/compare?discipline=lol"]);
      expect(useWorkspaceStore.getState()).toMatchObject({ gameScope: "all", lastGame: "lol" });
      expect(trigger()?.getAttribute("aria-label")).toBe("All communities · All games — change scope");
    });

    it("a game block on a multi page remembers the tab's game without narrowing the page's URL", async () => {
      navigation.reset("/");
      await mount(page);
      await pick("League of Legends");

      expect(navigation.pushes).toEqual([]);
      expect(useWorkspaceStore.getState()).toMatchObject({ gameScope: "all", lastGame: "lol" });
      expect(tab("League of Legends")?.getAttribute("aria-selected")).toBe("true");
      expect(trigger()?.getAttribute("aria-label")).toBe("All communities · All games — change scope");
    });

    it("a game block on a multi page follows the page's URL game: that game, no tabs", async () => {
      navigation.reset("/?discipline=lol");
      await mount(page);

      expect(tab("Overwatch")).toBeUndefined();
      expect(tab("League of Legends")).toBeUndefined();
      expect(trigger()?.getAttribute("aria-label")).toBe("All communities · League of Legends — change scope");
    });

    it("a game block on a multi page answers an invalid URL game with the multi page's way out", async () => {
      navigation.reset("/?discipline=nope");
      await mount(page);

      expect(tab("League of Legends")).toBeUndefined();
      await click([...document.querySelectorAll("button")].find((node) => node.textContent === en.common.discipline.showAll));
      expect(navigation.pushes).toEqual(["/"]);
    });
  });
});
