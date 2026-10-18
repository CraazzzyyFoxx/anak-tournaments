// @vitest-environment happy-dom
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBrowsingDiscipline } from "@/hooks/useBrowsingDiscipline";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import type { BrowsingDisciplineInit } from "@/lib/site/discipline-scope";
import { navigation } from "@/test/url-navigation";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { DisciplineDescriptor } from "@/types/discipline.types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ list: vi.fn(), metadata: vi.fn() }));

vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
vi.mock("@/services/discipline.service", () => ({ default: { list: mocks.list, metadata: mocks.metadata } }));

const GAMES = [
  { code: "overwatch", name: "Overwatch", enabled: true },
  { code: "lol", name: "League of Legends", enabled: true },
] as DisciplineDescriptor[];

function init(overrides: Partial<BrowsingDisciplineInit> = {}): BrowsingDisciplineInit {
  return { stored: null, axis: "all", hostLockedWorkspaceId: null, disciplines: GAMES, ...overrides };
}

function Probe({ allowsAll = false, initial }: Readonly<{ allowsAll?: boolean; initial: BrowsingDisciplineInit }>) {
  const { axis, resolved } = useBrowsingDiscipline({ allowsAll, initial });
  return <output>{JSON.stringify({ axis, resolved })}</output>;
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** What the server renders for one request: its store never saw the visitor's cookies, only `initial` did. */
function serverRender(initial: BrowsingDisciplineInit, allowsAll = false, url = "/x") {
  navigation.reset(url);
  useWorkspaceStore.setState({ browsingDiscipline: null, hostLockedWorkspaceId: null, currentWorkspaceId: null, statsScope: "all" });
  return renderToString(
    <QueryClientProvider client={client()}>
      <Probe initial={initial} allowsAll={allowsAll} />
    </QueryClientProvider>
  );
}

const read = (html: string) => JSON.parse(new DOMParser().parseFromString(html, "text/html").querySelector("output")?.textContent ?? "null");

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue(GAMES);
  mocks.metadata.mockReset().mockImplementation(async (axis: unknown, code: string) => ({ axis, code }));
  document.body.innerHTML = "";
});

afterEach(() => {
  useWorkspaceStore.setState({ browsingDiscipline: null });
});

describe("server render of the browsing discipline", () => {
  it("follows the visitor's cookie, not the server store, so two visitors resolve differently", () => {
    expect(read(serverRender(init({ stored: "lol" }))).resolved).toEqual({ kind: "concrete", code: "lol", source: "stored" });
    expect(read(serverRender(init({ stored: null }))).resolved).toEqual({ kind: "concrete", code: "overwatch", source: "default" });
    expect(read(serverRender(init({ stored: "dota" }))).resolved).toEqual({ kind: "concrete", code: "overwatch", source: "default" });
  });

  it("lets the URL outrank the cookie and keeps an invalid URL value as an error", () => {
    expect(read(serverRender(init({ stored: "lol" }), false, "/x?discipline=overwatch")).resolved).toEqual({
      kind: "concrete",
      code: "overwatch",
      source: "url"
    });
    expect(read(serverRender(init({ stored: "lol" }), false, "/x?discipline=starcraft")).resolved).toEqual({
      kind: "invalid",
      requested: "starcraft",
      reason: "unknown"
    });
  });

  it("resolves a directory to all unless the visitor saved a game", () => {
    expect(read(serverRender(init(), true)).resolved).toEqual({ kind: "all" });
    expect(read(serverRender(init({ stored: "lol" }), true)).resolved).toEqual({ kind: "concrete", code: "lol", source: "stored" });
    expect(read(serverRender(init({ stored: "all" }), true)).resolved).toEqual({ kind: "all" });
  });

  it("reads a tenant host's own workspace axis even though the client store is not locked yet", () => {
    const html = serverRender(init({ axis: 7, hostLockedWorkspaceId: 7 }));
    expect(read(html).axis).toBe(7);
    expect(read(serverRender(init({ axis: "all" }))).axis).toBe("all");
  });

  it("is empty, not defaulted, when the server saw no enabled game", () => {
    const html = serverRender(init({ disciplines: [{ ...GAMES[0]!, enabled: false }] }));
    expect(read(html).resolved).toEqual({ kind: "empty" });
  });
});

describe("hydration", () => {
  it("agrees with the server render when the client store already holds the cookie", async () => {
    const initial = init({ stored: "lol" });
    const html = serverRender(initial);
    navigation.reset("/x");
    // On the client the store is hydrated from the same cookie at creation.
    useWorkspaceStore.setState({ browsingDiscipline: "lol" });

    const container = document.body.appendChild(document.createElement("div"));
    container.innerHTML = html;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      hydrateRoot(
        container,
        <QueryClientProvider client={client()}>
          <Probe initial={initial} />
        </QueryClientProvider>
      );
    });

    expect(errors.mock.calls.filter((call) => String(call[0]).toLowerCase().includes("hydrat"))).toEqual([]);
    errors.mockRestore();
  });
});

describe("an opened owner's metadata", () => {
  function Owner({ workspaceId, code }: Readonly<{ workspaceId: number; code: string }>) {
    const query = useDisciplineMetadata(workspaceId, code);
    return <output>{JSON.stringify(query.data ?? null)}</output>;
  }

  async function mountOwner(workspaceId: number, code: string, queryClient: QueryClient) {
    const container = document.body.appendChild(document.createElement("div"));
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Owner workspaceId={workspaceId} code={code} />
        </QueryClientProvider>
      )
    );
    await act(() => new Promise<void>((done) => setTimeout(done, 0)));
    return { container, root };
  }

  it("is read for the owner's workspace and game whatever the visitor browses, and never touches the preference", async () => {
    useWorkspaceStore.setState({ browsingDiscipline: "lol", statsScope: "all", currentWorkspaceId: 3 });
    const { container } = await mountOwner(7, "overwatch", client());

    expect(mocks.metadata).toHaveBeenCalledWith(7, "overwatch", expect.anything());
    expect(container.textContent).toBe(JSON.stringify({ axis: 7, code: "overwatch" }));
    expect(useWorkspaceStore.getState().browsingDiscipline).toBe("lol");
  });

  it("keeps each workspace's metadata in its own cache entry, so a switch cannot show the other's", async () => {
    const queryClient = client();
    const first = await mountOwner(7, "overwatch", queryClient);
    const second = await mountOwner(8, "overwatch", queryClient);

    expect(first.container.textContent).toBe(JSON.stringify({ axis: 7, code: "overwatch" }));
    expect(second.container.textContent).toBe(JSON.stringify({ axis: 8, code: "overwatch" }));
    expect(mocks.metadata).toHaveBeenCalledTimes(2);
  });
});
