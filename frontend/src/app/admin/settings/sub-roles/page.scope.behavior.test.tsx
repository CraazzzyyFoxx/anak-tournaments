// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayerSubRole } from "@/types/admin.types";
import WorkspaceSubRolesSettingsPage from "./page";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const getPlayerSubRoles = vi.fn();
const createPlayerSubRole = vi.fn();
/** A game whose metadata read fails. */
let failingMetadata: string | null = null;
const refetchMetadata = vi.fn();
vi.mock("@/services/admin.service", () => ({
  default: {
    getPlayerSubRoles: (...args: unknown[]) => getPlayerSubRoles(...args),
    createPlayerSubRole: (...args: unknown[]) => createPlayerSubRole(...args),
    updatePlayerSubRole: vi.fn(),
    deletePlayerSubRole: vi.fn()
  }
}));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ canAccessPermission: () => true }) }));
vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (selector: (state: { currentWorkspaceId: number }) => unknown) =>
    selector({ currentWorkspaceId: 1 })
}));
vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), apiError: vi.fn() } }));
// The admin's game is the game filter's `?discipline=`; none is every game.
vi.mock("@/hooks/useGameScope", async () => {
  // vi.mock factories run hoisted above static imports, so the helper is imported here.
  const { gameScopeState } = await import("@/test/game-scope");
  return {
    useGameScope: () => gameScopeState(new URLSearchParams(window.location.search).get("discipline"))
  };
});
vi.mock("@/hooks/useMobile", () => ({ useIsMobile: () => false }));
let rerender: (() => void) | null = null;
const push = vi.fn((url: string) => {
  window.history.replaceState(null, "", url);
  rerender?.();
});
vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useRouter: () => ({ push, replace: push }),
  useSearchParams: () => new URLSearchParams(window.location.search)
}));
vi.mock("@/hooks/useDisciplineMetadata", () => ({
  useDisciplineMetadata: (_axis: number, code: string) => ({
    data:
      code === failingMetadata
        ? undefined
        : {
            discipline: { code },
            workspace_id: 1,
            dimensions: [
              { id: 1, code: "position", name: "Position", rated: true, active: true, selection_mode: "single", sort_order: 0 }
            ],
            roles: (code === "lol" ? ["top", "jungle", "mid", "bot", "support"] : ["tank", "damage", "support"]).map(
              (role, i) => ({
                id: i + 1,
                dimension: "position",
                code: role,
                name: role[0].toUpperCase() + role.slice(1),
                parent_id: null,
                workspace_id: null,
                active: true,
                selectable: true,
                sort_order: i,
                attrs: { icon: `/disciplines/${code}/roles/${role}.svg` }
              })
            )
          },
    isError: code === failingMetadata,
    refetch: refetchMetadata
  })
}));

const CATALOG: PlayerSubRole[] = [
  { id: 11, workspace_id: 1, discipline: "overwatch", dimension: "position", role: "tank", slug: "main", label: "Main Tank", description: null, sort_order: 0, is_active: true, attrs: {} },
  { id: 21, workspace_id: 1, discipline: "lol", dimension: "position", role: "top", slug: "solo", label: "Solo Top", description: null, sort_order: 0, is_active: true, attrs: {} }
];

let root: Root | undefined;
let container: HTMLDivElement;
let client: QueryClient;
function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}
async function renderPage() {
  rerender = () =>
    root!.render(
      <QueryClientProvider client={client}>
        <WorkspaceSubRolesSettingsPage />
      </QueryClientProvider>
    );
  await act(async () => {
    rerender!();
    await tick();
  });
  await act(async () => {
    await tick();
  });
}
async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await renderPage();
}
async function click(node: Element) {
  await act(async () => {
    node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
  });
}
/** Picks a game in the page's inline game select (an option reads as its mark, then its name). */
async function pickGame(name: string) {
  await click(container.querySelector('button[role="combobox"][aria-label="Game"]')!);
  await click([...document.querySelectorAll('[role="option"]')].find((node) => node.textContent?.endsWith(name))!);
}
function search() {
  return new URLSearchParams(window.location.search);
}
/** A game's section, by its heading (its mark, then its name). */
function game(name: string) {
  const section = [...container.querySelectorAll("section")].find((node) =>
    node.querySelector(":scope > h2")?.textContent?.endsWith(name)
  );
  expect(section).toBeTruthy();
  return section!;
}
/** The role cards' headings, in order. */
function roleCards(scope: ParentNode = container) {
  return [...scope.querySelectorAll("section > header > h3")].map((node) => node.textContent);
}

beforeEach(() => {
  window.history.replaceState(null, "", "/admin/settings/sub-roles");
  push.mockClear();
  getPlayerSubRoles.mockReset().mockResolvedValue(CATALOG);
  createPlayerSubRole.mockReset().mockResolvedValue(CATALOG[1]);
  failingMetadata = null;
  refetchMetadata.mockClear();
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  client?.clear();
  container?.remove();
  document.body.innerHTML = "";
  root = undefined;
  rerender = null;
});

describe("sub-role settings under all games", () => {
  it("reads the catalog once and files each game's sub-roles under that game's own roles", async () => {
    await mount();

    expect(getPlayerSubRoles).toHaveBeenCalledTimes(1);
    expect(getPlayerSubRoles).toHaveBeenCalledWith({ workspace_id: 1, include_inactive: true }, expect.any(AbortSignal));
    expect(roleCards(game("Overwatch")!)).toEqual(["Tank", "Damage", "Support"]);
    expect(roleCards(game("League of Legends")!)).toEqual(["Top", "Jungle", "Mid", "Bot", "Support"]);
    expect(game("Overwatch")?.textContent).toContain("Main Tank");
    expect(game("Overwatch")?.textContent).not.toContain("Solo Top");
    expect(game("League of Legends")?.textContent).toContain("Solo Top");
  });

  it("adds a sub-role in the game of the card it is typed into", async () => {
    await mount();

    const input = container.querySelector<HTMLInputElement>('input[aria-label="New sub-role for Top"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Solo");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.form!.requestSubmit();
      await tick();
    });

    expect(createPlayerSubRole).toHaveBeenCalledWith({ workspace_id: 1, discipline: "lol", role: "top", label: "Solo" });
  });

  it("says so with a retry where one game's roles fail to load, the other game still shown", async () => {
    failingMetadata = "lol";
    await mount();

    expect(roleCards(game("Overwatch")!)).toEqual(["Tank", "Damage", "Support"]);
    const retry = [...game("League of Legends")!.querySelectorAll("button")].find(
      (node) => node.textContent?.trim() === "Retry"
    );
    await click(retry!);
    expect(refetchMetadata).toHaveBeenCalledTimes(1);
  });
});

describe("the game filter", () => {
  it("narrows the page to the picked game, without a game heading or a second read", async () => {
    await mount();

    await pickGame("League of Legends");

    expect(search().get("discipline")).toBe("lol");
    expect(container.querySelector("h2")).toBeNull();
    expect(roleCards()).toEqual(["Top", "Jungle", "Mid", "Bot", "Support"]);
    expect(container.textContent).not.toContain("Main Tank");
    expect(getPlayerSubRoles).toHaveBeenCalledTimes(1);
  });

  it("lists every game again when the game is cleared", async () => {
    window.history.replaceState(null, "", "/admin/settings/sub-roles?discipline=lol");
    await mount();

    await pickGame("All games");

    expect(search().has("discipline")).toBe(false);
    expect(game("Overwatch")?.textContent).toContain("Main Tank");
    expect(game("League of Legends")?.textContent).toContain("Solo Top");
  });
});
