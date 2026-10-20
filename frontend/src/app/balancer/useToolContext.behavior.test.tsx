// @vitest-environment happy-dom
//
// The balancer layout resolves its tournament from `?tournament=` on every balancer route, and on a tool
// route that tournament is the opened owner (its community and game). A pickup mix is its own owner: a
// `?tournament=` carried onto a mix route must not take the mix's community or game away once the
// tournament's reads land.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useEntityWorkspace } from "@/hooks/useEntityWorkspace";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { navigation } from "@/test/url-navigation";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
vi.mock("@/services/balancer-admin.service", () => ({
  default: { getTournamentSummary: async (id: number) => ({ id, workspace_id: 2 }) }
}));
vi.mock("@/services/tournament.service", () => ({
  default: { getPublicOverview: async (ref: number) => ({ id: ref, workspace_id: 2, discipline: "overwatch" }) }
}));

import { useToolContext } from "./useToolContext";

function BalancerLayout({ children }: Readonly<{ children?: ReactNode }>) {
  useToolContext();
  return children;
}

function MixDetail() {
  useEntityWorkspace(3, "lol");
  return null;
}

const roots: Root[] = [];

async function mount(url: string, page?: ReactNode) {
  navigation.reset(url);
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <BalancerLayout>{page}</BalancerLayout>
      </QueryClientProvider>
    )
  );
  // Let the tournament reads resolve and their results reach the store.
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = "";
  useWorkspaceStore.setState({ entityWorkspaceId: null, entityDiscipline: null });
});

describe("the balancer tool's opened owner", () => {
  it("is the tournament on a tool route", async () => {
    await mount("/balancer?tournament=9");

    expect(useWorkspaceStore.getState()).toMatchObject({ entityWorkspaceId: 2, entityDiscipline: "overwatch" });
  });

  it("stays the mix on a mix route that still carries ?tournament=, after the tournament's reads resolve", async () => {
    await mount("/balancer/mix/5?tournament=9", <MixDetail />);

    expect(useWorkspaceStore.getState()).toMatchObject({ entityWorkspaceId: 3, entityDiscipline: "lol" });
  });
});
