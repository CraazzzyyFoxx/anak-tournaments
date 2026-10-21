// @vitest-environment happy-dom
//
// Settings › Divisions — the overview of a workspace's division grids. What is pinned:
//
//  1. the `division_grid.read` gate is the PAGE's. Hiding a rail link is not
//     access control: the URL typed into the address bar has to be refused,
//     and nothing may be asked of the API before it is allowed;
//  2. the version list's pills come from the two facts that decide them — the
//     stored status and the workspace's default version pointer — so a
//     published version the workspace points at reads "In force", which is not
//     a status the backend has; published and archived rows carry no pill;
//  3. the grid selector only appears when the game really has more than one
//     grid, and it writes `?grid=`;
//  4. a draft from the built-in ladder: a tier with a `null` native endpoint is
//     skipped by `resolve_division_from_native_rank`, and an `id` on any tier
//     would make the save rewrite a version in place instead of creating one;
//  5. a game without a grid of its own gets one from the in-force card, and
//     "New grid" copies the version in force (unless it is the plain ladder)
//     and never activates anything;
//  6. deleting a grid tournaments are pinned to detaches them only through the
//     typed confirmation that names the count; the grid in force cannot be deleted;
//  7. "All games" is a summary row per game that opens that game.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceSettingsShell } from "@/components/admin/workspace-settings/WorkspaceSettingsShell";
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
const createDivisionGrid = vi.fn();
const deleteDivisionGrid = vi.fn();
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
    importDivisionGridPortable: (...args: unknown[]) => importDivisionGridPortable(...args),
    createDivisionGrid: (...args: unknown[]) => createDivisionGrid(...args),
    deleteDivisionGrid: (...args: unknown[]) => deleteDivisionGrid(...args),
    updateDivisionGrid: vi.fn()
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
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  )
}));

// The page reads its game from the shared resolver (the real one) and that game's native metadata. In the admin no
// saved scope reaches it: the game is the game filter's `?discipline=`, else every game.
const INSTALLED = [
  {
    code: "overwatch",
    name: "Overwatch",
    short_name: "OW",
    icon: null,
    enabled: true,
    capabilities: { native_ladder: true }
  },
  {
    code: "lol",
    name: "League of Legends",
    short_name: "LoL",
    icon: null,
    enabled: true,
    capabilities: { native_ladder: false }
  }
];

vi.mock("@/hooks/useGameScope", async () => {
  const { resolvePageGame } = await vi.importActual<typeof import("@/lib/site/discipline-scope")>(
    "@/lib/site/discipline-scope"
  );
  return {
    useGameScope: (options: { pageClass: "multi" | "owner"; ownerGame?: string | null }) => {
      const resolution = resolvePageGame({
        pageClass: options.pageClass,
        ownerGame: options.ownerGame ?? null,
        explicit: new URLSearchParams(window.location.search).get("discipline"),
        stored: "all",
        lastGame: null,
        games: INSTALLED
      });
      return {
        axis: 1,
        games: INSTALLED,
        resolution,
        game: resolution.game.kind === "game" ? resolution.game.code : null,
        isError: false,
        refetch: vi.fn(),
        selectScope: vi.fn(),
        selectTab: vi.fn()
      };
    }
  };
});
vi.mock("@/hooks/useGameDescriptors", () => ({
  useGameDescriptors: () => new Map(INSTALLED.map((game) => [game.code, game]))
}));

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
    archived_at: null,
    tournament_count: 0
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

/** The page inside the settings shell, as the app mounts it: the header actions portal into the shell's header. */
async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <WorkspaceSettingsShell basePath="/admin/settings">
          <Harness render={() => <DivisionsSettingsPage />} />
        </WorkspaceSettingsShell>
      </QueryClientProvider>
    );
  });
  await settle();
  return container;
}

async function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => {
    element!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle(3);
}

function button(text: string) {
  return Array.from(document.querySelectorAll("button")).find(
    (element) => element.textContent?.trim() === text
  );
}

function menuItem(text: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (element) => element.textContent?.trim() === text
  );
}

async function type(input: HTMLInputElement | null, value: string) {
  expect(input).toBeTruthy();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(2);
}

/** Picks a game in the page's inline game select (an option reads as its mark, then its name). */
async function pickGame(name: string) {
  await click(document.querySelector('button[role="combobox"][aria-label="Game"]'));
  await click(
    Array.from(document.querySelectorAll('[role="option"]')).find((option) =>
      option.textContent?.endsWith(name)
    )
  );
}

const inForceTitle = (container: HTMLElement) => container.querySelector("#divisions-in-force")?.textContent;

beforeEach(() => {
  permitted = true;
  currentWorkspace = {
    id: 1,
    disciplines_enabled: ["overwatch", "lol"],
    default_division_grid_versions: { overwatch: 22 },
    effective_division_grid_versions: { overwatch: VERSIONS[2] }
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
  createDivisionGrid.mockReset();
  deleteDivisionGrid.mockReset().mockResolvedValue(undefined);
  window.history.replaceState(null, "", "/admin/settings/divisions?discipline=overwatch");
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

  it("names the grid in force with its version, and a shared grid by its label", async () => {
    const own = await mount();
    expect(inForceTitle(own)).toBe("Anak Division Grid · v3");
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
    expect(inForceTitle(container)).toBe("Overwatch 2 Default Grid");
    expect(container.textContent).toContain("shared grid");
    expect(container.textContent).not.toContain("nothing activated");
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
    const confirm = Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(
      (element) => element.textContent?.trim() === "Activate v2"
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
    expect(inForceTitle(container)).toBe("OW · v3");
    await act(async () => {
      replace("/admin/settings/divisions?grid=8");
    });
    await settle();
    expect(inForceTitle(container)).toBe("LoL · v8");
    // LoL has no ladder in this workspace's metadata: nothing offers to draft from one.
    await click(document.querySelector('button[aria-label="Actions for LoL"]'));
    expect(menuItem("New draft from the LoL ladder")).toBeUndefined();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    const activate = button("Activate v9");
    await click(activate);
    const confirm = Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(
      (element) => element.textContent?.trim() === "Activate v9"
    );
    await click(confirm);
    expect(inForceTitle(container)).toBe("LoL · v9");
    await act(async () => {
      replace("/admin/settings/divisions?grid=7");
    });
    await settle();
    expect(inForceTitle(container)).toBe("OW · v3");
  });

  it("labels a resolved system grid as such without calling it an explicit active selection", async () => {
    currentWorkspace = {
      id: 1,
      disciplines_enabled: ["overwatch"],
      default_division_grid_versions: {},
      effective_division_grid_versions: {
        overwatch: { ...VERSIONS[2], grid_id: 1, label: "System OW" }
      }
    };
    const container = await mount();
    expect(inForceTitle(container)).toBe("System OW");
    expect(container.textContent).toContain("system grid · nothing activated");
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

  it("offers the grid selector only when the game has more than one grid, and writes ?grid=", async () => {
    const single = await mount();
    expect(single.querySelector("#division-grid-select")).toBeNull();
    expect(single.textContent).toContain("Anak Division Grid");

    getDivisionGrids.mockResolvedValue([
      grid(7, "Anak Division Grid"),
      grid(8, "Legacy grid"),
      { ...grid(9, "LoL grid"), discipline: "lol", versions: [] }
    ]);
    const many = await mount();
    await click(many.querySelector("#division-grid-select"));
    // Only this game's grids: the LoL grid is another game's.
    const options = [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent);
    expect(options).toEqual(["Anak Division Grid", "Legacy grid"]);
    await click([...document.querySelectorAll('[role="option"]')][1]);
    expect(window.location.search).toContain("grid=8");
  });

  it("drafts the built-in ladder as a new version with a complete native mapping", async () => {
    await mount();

    // A draft is open, so the ladder draft lives in the grid's menu rather than the card.
    await click(document.querySelector('button[aria-label="Actions for Anak Division Grid"]'));
    await click(menuItem("New draft from the OW ladder"));

    expect(createDivisionGridVersion).toHaveBeenCalledTimes(1);
    const [workspaceId, gridId, payload] = createDivisionGridVersion.mock.calls[0] as [
      number,
      number,
      { label: string; tiers: Record<string, unknown>[] }
    ];
    expect(workspaceId).toBe(1);
    expect(gridId).toBe(7);
    expect(payload.label).toBe("OW ladder");
    expect(payload.tiers).toHaveLength(45);

    // No ids -> the save creates a version instead of rewriting one in place.
    expect(payload.tiers.every((entry) => entry.id === undefined)).toBe(true);
    expect(payload.tiers.map((entry) => entry.sort_order)).toEqual(
      payload.tiers.map((_entry, index) => index)
    );

    // Both native endpoints filled on every tier, top tier included: either being
    // null drops that division out of native rank resolution entirely.
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

  it("clones the newest version into a fresh draft when nothing else is pending", async () => {
    const published = VERSIONS.slice(0, 3);
    getDivisionGridVersions.mockResolvedValue(published);
    getDivisionGrids.mockResolvedValue([{ ...grid(7, "Anak Division Grid"), versions: published }]);
    getDivisionGridVersionReadiness.mockImplementation(async (_ws: number, versionId: number) => ({
      target_version_id: versionId,
      is_ready: versionId === 22,
      used_source_version_ids: [],
      missing_mapping_version_ids: versionId === 22 ? [] : [22],
      incomplete_mapping_version_ids: [],
      sources: []
    }));
    await mount();

    // One "do next" on the screen: the card's.
    expect(Array.from(document.querySelectorAll("button")).filter((node) => node.textContent?.trim() === "New draft from v3")).toHaveLength(1);
    await click(button("New draft from v3"));

    expect(cloneDivisionGridVersion).toHaveBeenCalledWith(22);
    expect(replace).toHaveBeenCalledWith("/admin/settings/divisions/v/24");
  });
});

describe("Settings › Divisions · grids", () => {
  it("gives a game without a grid of its own one from the in-force card, opened as its owner", async () => {
    createDivisionGrid.mockResolvedValue({ ...grid(30, "Spring"), discipline: "lol", versions: [] });
    window.history.replaceState(null, "", "/admin/settings/divisions?discipline=lol");
    const container = await mount();

    expect(inForceTitle(container)).toBe("Create a division grid for this game");
    await click(button("Create LoL grid"));

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("New division grid");
    // The page fixed the game: it is named, not asked.
    expect(dialog?.textContent).toContain("League of Legends");
    expect(dialog?.querySelector("#division-grid-game")).toBeNull();

    // An empty name is refused in the dialog (the field is required), and nothing is sent.
    await click(button("Create grid"));
    expect(createDivisionGrid).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();

    await type(document.querySelector<HTMLInputElement>("#division-grid-name"), "Spring");
    await click(button("Create grid"));

    expect(createDivisionGrid).toHaveBeenCalledWith(1, {
      name: "Spring",
      discipline: "lol",
      from_version_id: undefined
    });
    expect(activateDivisionGridVersion).not.toHaveBeenCalled();
    expect(window.location.search).toContain("grid=30");
    expect(window.location.search).toContain("discipline=lol");
  });

  it("starts a new grid as a copy of the version in force unless the ladder is picked", async () => {
    createDivisionGrid.mockResolvedValue({ ...grid(31, "Cup grid"), versions: [] });
    await mount();

    await click(button("New grid"));
    // The version in force (3 custom divisions) is not the plain 45-rank ladder: both starts are offered.
    const copy = document.querySelector<HTMLElement>("#division-grid-base-active");
    const ladder = document.querySelector<HTMLElement>("#division-grid-base-ladder");
    expect(copy?.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector("#division-grid-base-active-title")?.textContent).toBe(
      "A copy of Anak Division Grid · v3"
    );

    await type(document.querySelector<HTMLInputElement>("#division-grid-name"), "Cup grid");
    await click(button("Create grid"));
    expect(createDivisionGrid).toHaveBeenLastCalledWith(1, {
      name: "Cup grid",
      discipline: "overwatch",
      from_version_id: 22
    });

    await click(button("New grid"));
    await click(document.querySelector("#division-grid-base-ladder"));
    expect(ladder).toBeTruthy();
    await type(document.querySelector<HTMLInputElement>("#division-grid-name"), "Ladder grid");
    await click(button("Create grid"));
    expect(createDivisionGrid).toHaveBeenLastCalledWith(1, {
      name: "Ladder grid",
      discipline: "overwatch",
      from_version_id: undefined
    });
    expect(activateDivisionGridVersion).not.toHaveBeenCalled();
  });

  it("detaches pinned tournaments only through the typed confirmation, and never deletes the grid in force", async () => {
    getDivisionGrids.mockResolvedValue([
      grid(7, "Anak Division Grid"),
      { ...grid(8, "Legacy grid"), versions: [VERSIONS[0], VERSIONS[1]], tournament_count: 3 }
    ]);
    getDivisionGridVersions.mockImplementation(async (_ws: number, id: number) =>
      id === 8 ? [VERSIONS[0], VERSIONS[1]] : VERSIONS
    );
    const container = await mount();

    // The grid in force: delete is shown but disabled, with the reason in the menu.
    await click(container.querySelector('button[aria-label="Actions for Anak Division Grid"]'));
    expect(menuItem("Delete…")?.getAttribute("aria-disabled")).toBe("true");
    expect(document.body.textContent).toContain("This grid is in force: activate another one first.");
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    await act(async () => {
      replace("/admin/settings/divisions?discipline=overwatch&grid=8");
    });
    await settle();
    await click(container.querySelector('button[aria-label="Actions for Legacy grid"]'));
    await click(menuItem("Delete…"));

    const confirm = document.querySelector('[role="alertdialog"]');
    expect(confirm?.textContent).toContain("Detach tournaments and delete “Legacy grid”?");
    expect(confirm?.textContent).toContain("3 tournaments are pinned to its versions");
    const detach = button("Detach and delete");
    expect(detach?.hasAttribute("disabled")).toBe(true);

    await type(confirm!.querySelector<HTMLInputElement>("input"), "Legacy grid");
    await click(button("Detach and delete"));
    expect(deleteDivisionGrid).toHaveBeenCalledWith(8, true);
    // The deleted grid is no longer pinned.
    expect(window.location.search).not.toContain("grid=8");
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

  it("scopes the page to the browsed game: a game with no grid of its own is offered one, never given another's", async () => {
    window.history.replaceState(null, "", "/admin/settings/divisions?discipline=lol");
    const container = await mount();

    expect(inForceTitle(container)).toBe("Create a division grid for this game");
    expect(container.textContent).not.toContain(VERSIONS[2].label);
    expect(container.textContent).toContain("LoL has no grid of its own");
    expect(button("Create LoL grid")).toBeTruthy();
    expect(getDivisionGridVersions).not.toHaveBeenCalled();
  });

  it("offers the native game's own ladder as the first draft, built from its metadata", async () => {
    getDivisionGrids.mockResolvedValue([{ ...grid(7, "Anak Division Grid"), versions: [] }]);
    getDivisionGridVersions.mockResolvedValue([]);
    currentWorkspace = {
      id: 1,
      disciplines_enabled: ["overwatch"],
      default_division_grid_versions: {},
      effective_division_grid_versions: {}
    };
    const container = await mount();
    // Nothing in force: the built-in ladder is what resolves, and the table shows it.
    expect(inForceTitle(container)).toBe("Built-in OW ladder");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(TEST_LADDER_TIERS.length);
    await click(button("New draft from the OW ladder"));

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
    expect(inForceTitle(lol)).toBe("Create a division grid for this game");
    expect(getDivisionGridVersions).toHaveBeenCalledWith(1, 8);
    expect(button("New draft from the OW ladder")).toBeUndefined();
  });

  it("opens an Overwatch grid under ?discipline=lol as Overwatch", async () => {
    window.history.replaceState(null, "", "/admin/settings/divisions?discipline=lol&grid=7");
    const container = await mount();

    expect(inForceTitle(container)).toBe("Anak Division Grid · v3");
    expect(getDivisionGridVersions).toHaveBeenCalledWith(1, 7);
  });

  it("opens a grid-only URL as the owner of its game, with no game filtered", async () => {
    getDivisionGrids.mockResolvedValue([
      grid(7, "OW"),
      { ...grid(8, "LoL"), discipline: "lol", versions: [] }
    ]);
    getDivisionGridVersions.mockResolvedValue([]);
    window.history.replaceState(null, "", "/admin/settings/divisions?grid=8");
    const container = await mount();

    // The grid is LoL: the page is LoL, with no OW-only action and no URL rewrite.
    expect(inForceTitle(container)).toBe("Create a division grid for this game");
    expect(button("New draft from the OW ladder")).toBeUndefined();
    expect(getDivisionGridVersions).toHaveBeenCalledWith(1, 8);
    expect(window.location.search).toBe("?grid=8");
  });

  it("summarises every game under all games and opens one from its row", async () => {
    getDivisionGrids.mockResolvedValue([
      grid(7, "OW grid"),
      { ...grid(8, "LoL grid"), discipline: "lol", versions: [] }
    ]);
    window.history.replaceState(null, "", "/admin/settings/divisions");
    const container = await mount();

    expect(container.querySelector("#divisions-in-force")).toBeNull();
    expect(getDivisionGridVersions).not.toHaveBeenCalled();
    const rows = [...container.querySelectorAll('[aria-labelledby="divisions-games"] > ul > li')];
    expect(rows.map((row) => row.querySelector("a")?.textContent)).toEqual(["Overwatch", "League of Legends"]);
    expect(rows[0].textContent).toContain("OW grid · v3");
    expect(rows[0].textContent).toContain("3 divisions");
    // LoL has neither a ladder nor a grid in force here: the row says what it needs.
    expect(rows[1].textContent).toContain("Needs a division grid");
    expect(rows[1].querySelector("a")?.getAttribute("href")).toBe("/admin/settings/divisions?discipline=lol");
  });

  it("opens a portable import on the returned grid AND its game", async () => {
    importDivisionGridPortable.mockResolvedValue({ ...grid(8, "LoL"), discipline: "lol" });
    window.history.replaceState(null, "", "/admin/settings/divisions");
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

    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(["division-grid-versions", 1, "overwatch"]);
    expect(keys).toContainEqual(["division-grid-readiness", 1, "overwatch"]);
    expect(keys).not.toContainEqual(["division-grid-versions", 1, "lol"]);
    invalidate.mockRestore();
  });
});

describe("Settings › Divisions · game filter", () => {
  beforeEach(() => {
    getDivisionGrids.mockResolvedValue([
      grid(7, "OW"),
      { ...grid(8, "LoL"), discipline: "lol", versions: [] }
    ]);
    getDivisionGridVersions.mockImplementation(async (_ws: number, id: number) => (id === 8 ? [] : VERSIONS));
    window.history.replaceState(null, "", "/admin/settings/divisions");
  });

  it("offers the Game select, and a picked game opens that game's grid", async () => {
    const container = await mount();
    expect(container.querySelector('[aria-labelledby="divisions-games"]')).toBeTruthy();

    await pickGame("League of Legends");

    expect(window.location.search).toBe("?discipline=lol");
    expect(inForceTitle(container)).toBe("Create a division grid for this game");
    expect(getDivisionGridVersions).toHaveBeenLastCalledWith(1, 8);
  });

  it("unpins a grid only for another game's pick; clearing the game keeps the pin", async () => {
    window.history.replaceState(null, "", "/admin/settings/divisions?grid=7");
    const container = await mount();

    await pickGame("Overwatch");
    expect(window.location.search).toBe("?grid=7&discipline=overwatch");

    await pickGame("All games");
    expect(window.location.search).toBe("?grid=7");

    await pickGame("League of Legends");
    expect(window.location.search).toBe("?discipline=lol");
    expect(inForceTitle(container)).toBe("Create a division grid for this game");
  });
});
