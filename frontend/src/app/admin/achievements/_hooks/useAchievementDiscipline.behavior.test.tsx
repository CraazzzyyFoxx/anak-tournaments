// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { navigation } from "@/test/url-navigation";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { DisciplineDescriptor } from "@/types/discipline.types";
import type { Workspace } from "@/types/workspace.types";

import { useAchievementDiscipline } from "./useAchievementDiscipline";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
vi.mock("@/services/discipline.service", () => ({ default: { list: mocks.list } }));

function descriptor(code: string, enabled = true): DisciplineDescriptor {
  return { code, name: code.toUpperCase(), enabled } as DisciplineDescriptor;
}

function workspace(id: number): Workspace {
  const enabled = id === 8 ? ["overwatch"] : ["overwatch", "lol"];
  return { id, slug: `w${id}`, name: `w${id}`, disciplines_enabled: enabled } as Workspace;
}

type Selection = ReturnType<typeof useAchievementDiscipline>;
let latest: Selection;

function Probe() {
  const selection = useAchievementDiscipline();
  useEffect(() => {
    latest = selection;
  });
  return null;
}

const roots: Root[] = [];

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    )
  );
  await act(() => new Promise<void>((done) => setTimeout(done, 0)));
}

afterEach(async () => {
  // A tree left mounted would keep canonicalizing the shared URL under the next test.
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
});

beforeEach(() => {
  document.body.innerHTML = "";
  document.cookie = "owt-discipline=; Max-Age=0; path=/";
  navigation.reset("/admin/achievements");
  mocks.list.mockReset().mockImplementation(async (axis: number | "all") =>
    axis === 8 ? [descriptor("overwatch"), descriptor("lol", false)] : [descriptor("overwatch"), descriptor("lol")]
  );
  useWorkspaceStore.setState({
    workspaces: [workspace(7), workspace(8)],
    currentWorkspaceId: 7,
    statsScope: "workspace",
    hostLockedWorkspaceId: null,
    browsingDiscipline: null
  });
});

describe("the selected achievement game", () => {
  it("reads the page's own workspace's games and starts on the first enabled one, in the URL by replace", async () => {
    await mount();

    expect(mocks.list).toHaveBeenCalledWith(7, expect.anything());
    expect(latest.discipline).toBe("overwatch");
    expect(latest.resolved).toEqual({ kind: "concrete", code: "overwatch", source: "url" });
    expect(navigation.replaces).toEqual(["/admin/achievements?discipline=overwatch"]);
    expect(navigation.pushes).toEqual([]);
  });

  it("lets a valid explicit URL win over the saved choice without rewriting the saved choice", async () => {
    useWorkspaceStore.setState({ browsingDiscipline: "overwatch" });
    navigation.reset("/admin/achievements?discipline=lol");
    await mount();

    expect(latest.resolved).toEqual({ kind: "concrete", code: "lol", source: "url" });
    expect(useWorkspaceStore.getState().browsingDiscipline).toBe("overwatch");
    expect(navigation.replaces).toEqual([]);
  });

  it("keeps an unusable explicit value as an error and picks no other game", async () => {
    navigation.reset("/admin/achievements?discipline=starcraft");
    await mount();

    expect(latest.discipline).toBeNull();
    expect(latest.resolved).toEqual({ kind: "invalid", requested: "starcraft", reason: "unknown" });
    expect(navigation.replaces).toEqual([]);
    expect(navigation.current()).toBe("/admin/achievements?discipline=starcraft");
  });

  it("treats a disabled game as the error 'disabled', not as a silent switch to another game", async () => {
    useWorkspaceStore.setState({ currentWorkspaceId: 8 });
    navigation.reset("/admin/achievements?discipline=lol");
    await mount();

    expect(latest.resolved).toEqual({ kind: "invalid", requested: "lol", reason: "disabled" });
  });

  it("a pick is saved as the preference and pushed as one history entry that Back undoes", async () => {
    await mount();
    await act(async () => latest.select("lol"));

    expect(latest.discipline).toBe("lol");
    expect(useWorkspaceStore.getState().browsingDiscipline).toBe("lol");
    expect(navigation.pushes).toEqual(["/admin/achievements?discipline=lol"]);
    expect(document.cookie).toContain("owt-discipline=lol");

    await act(async () => navigation.back());
    expect(latest.discipline).toBe("overwatch");
    // Back restored the URL's own choice; the stale cookie never overwrites it.
    expect(navigation.current()).toBe("/admin/achievements?discipline=overwatch");
  });

  it("resolves a saved choice from the preference and drops one the workspace does not enable", async () => {
    useWorkspaceStore.setState({ browsingDiscipline: "lol" });
    await mount();
    // Once the URL carries it (replace, not a new entry) the same choice reads as the URL's.
    expect(latest.resolved).toEqual({ kind: "concrete", code: "lol", source: "url" });
    expect(navigation.replaces).toEqual(["/admin/achievements?discipline=lol"]);

    await act(async () => useWorkspaceStore.getState().setCurrentWorkspace(8));
    expect(useWorkspaceStore.getState().browsingDiscipline).toBeNull();
  });

  it("is empty, with no game to work on, when nothing is enabled", async () => {
    mocks.list.mockResolvedValue([descriptor("overwatch", false)]);
    await mount();

    expect(latest.resolved).toEqual({ kind: "empty" });
    expect(latest.discipline).toBeNull();
  });
});
