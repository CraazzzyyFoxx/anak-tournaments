// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGameScope, type GameScopeState } from "@/hooks/useGameScope";
import type { GameScopeInit } from "@/lib/site/discipline-scope";
import { navigation } from "@/test/url-navigation";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { DisciplineDescriptor } from "@/types/discipline.types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
vi.mock("@/services/discipline.service", () => ({ default: { list: mocks.list } }));

const GAMES = [
  { code: "overwatch", name: "Overwatch", short_name: "OW", icon: null, enabled: true, capabilities: { native_rank_collection: true } },
  { code: "lol", name: "League of Legends", short_name: "LoL", icon: null, enabled: true, capabilities: { native_rank_collection: false } }
] as unknown as DisciplineDescriptor[];

type Options = NonNullable<Parameters<typeof useGameScope>[0]>;

function init(overrides: Partial<GameScopeInit> = {}): GameScopeInit {
  return { stored: "all", lastGame: null, axis: "all", hostLockedWorkspaceId: null, disciplines: GAMES, ...overrides };
}

function Probe({ options }: Readonly<{ options: Options }>) {
  const { axis, resolution } = useGameScope(options);
  return <output>{JSON.stringify({ axis, resolution })}</output>;
}

let latest: GameScopeState;
function Live({ options }: Readonly<{ options: Options }>) {
  const state = useGameScope(options);
  useEffect(() => {
    latest = state;
  });
  return null;
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** One request's server render: the server store never saw the visitor's cookies, only `initial` did. */
function serverRender(options: Options, url = "/x") {
  navigation.reset(url);
  useWorkspaceStore.setState({ gameScope: "all", lastGame: null, hostLockedWorkspaceId: null, currentWorkspaceId: null, statsScope: "all" });
  return renderToString(
    <QueryClientProvider client={client()}>
      <Probe options={options} />
    </QueryClientProvider>
  );
}

const read = (html: string) =>
  JSON.parse(new DOMParser().parseFromString(html, "text/html").querySelector("output")?.textContent ?? "null");

const roots: Root[] = [];

async function mount(options: Options) {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client()}>
        <Live options={options} />
      </QueryClientProvider>
    )
  );
  await act(() => new Promise<void>((done) => setTimeout(done, 0)));
}

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue(GAMES);
  document.body.innerHTML = "";
  document.cookie = "owt-discipline=; Max-Age=0; path=/";
  document.cookie = "owt-last-game=; Max-Age=0; path=/";
  useWorkspaceStore.setState({ gameScope: "all", lastGame: null, hostLockedWorkspaceId: null, currentWorkspaceId: null, statsScope: "all" });
});

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
});

describe("server render of the page's game", () => {
  it("follows the visitor's saved scope from the server inputs, not the server store", () => {
    expect(read(serverRender({ pageClass: "multi", initial: init({ stored: "lol" }) })).resolution.game).toEqual({
      kind: "game",
      code: "lol",
      source: "scope"
    });
    expect(read(serverRender({ pageClass: "multi", initial: init() })).resolution.game).toEqual({ kind: "all" });
  });

  it("reads the URL over the scope, keeps an invalid value as an error and reads ?discipline=all as no parameter", () => {
    const lol = init({ stored: "lol" });
    expect(read(serverRender({ pageClass: "multi", initial: lol }, "/x?discipline=overwatch")).resolution.game).toEqual({
      kind: "game",
      code: "overwatch",
      source: "url"
    });
    expect(read(serverRender({ pageClass: "multi", initial: lol }, "/x?discipline=starcraft")).resolution.game).toEqual({
      kind: "invalid",
      requested: "starcraft",
      reason: "unknown"
    });
    expect(read(serverRender({ pageClass: "multi", initial: lol }, "/x?discipline=all")).resolution.game).toEqual({
      kind: "game",
      code: "lol",
      source: "scope"
    });
  });

  it("gives a single page under all games its tabs and the visitor's last game", () => {
    const { resolution } = read(serverRender({ pageClass: "single", initial: init({ lastGame: "lol" }) }));
    expect(resolution).toEqual({
      game: { kind: "game", code: "lol", source: "last" },
      pill: { kind: "all" },
      tabs: true,
      scope: "all"
    });
  });

  it("keeps the tenant host's workspace above an axis override", () => {
    expect(read(serverRender({ initial: init({ axis: 7, hostLockedWorkspaceId: 7 }), axis: "all" })).axis).toBe(7);
    expect(read(serverRender({ initial: init({ axis: 3 }), axis: "all" })).axis).toBe("all");
  });

  it("narrows the candidates with the page's filter", () => {
    const { resolution } = read(
      serverRender({
        pageClass: "platform",
        initial: init({ lastGame: "lol" }),
        filter: (games) => games.filter((game) => game.capabilities.native_rank_collection)
      })
    );
    expect(resolution.game).toEqual({ kind: "game", code: "overwatch", source: "default" });
    expect(resolution.tabs).toBe(false);
  });
});

describe("hydration", () => {
  it("agrees with the server render when the client store already holds the same cookies", async () => {
    const options: Options = { pageClass: "single", initial: init({ stored: "lol", lastGame: "overwatch" }) };
    const html = serverRender(options);
    navigation.reset("/x");
    useWorkspaceStore.setState({ gameScope: "lol", lastGame: "overwatch" });

    const container = document.body.appendChild(document.createElement("div"));
    container.innerHTML = html;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      hydrateRoot(
        container,
        <QueryClientProvider client={client()}>
          <Probe options={options} />
        </QueryClientProvider>
      );
    });

    expect(errors.mock.calls.filter((call) => String(call[0]).toLowerCase().includes("hydrat"))).toEqual([]);
    errors.mockRestore();
  });
});

describe("picks", () => {
  it("a scope pick saves the scope and the last game and pushes the URL without the page or the dropped filters", async () => {
    navigation.reset("/tournaments?page=3&role=tank&q=x");
    await mount({ pageClass: "multi" });

    await act(async () => latest.selectScope("lol", { dropParams: ["role"] }));
    expect(useWorkspaceStore.getState()).toMatchObject({ gameScope: "lol", lastGame: "lol" });
    expect(document.cookie).toContain("owt-discipline=lol");
    expect(document.cookie).toContain("owt-last-game=lol");
    expect(navigation.pushes).toEqual(["/tournaments?q=x&discipline=lol"]);

    await act(async () => latest.selectScope("all"));
    expect(useWorkspaceStore.getState()).toMatchObject({ gameScope: "all", lastGame: "lol" });
    expect(document.cookie).not.toContain("owt-discipline=");
    expect(navigation.pushes.at(-1)).toBe("/tournaments?q=x");
    expect(latest.resolution?.game).toEqual({ kind: "all" });
  });

  it("a tab pick remembers the game and narrows only this page; a block tab leaves the URL alone", async () => {
    navigation.reset("/users/compare?page=2");
    await mount({ pageClass: "single" });

    await act(async () => latest.selectTab("lol"));
    expect(useWorkspaceStore.getState()).toMatchObject({ lastGame: "lol", gameScope: "all" });
    expect(document.cookie).not.toContain("owt-discipline=");
    expect(navigation.pushes).toEqual(["/users/compare?discipline=lol"]);
    expect(latest.resolution?.game).toEqual({ kind: "game", code: "lol", source: "url" });

    await act(async () => latest.selectTab("overwatch", { url: false }));
    expect(useWorkspaceStore.getState().lastGame).toBe("overwatch");
    expect(navigation.pushes).toHaveLength(1);
  });

  it("landing never rewrites the URL", async () => {
    useWorkspaceStore.setState({ gameScope: "lol" });
    navigation.reset("/users/compare");
    await mount({ pageClass: "single" });

    expect(latest.game).toBe("lol");
    expect(navigation.replaces).toEqual([]);
    expect(navigation.pushes).toEqual([]);
  });

  it("an owner page reads its owner's game, and a pending owner reads none", async () => {
    await mount({ pageClass: "owner", ownerGame: "lol" });
    expect(latest.game).toBe("lol");
    expect(latest.resolution?.pill).toEqual({ kind: "game", code: "lol", locked: true });

    await mount({ pageClass: "owner", ownerGame: "lol", ownerPending: true });
    expect(latest.resolution?.game).toEqual({ kind: "empty" });
  });
});
