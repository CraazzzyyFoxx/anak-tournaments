/** @vitest-environment happy-dom */
import Cookies from "js-cookie";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthProfile } from "@/stores/auth-profile.store";
import {
  filterAccessibleWorkspaces,
  resolveCurrentWorkspaceId,
  useWorkspaceStore
} from "@/stores/workspace.store";
import type { Workspace } from "@/types/workspace.types";

function createWorkspace(id: number, name = `Workspace ${id}`): Workspace {
  return {
    id,
    slug: `workspace-${id}`,
    name,
    description: null,
    icon_url: null,
    is_active: true,
    disciplines_enabled: ["overwatch"],
    default_division_grid_versions: {},
    effective_division_grid_versions: {}
  };
}

function createProfile(workspaceIds: number[]): AuthProfile {
  return {
    username: "tester",
    avatarUrl: null,
    roles: [],
    permissions: [],
    isSuperuser: false,
    linkedPlayers: [],
    workspaces: workspaceIds.map((workspaceId) => ({
      workspace_id: workspaceId,
      slug: `workspace-${workspaceId}`,
      roles: [],
      permissions: []
    }))
  };
}

describe("workspace store helpers", () => {
  it("filters workspaces to memberships for authenticated non-superusers", () => {
    const allWorkspaces = [createWorkspace(1), createWorkspace(2), createWorkspace(3)];
    const filtered = filterAccessibleWorkspaces(
      allWorkspaces,
      "authenticated",
      createProfile([1, 3])
    );

    expect(filtered.map((workspace) => workspace.id)).toEqual([1, 3]);
  });

  it("keeps all workspaces for anonymous users", () => {
    const allWorkspaces = [createWorkspace(1), createWorkspace(2)];

    expect(filterAccessibleWorkspaces(allWorkspaces, "anonymous")).toEqual(allWorkspaces);
  });

  it("replaces an inaccessible persisted workspace with the first accessible one", () => {
    const accessible = [createWorkspace(5), createWorkspace(8)];

    expect(resolveCurrentWorkspaceId(accessible, 99)).toBe(5);
  });
});

describe("workspace store host lock (tenant white-label)", () => {
  it("setHostLock forces the current workspace and blocks switching", () => {
    // Start clean.
    useWorkspaceStore.getState().setHostLock(null);
    useWorkspaceStore.setState({ currentWorkspaceId: 2 });

    // Locking a tenant host overrides the current (cookie-derived) workspace.
    useWorkspaceStore.getState().setHostLock(7);
    expect(useWorkspaceStore.getState().hostLockedWorkspaceId).toBe(7);
    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe(7);

    // While locked, switching is ignored (guard returns before any cookie write).
    useWorkspaceStore.getState().setCurrentWorkspace(9);
    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe(7);

    // Clearing the lock (apex) drops the lock flag.
    useWorkspaceStore.getState().setHostLock(null);
    expect(useWorkspaceStore.getState().hostLockedWorkspaceId).toBeNull();
  });
});

describe("viewing scope and opened entity", () => {
  it("keeps the opened entity local without overwriting the saved viewing filter", () => {
    const initial = useWorkspaceStore.getState();
    try {
      initial.setHostLock(null);
      initial.setCurrentWorkspace(4);
      initial.setStatsScope("workspace");
      initial.setEntityWorkspace(7);

      expect(useWorkspaceStore.getState().currentWorkspaceId).toBe(4);
      expect(document.cookie).toContain("owt-workspace-id=4");

      initial.setStatsScope("all");
      expect(useWorkspaceStore.getState().entityWorkspaceId).toBe(7);
      expect(useWorkspaceStore.getState().currentWorkspaceId).toBe(4);
      expect(document.cookie).toContain("owt-stats-scope=all");

      initial.setHostLock(9);
      initial.setStatsScope("all");
      expect(useWorkspaceStore.getState().statsScope).toBe("workspace");
      expect(useWorkspaceStore.getState().currentWorkspaceId).toBe(9);
    } finally {
      useWorkspaceStore.setState(initial);
      document.cookie = "owt-workspace-id=; Max-Age=0; path=/";
      document.cookie = "owt-stats-scope=; Max-Age=0; path=/";
    }
  });
});

// The workspace id has ONE persisted home now (the cookie the server also
// reads); the store is a runtime cache hydrated from it at module load. This
// covers the way that hydration can silently regress: reading the wrong cookie
// after the aqt->owt rename, which would make the client scope disagree with
// the server's (`getServerWorkspaceId` reads the same two names).
describe("workspace store cookie hydration", () => {
  // `Cookies.remove` writes an already-expired cookie; happy-dom keeps a `Max-Age=0` write as an
  // empty cookie until the clock ticks, which would leak into the next test's cookie string.
  afterEach(() => {
    Cookies.remove("owt-workspace-id");
    Cookies.remove("aqt-workspace-id");
  });

  // Dynamic on purpose: hydration happens at module evaluation, so each case
  // needs a fresh instance of the module under a different cookie.
  async function freshStore() {
    vi.resetModules();
    return (await import("@/stores/workspace.store")).useWorkspaceStore;
  }

  it("hydrates the active workspace from the canonical cookie", async () => {
    document.cookie = "owt-workspace-id=4; path=/";

    const store = await freshStore();

    expect(store.getState().currentWorkspaceId).toBe(4);
  });

  it("falls back to the legacy cookie during the aqt->owt rename", async () => {
    document.cookie = "aqt-workspace-id=9; path=/";

    const store = await freshStore();

    expect(store.getState().currentWorkspaceId).toBe(9);
  });

  it("stays null when no workspace cookie is set", async () => {
    const store = await freshStore();

    expect(store.getState().currentWorkspaceId).toBeNull();
  });
});

describe("game scope", () => {
  const withWorkspaces = (disciplines: string[][]) =>
    disciplines.map((enabled, index) => ({ ...createWorkspace(index + 1), disciplines_enabled: enabled }));

  afterEach(() => {
    for (const name of ["owt-discipline", "owt-last-game", "owt-workspace-id", "owt-stats-scope"]) {
      Cookies.remove(name);
    }
    useWorkspaceStore.setState({
      workspaces: [],
      currentWorkspaceId: null,
      statsScope: "all",
      gameScope: "all",
      lastGame: null,
      entityWorkspaceId: null,
      entityDiscipline: null,
      hostLockedWorkspaceId: null
    });
  });

  it("saves a game in its own cookie and forgets it for all games", () => {
    useWorkspaceStore.getState().setGameScope("lol");
    expect(document.cookie).toContain("owt-discipline=lol");
    expect(useWorkspaceStore.getState().gameScope).toBe("lol");

    useWorkspaceStore.getState().setGameScope("all");
    expect(document.cookie).not.toContain("owt-discipline=");
    expect(useWorkspaceStore.getState().gameScope).toBe("all");
    expect(document.cookie).not.toContain("owt-workspace-id");
  });

  it("remembers the last picked game in its own cookie, apart from the scope", () => {
    useWorkspaceStore.getState().setLastGame("lol");
    expect(document.cookie).toContain("owt-last-game=lol");
    expect(useWorkspaceStore.getState()).toMatchObject({ lastGame: "lol", gameScope: "all" });
    expect(document.cookie).not.toContain("owt-discipline=");
  });

  it("never drops the saved game on a community pick, a scope change or a host lock", () => {
    useWorkspaceStore.setState({
      workspaces: withWorkspaces([["overwatch", "lol"], ["overwatch"]]),
      currentWorkspaceId: 1,
      statsScope: "workspace"
    });
    useWorkspaceStore.getState().setGameScope("lol");

    useWorkspaceStore.getState().setCurrentWorkspace(2);
    useWorkspaceStore.getState().setStatsScope("all");
    useWorkspaceStore.getState().setStatsScope("workspace");
    expect(useWorkspaceStore.getState().gameScope).toBe("lol");
    expect(document.cookie).toContain("owt-discipline=lol");

    useWorkspaceStore.getState().setHostLock(2);
    expect(useWorkspaceStore.getState().gameScope).toBe("lol");
    expect(document.cookie).toContain("owt-discipline=lol");
  });

  it("holds an opened owner's game at runtime only, never in the scope or a cookie", () => {
    useWorkspaceStore.getState().setEntityDiscipline("lol");
    expect(useWorkspaceStore.getState()).toMatchObject({ entityDiscipline: "lol", gameScope: "all", lastGame: null });
    expect(document.cookie).not.toContain("owt-discipline=");
    expect(document.cookie).not.toContain("owt-last-game=");

    useWorkspaceStore.getState().setEntityDiscipline(null);
    expect(useWorkspaceStore.getState().entityDiscipline).toBeNull();
  });
});

describe("game scope hydration", () => {
  afterEach(() => {
    Cookies.remove("owt-discipline");
    Cookies.remove("owt-last-game");
  });

  it("hydrates the scope and the last game from their cookies; without them, all games and no last game", async () => {
    vi.resetModules();
    expect((await import("@/stores/workspace.store")).useWorkspaceStore.getState()).toMatchObject({
      gameScope: "all",
      lastGame: null,
      entityDiscipline: null
    });

    document.cookie = "owt-discipline=lol; path=/";
    document.cookie = "owt-last-game=overwatch; path=/";
    vi.resetModules();
    expect((await import("@/stores/workspace.store")).useWorkspaceStore.getState()).toMatchObject({
      gameScope: "lol",
      lastGame: "overwatch"
    });
  });
});
