// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { type InfiniteData, QueryClient, QueryClientProvider, skipToken, useInfiniteQuery } from "@tanstack/react-query";
import Cookies from "js-cookie";
import { afterEach, expect, it, vi } from "vitest";
import WorkspaceBootstrap from "./WorkspaceBootstrap";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { STATS_SCOPE_COOKIE } from "@/lib/site/stats-scope";
import { disciplineQueryKeys } from "@/lib/site/discipline-query-keys";
import workspaceService from "@/services/workspace.service";
import type { Workspace } from "@/types/workspace.types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() })
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let client: QueryClient;
const initialState = useWorkspaceStore.getState();
type Page = { names: string[] };
const entityKey = ["tournament-roster", 7];
const listKey = ["tournaments", "all"];

function OpenEntityRows() {
  const { data } = useInfiniteQuery<Page>({
    queryKey: entityKey,
    queryFn: skipToken,
    initialPageParam: 1,
    getNextPageParam: () => undefined
  });
  return <output data-testid="entity-rows">{data?.pages.flatMap((page) => page.names).join(",")}</output>;
}

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  document.body.replaceChildren();
  useWorkspaceStore.setState(initialState);
  Cookies.remove(STATS_SCOPE_COOKIE);
  vi.restoreAllMocks();
});

it("restarts a cached global list without truncating the opened entity's visible rows", () => {
  useWorkspaceStore.setState({
    currentWorkspaceId: 1,
    hostLockedWorkspaceId: null,
    statsScope: "workspace",
    entityWorkspaceId: 7,
    fetchWorkspaces: async () => undefined
  });
  client = new QueryClient();
  client.setQueryData<InfiniteData<Page>>(entityKey, {
    pages: [{ names: ["owner-first"] }, { names: ["owner-next"] }], pageParams: [1, 2]
  });
  client.setQueryData<InfiniteData<Page>>(listKey, {
    pages: [{ names: ["global-first"] }, { names: ["global-next"] }], pageParams: [1, 2]
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(
    <QueryClientProvider client={client}>
      <WorkspaceBootstrap />
      <OpenEntityRows />
    </QueryClientProvider>
  ));

  act(() => useWorkspaceStore.getState().setStatsScope("all"));

  expect(client.getQueryData<InfiniteData<Page>>(listKey)?.pages.flatMap((page) => page.names)).toEqual(["global-first"]);
  expect(document.querySelector("[data-testid='entity-rows']")?.textContent).toBe("owner-first,owner-next");
});

it("drops a workspace's cached installed games once its refreshed record changes the enabled set", async () => {
  const records = (lolInFirst: boolean) =>
    [
      { id: 1, disciplines_enabled: lolInFirst ? ["overwatch", "lol"] : ["overwatch"] },
      { id: 2, disciplines_enabled: ["overwatch"] }
    ] as Workspace[];
  const getAll = vi.spyOn(workspaceService, "getAll").mockResolvedValue(records(true));
  useWorkspaceStore.setState({
    currentWorkspaceId: 1,
    hostLockedWorkspaceId: null,
    statsScope: "workspace",
    gameScope: "lol"
  });
  client = new QueryClient();
  for (const axis of [1, 2, "all"] as const) {
    client.setQueryData(disciplineQueryKeys.list(axis), [{ code: "overwatch", enabled: true }]);
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <WorkspaceBootstrap />
      </QueryClientProvider>
    )
  );
  const invalidated = (axis: number | "all") => client.getQueryState(disciplineQueryKeys.list(axis))?.isInvalidated;
  expect([invalidated(1), invalidated(2), invalidated("all")]).toEqual([false, false, false]);

  // A settings save (or any other refresh) re-reads the records: workspace 1 no longer runs LoL.
  getAll.mockResolvedValue(records(false));
  await act(async () => useWorkspaceStore.getState().fetchWorkspaces());

  expect(invalidated(1)).toBe(true);
  expect(invalidated("all")).toBe(true);
  expect(invalidated(2)).toBe(false);
  // The saved game is never dropped: the resolver reads it as all games where it is not played (spec §4.2).
  expect(useWorkspaceStore.getState().gameScope).toBe("lol");
});
