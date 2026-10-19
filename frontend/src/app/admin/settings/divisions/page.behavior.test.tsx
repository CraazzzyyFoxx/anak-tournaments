// @vitest-environment happy-dom
//
// Settings › Divisions — the overview that replaced the 1045-line
// /admin/divisions screen and its four always-mounted cards. What is pinned:
//
//  1. the `division_grid.read` gate is the PAGE's. Hiding a rail link is not
//     access control: the URL typed into the address bar has to be refused,
//     and nothing may be asked of the API before it is allowed;
//  2. the version list's pills come from the two facts that decide them — the
//     stored status and the workspace's default version pointer — so a
//     published version the workspace points at reads "In force", which is not
//     a status the backend has; published and archived rows carry no pill;
//  3. the grid selector only appears when the workspace really has more than
//     one grid, and it writes `?grid=`;
//  4. "Load standard OW ladder" — the scenario carried over from
//     standardOwGrid.behavior.test.tsx, now asserted where the button actually
//     lives. A tier with a `null` OW endpoint is skipped by
//     `resolve_division_from_native_rank`, and an `id` on any tier would make the
//     save rewrite a version in place instead of creating one.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DisciplineMetadata } from "@/types/discipline.types";
import type { DivisionGridEntity, DivisionGridVersion } from "@/types/workspace.types";
import { TEST_LADDER_TIERS } from "./editor/__fixtures__/test-ladder";
import DivisionsSettingsPage from "./page";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getDivisionGrids = vi.fn();
const getDivisionGridVersions = vi.fn();
const getDivisionGridVersionReadiness = vi.fn();
const createDivisionGridVersion = vi.fn();
const cloneDivisionGridVersion = vi.fn();
const activateDivisionGridVersion = vi.fn();
const importDivisionGridPortable = vi.fn();
const fetchWorkspaces = vi.fn();

let permitted = true;

vi.mock("@/lib/datetime/client", () => ({
  useFormatter: () => ({ dateTime: (value: Date) => value.toISOString().slice(0, 10) })
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    canAccessPermission: () => permitted,
    hasPermission: () => permitted,
    isSuperuser: false,
    isLoaded: true
  })
}));

let currentWorkspace: Record<string, unknown>;

vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (
    selector: (state: {
      currentWorkspaceId: number;
      getCurrentWorkspace: () => unknown;
      fetchWorkspaces: () => Promise<void>;
    }) => unknown
  ) =>
    selector({
      currentWorkspaceId: 1,
      getCurrentWorkspace: () => currentWorkspace,
      fetchWorkspaces
    })
}));

vi.mock("@/services/workspace.service", () => ({
  default: {
    getDivisionGrids: (...args: unknown[]) => getDivisionGrids(...args),
    getDivisionGridVersions: (...args: unknown[]) => getDivisionGridVersions(...args),
    getDivisionGridVersionReadiness: (...args: unknown[]) =>
      getDivisionGridVersionReadiness(...args),
    createDivisionGridVersion: (...args: unknown[]) => createDivisionGridVersion(...args),
    cloneDivisionGridVersion: (...args: unknown[]) => cloneDivisionGridVersion(...args),
    activateDivisionGridVersion: (...args: unknown[]) => activateDivisionGridVersion(...args),
    exportDivisionGridPortable: vi.fn(),
    importDivisionGridPortable: (...args: unknown[]) => importDivisionGridPortable(...args)
  }
}));

vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn(), warning: vi.fn() }
}));

const replace = vi.fn((url: string) => {
  window.history.replaceState(null, "", url);
  rerender?.();
});
let rerender: (() => void) | null = null;

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/settings/divisions",
  useRouter: () => ({ replace, push: replace }),
  useSearchParams: () => new URLSearchParams(window.location.search)
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  )
}));

// The game picker lives in the settings shell's header slot; with no shell mounted here, render the
// slot's content in place so the picker stays reachable.
vi.mock("@/components/admin/workspace-settings/WorkspaceSettingsShell", () => ({
  SettingsHeaderActions: ({ children }: { children: ReactNode }) => <>{children}</>
}));

// The page reads its game from the shared browsing resolver and that game's native metadata; both are
// driven by the URL here (`?discipline=`), exactly as the real hooks resolve an explicit choice.
const INSTALLED = [
  { code: "overwatch", name: "Overwatch", enabled: true },
  { code: "lol", name: "League of Legends", enabled: true }
];

// The real resolver (owner > URL > preference) over the URL; the preference is Overwatch.
const selectGame = vi.fn();
vi.mock("@/hooks/useBrowsingDiscipline", async () => {
  const { resolveDiscipline } = await vi.importActual<typeof import("@/lib/site/discipline-scope")>(
    "@/lib/site/discipline-scope"
  );
  return {
    useBrowsingDiscipline: (options: { ownerDiscipline?: string | null }) => ({
      axis: 1,
      disciplines: INSTALLED,
      resolved: resolveDiscipline({
        ownerDiscipline: options.ownerDiscipline ?? null,
        explicitDiscipline: new URLSearchParams(window.location.search).get("discipline"),
        storedDiscipline: "overwatch",
        disciplines: INSTALLED,
        allowsAll: false
      }),
      isError: false,
      refetch: vi.fn(),
      select: selectGame
    })
  };
});

function metadataFor(code: string): DisciplineMetadata {
  const native = code === "overwatch";
  return {
    discipline: {
      code,
      name: code,
      enabled: true,
      kinds: {},
      character_classes: [],
      identity_provider: null,
      capabilities: {
        catalog_sync: false,
        native_rank_collection: native,
        native_ladder: native,
        achievement_conditions: false,
        analytics: false
      }
    },
    workspace_id: 1,
    dimensions: [],
    roles: [],
    stat_defs: [],
    event_types: [],
    team_format_presets: [],
    native_ladder: native ? TEST_LADDER_TIERS : []
  } as unknown as DisciplineMetadata;
}

vi.mock("@/hooks/useDisciplineMetadata", () => ({
  useDisciplineMetadata: (_axis: unknown, code: string | null) => ({
    data: code ? metadataFor(code) : undefined,
    isError: false,
    refetch: vi.fn()
  })
}));

function tier(number: number) {
  return {
    id: 500 + number,
    slug: `division-${number}`,
    number,
    name: `Division ${number}`,
    rank_min: 5000 - number * 100,
    rank_max: number === 1 ? null : 5099 - number * 100,
    sort_order: number - 1,
    icon_url: "https://cdn/x.png"
  };
}

function version(
  id: number,
  number: number,
  status: DivisionGridVersion["status"]
): DivisionGridVersion {
  return {
    id,
    grid_id: 7,
    version: number,
    label: `Season ${number} ladder`,
    status,
    created_from_version_id: null,
    published_at: status === "draft" ? null : "2026-05-02T10:00:00Z",
    tiers: [tier(1), tier(2), tier(3)]
  };
}

const VERSIONS = [
  version(20, 1, "archived"),
  version(21, 2, "published"),
  version(22, 3, "published"),
  version(23, 4, "draft")
];

function grid(id: number, name: string): DivisionGridEntity {
  return {
    id,
    workspace_id: 1,
    discipline: "overwatch",
    slug: `grid-${id}`,
    name,
    description: null,
    versions: VERSIONS,
    source_workspace_id: null,
    source_grid_id: null,
    source_key: null,
    source_fingerprint: null,
    imported_at: null,
    archived_at: null
  };
}

const mounted: { root: Root; container: HTMLElement }[] = [];

async function settle(turns = 8, delayMs = 0) {
  for (let turn = 0; turn < turns; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, delayMs);
      await promise;
    });
  }
}

function Harness({ render }: Readonly<{ render: () => ReactNode }>) {
  const [, force] = useState(0);
  // Published from an effect, not during render: writing a module-scope binding
  // while rendering is a side effect the react-compiler rules reject.
  useEffect(() => {
    rerender = () => force((value) => value + 1);
  }, []);
  return <>{render()}</>;
}

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Harness render={() => <DivisionsSettingsPage />} />
      </QueryClientProvider>
    );
  });
  await settle();
  return container;
}

async function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => {
    (element as HTMLElement).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle(3);
}

function button(text: string) {
  return Array.from(document.querySelectorAll("button")).find(
    (element) => element.textContent?.trim() === text
  );
}

beforeEach(() => {
  permitted = true;
  currentWorkspace = {
    id: 1,
    disciplines_enabled: ["overwatch", "lol"],
    default_division_grid_versions: { overwatch: 22 },
    effective_division_grid_versions: {}
  };
  activateDivisionGridVersion.mockReset();
  fetchWorkspaces.mockReset().mockResolvedValue(undefined);
  replace.mockClear();
  getDivisionGrids.mockReset().mockResolvedValue([grid(7, "Anak Division Grid")]);
  getDivisionGridVersions.mockReset().mockResolvedValue(VERSIONS);
  getDivisionGridVersionReadiness.mockReset().mockResolvedValue({
    target_version_id: 22,
    is_ready: true,
    used_source_version_ids: [21],
    missing_mapping_version_ids: [],
    incomplete_mapping_version_ids: [],
    sources: [
      {
        version_id: 21,
        version_label: "v2",
        grid_name: "Anak Division Grid",
        tournament_count: 1,
        tournament_names: ["Anak Cup 11"],
        status: "ok",
        conflict_tiers: []
      }
    ]
  });
  createDivisionGridVersion.mockReset().mockResolvedValue(version(24, 5, "draft"));
  cloneDivisionGridVersion.mockReset().mockResolvedValue(version(24, 5, "draft"));
  window.history.replaceState(null, "", "/admin/settings/divisions");
});

afterEach(async () => {
  for (const entry of mounted.splice(0)) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
  }
  document.body.innerHTML = "";
  rerender = null;
});

describe("Settings › Divisions", () => {
  it("refuses the section without division_grid.read and asks the API for nothing", async () => {
    permitted = false;
    const container = await mount();

    expect(container.textContent).toContain("Divisions are not available to you");
    expect(getDivisionGrids).not.toHaveBeenCalled();
  });

  it("shows the version list with the workspace's own version marked in force", async () => {
    const container = await mount();

    expect(container.textContent).toContain("v1");
    expect(container.textContent).toContain("v4");
    const history = container.querySelector('[aria-labelledby="divisions-history"]');
    // v3 is `published` server-side; "In force" is the workspace pointing at it.
    expect(history?.textContent).toContain("In force");
    expect(history?.textContent).toContain("Draft");
    // Published and archived are the norm: no pill, and never the raw enum.
    expect(history?.textContent).not.toContain("archived");
    expect(history?.textContent).not.toContain("published");

    // Only the draft is worth opening for editing.
    const editorLinks = Array.from(container.querySelectorAll("a")).filter((anchor) =>
      anchor.textContent?.includes("Open editor")
    );
    expect(editorLinks).toHaveLength(1);
    expect(editorLinks[0].getAttribute("href")).toBe("/admin/settings/divisions/v/23");
  });

  it("names the tournaments still reading an older version, and counts the rest honestly", async () => {
    getDivisionGridVersionReadiness.mockResolvedValue({
      target_version_id: 22,
      is_ready: true,
      used_source_version_ids: [21],
      missing_mapping_version_ids: [],
      incomplete_mapping_version_ids: [],
      sources: [
        {
          version_id: 21,
          version_label: "Season 2 ladder",
          grid_name: "Anak Division Grid",
          tournament_count: 7,
          tournament_names: ["Anak Cup 11", "Anak Cup 10"],
          status: "ok",
          conflict_tiers: []
        }
      ]
    });
    const container = await mount();

    expect(container.textContent).toContain("7 tournaments");
    expect(container.textContent).not.toContain("mapping complete");
    // The payload carries the five newest names and the full count, so the
    // names are shown as a sample with the remainder made explicit.
    expect(container.textContent).toContain("Anak Cup 11");
    expect(container.textContent).toContain("+5 more");
  });

  it("shows the active version as the grid in force, even when it belongs to a shared grid", async () => {
    const own = await mount();
    expect(own.textContent).toContain("In force · v3");
    expect(own.textContent).not.toContain("shared grid");

    // The workspace points at a version of a grid it does not own: it is not in
    // the grid list, but it is still the grid every rank resolves through.
    const shared = {
      ...version(90, 2, "published"),
      grid_id: 1,
      label: "Overwatch 2 Default Grid"
    };
    currentWorkspace = {
      id: 1,
      disciplines_enabled: ["overwatch"],
      default_division_grid_versions: { overwatch: 90 },
      effective_division_grid_versions: { overwatch: shared }
    };
    const container = await mount();
    expect(container.textContent).toContain("In force · v2");
    expect(container.textContent).toContain("Overwatch 2 Default Grid");
    expect(container.textContent).toContain("shared grid");
    expect(container.textContent).not.toContain("Nothing activated");
  });

  it("offers to activate a published version only once its readiness says so, then confirms", async () => {
    getDivisionGridVersionReadiness.mockImplementation(async (_ws: number, versionId: number) => ({
      target_version_id: versionId,
      is_ready: versionId === 21,
      used_source_version_ids: [],
      missing_mapping_version_ids: versionId === 21 ? [] : [22],
      incomplete_mapping_version_ids: [],
      sources: []
    }));
    activateDivisionGridVersion.mockResolvedValue(version(21, 2, "published"));
    await mount();

    // v2 is the one published version the workspace is not on; v3 is active.
    const activate = button("Activate v2");
    expect(activate).toBeTruthy();
    expect(activate!.hasAttribute("disabled")).toBe(false);
    expect(activateDivisionGridVersion).not.toHaveBeenCalled();

    await click(activate);
    const confirm = Array.from(document.querySelectorAll("button")).find(
      (element) => element.textContent?.trim() === "Activate v2" && element !== activate
    );
    await click(confirm);

    expect(activateDivisionGridVersion).toHaveBeenCalledWith(1, 21);
    expect(fetchWorkspaces).toHaveBeenCalled();
  });

  it("uses the selected grid's discipline and refreshes its active key without changing the other game", async () => {
    const lol = { ...version(90, 8, "published"), grid_id: 8, label: "LoL organizer scale" };
    const next = { ...version(91, 9, "published"), grid_id: 8, label: "New LoL scale" };
    const lolGrid = { ...grid(8, "LoL"), discipline: "lol", versions: [lol, next] };
    getDivisionGrids.mockResolvedValue([grid(7, "OW"), lolGrid]);
    getDivisionGridVersions.mockImplementation(async (_ws: number, id: number) =>
      id === 8 ? [lol, next] : VERSIONS
    );
    currentWorkspace = {
      id: 1,
      disciplines_enabled: ["overwatch", "lol"],
      default_division_grid_versions: { overwatch: 22, lol: 90 },
      effective_division_grid_versions: { overwatch: VERSIONS[2], lol }
    };
    activateDivisionGridVersion.mockResolvedValue(next);
    fetchWorkspaces.mockImplementation(async () => {
      currentWorkspace = {
        ...currentWorkspace,
        default_division_grid_versions: { overwatch: 22, lol: 91 },
        effective_division_grid_versions: { overwatch: VERSIONS[2], lol: next }
      };
      rerender?.();
    });
    const container = await mount();
    expect(container.querySelector("#divisions-in-force")?.textContent).not.toContain("LoL");
    await act(async () => {
      replace("/admin/settings/divisions?grid=8");
    });
    await settle();
    expect(container.querySelector("#divisions-in-force")?.textContent).toBe("LoL organizer scale");
    expect(button("Load standard OW ladder")).toBeUndefined();
    const activate = button("Activate v9");
    await click(activate);
    const confirm = Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(
      (element) => element.textContent?.trim() === "Activate v9"
    );
    await click(confirm);
    expect(container.querySelector("#divisions-in-force")?.textContent).toBe("New LoL scale");
    await act(async () => {
      replace("/admin/settings/divisions?grid=7");
    });
    await settle();
    expect(container.querySelector("#divisions-in-force")?.textContent).toBe(VERSIONS[2].label);
  });

  it("labels a resolved system grid as fallback without calling it an explicit active selection", async () => {
    currentWorkspace = {
      id: 1,
      disciplines_enabled: ["overwatch"],
      default_division_grid_versions: {},
      effective_division_grid_versions: {
        overwatch: { ...VERSIONS[2], grid_id: 1, label: "System OW" }
      }
    };
    const container = await mount();
    expect(container.querySelector("#divisions-in-force")?.textContent).toBe("System OW");
    expect(container.textContent).toContain("system fallback · nothing activated");
  });

  it.each([false, true])(
    "never renders OW native data for a LoL grid (active=%s)",
    async (active) => {
      const lol: DivisionGridVersion = {
        ...version(90, 1, "published"),
        grid_id: 8,
        label: "LoL organizer scale",
        tiers: [
          {
            ...tier(1),
            name: "LoL High",
            rank_min: 200,
            rank_max: null,
            native_rank_min: null,
            native_rank_max: null,
            icon_url: "https://cdn/lol-high.png"
          },
          {
            ...tier(2),
            name: "LoL Low",
            rank_min: 0,
            rank_max: 199,
            native_rank_min: null,
            native_rank_max: null,
            icon_url: ""
          }
        ]
      };
      getDivisionGrids.mockResolvedValue([
        grid(7, "OW"),
        { ...grid(8, "LoL"), discipline: "lol", versions: [lol] }
      ]);
      getDivisionGridVersions.mockResolvedValue([lol]);
      getDivisionGridVersionReadiness.mockResolvedValue({
        target_version_id: 90,
        is_ready: true,
        used_source_version_ids: [],
        missing_mapping_version_ids: [],
        incomplete_mapping_version_ids: [],
        sources: []
      });
      currentWorkspace = {
        id: 1,
        disciplines_enabled: ["overwatch", "lol"],
        default_division_grid_versions: active ? { overwatch: 22, lol: 90 } : { overwatch: 22 },
        effective_division_grid_versions: active
          ? { overwatch: VERSIONS[2], lol }
          : { overwatch: VERSIONS[2] }
      };
      window.history.replaceState(null, "", "/admin/settings/divisions?grid=8");
      const container = await mount();
      expect(container.querySelector("ol[aria-label]")).toBeNull();
      expect(container.textContent).not.toMatch(/Champion|Bronze|45 ranks|Overwatch rank/);
      expect([...container.querySelectorAll("th")].map((cell) => cell.textContent)).not.toContain(
        "OW ranks"
      );
      expect(
        [...container.querySelectorAll("img")].map((image) => image.getAttribute("src"))
      ).toEqual(active ? ["https://cdn/lol-high.png"] : []);
      if (active) {
        expect(container.textContent).toContain("LoL High");
        expect(container.textContent).toContain("LoL Low");
        expect(container.textContent).toContain("200");
      } else {
        expect(container.querySelector("table")).toBeNull();
      }
    }
  );

  it("offers the grid selector only when there is more than one grid, and writes ?grid=", async () => {
    const single = await mount();
    expect(single.querySelector("#division-grid-select")).toBeNull();

    getDivisionGrids.mockResolvedValue([grid(7, "Anak Division Grid"), grid(8, "Legacy grid")]);
    const many = await mount();
    expect(many.querySelector("#division-grid-select")).toBeTruthy();
  });

  it("loads the standard OW ladder as a new version with a complete OW mapping", async () => {
    await mount();

    await click(button("Load standard OW ladder"));

    expect(createDivisionGridVersion).toHaveBeenCalledTimes(1);
    const [workspaceId, gridId, payload] = createDivisionGridVersion.mock.calls[0] as [
      number,
      number,
      { label: string; tiers: Record<string, unknown>[] }
    ];
    expect(workspaceId).toBe(1);
    expect(gridId).toBe(7);
    expect(payload.tiers).toHaveLength(45);

    // No ids -> the save creates a version instead of rewriting one in place.
    expect(payload.tiers.every((entry) => entry.id === undefined)).toBe(true);
    expect(payload.tiers.map((entry) => entry.sort_order)).toEqual(
      payload.tiers.map((_entry, index) => index)
    );

    // Both OW endpoints filled on every tier, top tier included: either being
    // null drops that division out of OW rank resolution entirely.
    expect(
      payload.tiers.every(
        (entry) => entry.native_rank_min !== null && entry.native_rank_max !== null
      )
    ).toBe(true);
    expect(payload.tiers.every((entry) => entry.native_rank_min === entry.native_rank_max)).toBe(
      true
    );
    expect(new Set(payload.tiers.map((entry) => entry.native_rank_min)).size).toBe(45);

    // And it lands in the editor rather than leaving the user on the overview.
    expect(replace).toHaveBeenCalledWith("/admin/settings/divisions/v/24");
  });

  it("clones the newest version into a fresh draft", async () => {
    await mount();

    await click(button("New draft from v4"));

    expect(cloneDivisionGridVersion).toHaveBeenCalledWith(23);
    expect(replace).toHaveBeenCalledWith("/admin/settings/divisions/v/24");
  });
});

describe("Settings › Divisions · browsing game", () => {
  it("names an unknown ?discipline= and draws no grid for any game", async () => {
    window.history.replaceState(null, "", "/admin/settings/divisions?discipline=chess");
    const container = await mount();

    expect(container.textContent).toContain("chess");
    expect(container.querySelector("#divisions-in-force")).toBeNull();
    expect(getDivisionGridVersions).not.toHaveBeenCalled();
    expect(getDivisionGridVersionReadiness).not.toHaveBeenCalled();
  });

  it("scopes the page to the browsed game: a game with no grid of its own is asked for one, never given another's", async () => {
    currentWorkspace = {
      id: 1,
      disciplines_enabled: ["overwatch", "lol"],
      default_division_grid_versions: { overwatch: 22 },
      effective_division_grid_versions: { overwatch: VERSIONS[2] }
    };
    window.history.replaceState(null, "", "/admin/settings/divisions?discipline=lol");
    const container = await mount();

    expect(container.querySelector("#divisions-in-force")?.textContent).toBe(
      "Create a division grid for this game"
    );
    expect(container.textContent).not.toContain(VERSIONS[2].label);
    expect(button("Load standard OW ladder")).toBeUndefined();
    expect(getDivisionGridVersions).not.toHaveBeenCalled();
  });

  it("offers the native game's own standard ladder, built from its metadata", async () => {
    getDivisionGrids.mockResolvedValue([{ ...grid(7, "Anak Division Grid"), versions: [] }]);
    getDivisionGridVersions.mockResolvedValue([]);
    currentWorkspace = {
      id: 1,
      disciplines_enabled: ["overwatch"],
      default_division_grid_versions: {},
      effective_division_grid_versions: {}
    };
    await mount();
    await click(button("Load standard OW ladder"));

    expect(createDivisionGridVersion).toHaveBeenCalledTimes(1);
    const [, gridId, body] = createDivisionGridVersion.mock.calls[0] as [
      number,
      number,
      { tiers: { id?: number; rank_min: number; native_rank_min: number | null }[] }
    ];
    expect(gridId).toBe(7);
    expect(body.tiers).toHaveLength(TEST_LADDER_TIERS.length);
    expect(body.tiers.every((entry) => entry.id === undefined)).toBe(true);
    expect(body.tiers.map((entry) => entry.rank_min)).toEqual(
      TEST_LADDER_TIERS.map((rank) => rank.rank_min)
    );
    expect(body.tiers.every((entry) => entry.native_rank_min === entry.rank_min)).toBe(true);
  });
});

describe("Settings › Divisions · game switch and captured scope", () => {
  it("lets an explicit grid own its game even when the URL names another game", async () => {
    getDivisionGrids.mockResolvedValue([
      grid(7, "OW"),
      { ...grid(8, "LoL"), discipline: "lol", versions: [] }
    ]);
    getDivisionGridVersions.mockResolvedValue([]);

    // LoL grid, Overwatch in the URL: the grid wins.
    window.history.replaceState(null, "", "/admin/settings/divisions?grid=8&discipline=overwatch");
    const lol = await mount();
    expect(lol.querySelector("#divisions-in-force")?.textContent).toBe(
      "Create a division grid for this game"
    );
    expect(getDivisionGridVersions).toHaveBeenCalledWith(1, 8);
    expect(button("Load standard OW ladder")).toBeUndefined();
  });

  it("opens an Overwatch grid under ?discipline=lol as Overwatch", async () => {
    window.history.replaceState(null, "", "/admin/settings/divisions?discipline=lol&grid=7");
    const container = await mount();

    expect(container.querySelector("#divisions-in-force")?.textContent).toBe(VERSIONS[2].label);
    expect(getDivisionGridVersions).toHaveBeenCalledWith(1, 7);
  });

  it("opens a grid-only URL as the owner of its game, whatever the saved preference is", async () => {
    getDivisionGrids.mockResolvedValue([
      grid(7, "OW"),
      { ...grid(8, "LoL"), discipline: "lol", versions: [] }
    ]);
    getDivisionGridVersions.mockResolvedValue([]);
    window.history.replaceState(null, "", "/admin/settings/divisions?grid=8");
    const container = await mount();

    // Preference is Overwatch, the grid is LoL: the page is LoL, with no OW-only action and no URL rewrite.
    expect(container.querySelector("#divisions-in-force")?.textContent).toBe(
      "Create a division grid for this game"
    );
    expect(button("Load standard OW ladder")).toBeUndefined();
    expect(getDivisionGridVersions).toHaveBeenCalledWith(1, 8);
    expect(window.location.search).toBe("?grid=8");
  });

  it("drops the grid pin only when the user changes the game selector", async () => {
    getDivisionGrids.mockResolvedValue([grid(7, "OW")]);
    window.history.replaceState(null, "", "/admin/settings/divisions?discipline=overwatch&grid=7");
    selectGame.mockClear();
    await mount();
    expect(selectGame).not.toHaveBeenCalled();

    const trigger = document.querySelector<HTMLElement>('button[role="combobox"]');
    await click(trigger);
    const option = Array.from(document.querySelectorAll('[role="option"]')).find(
      (element) => element.textContent?.includes("League of Legends")
    );
    await click(option);

    expect(selectGame).toHaveBeenCalledWith("lol", { dropParams: ["grid"] });
  });

  it("opens a portable import on the returned grid AND its game", async () => {
    importDivisionGridPortable.mockResolvedValue({ ...grid(8, "LoL"), discipline: "lol" });
    await mount();

    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(["{}"], "grid.json", { type: "application/json" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    expect(importDivisionGridPortable).toHaveBeenCalledWith(1, {});
    expect(window.location.search).toContain("grid=8");
    expect(window.location.search).toContain("discipline=lol");
  });

  it("invalidates the scope captured at submit, even when the game changes before the request ends", async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const pending = Promise.withResolvers<DivisionGridVersion>();
    activateDivisionGridVersion.mockReturnValue(pending.promise);
    await mount();

    await click(button("Activate v2"));
    const confirm = Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(
      (element) => element.textContent?.trim() === "Activate v2"
    );
    await click(confirm);
    expect(activateDivisionGridVersion).toHaveBeenCalledWith(1, 21);

    // The organizer moves on to LoL while the Overwatch activation is in flight.
    await act(async () => {
      replace("/admin/settings/divisions?discipline=lol");
    });
    invalidate.mockClear();
    await act(async () => pending.resolve(VERSIONS[1]));
    await settle();

    const keys = invalidate.mock.calls.map(([filters]) => (filters as { queryKey: unknown[] }).queryKey);
    expect(keys).toContainEqual(["division-grid-versions", 1, "overwatch"]);
    expect(keys).toContainEqual(["division-grid-readiness", 1, "overwatch"]);
    expect(keys).not.toContainEqual(["division-grid-versions", 1, "lol"]);
    invalidate.mockRestore();
  });
});
