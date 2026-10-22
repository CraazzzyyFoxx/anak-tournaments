// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import workspaceService from "@/services/workspace.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { DivisionGridVersion, Workspace, WorkspaceListItem } from "@/types/workspace.types";

import { useDivisionGrid } from "./useCurrentWorkspace";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ladder: DivisionGridVersion = {
  id: 5,
  grid_id: 5,
  version: 1,
  label: "OW",
  status: "published",
  created_from_version_id: null,
  published_at: null,
  tiers: [
    { id: 50, slug: "gold", number: 3, name: "Gold", sort_order: 0, rank_min: 2000, rank_max: null, icon_url: "/gold.png" }
  ]
};
// A list row: what `GET /workspaces` sends, with no grids at all.
const row = { id: 4, slug: "ws", name: "WS", disciplines_enabled: ["overwatch"] } as WorkspaceListItem;
const read = { ...row, effective_division_grid_versions: { overwatch: ladder } } as Workspace;

const initialStore = useWorkspaceStore.getState();
let root: Root;

function Tiers() {
  return <p>{useDivisionGrid().tiers.map((tier) => tier.name).join(",") || "none"}</p>;
}

beforeEach(() => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  useWorkspaceStore.setState({ workspaces: [row], currentWorkspaceId: 4, entityWorkspaceId: null, hostLockedWorkspaceId: null });
});

afterEach(async () => {
  await act(async () => root.unmount());
  useWorkspaceStore.setState(initialStore, true);
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("useDivisionGrid", () => {
  it("resolves through the current workspace's own read, since list rows carry no grids", async () => {
    const getById = vi.spyOn(workspaceService, "getById").mockResolvedValue(read);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Tiers />
        </QueryClientProvider>
      );
    });
    // The mounted read resolves, then react-query notifies on its own scheduled tick.
    await act(async () => {
      for (let tick = 0; tick < 2; tick++) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 0);
        await promise;
      }
    });

    expect(getById).toHaveBeenCalledWith(4);
    expect(document.body.textContent).toBe("Gold");
  });
});
