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
  useWorkspaceStore: (selector: (state: { currentWorkspaceId: number; lastGame: string | null }) => unknown) =>
    selector({ currentWorkspaceId: 1, lastGame: null })
}));
vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), apiError: vi.fn() } }));
vi.mock("@/hooks/useGameScope", async () => {
  const { gameScopeState } = await import("@/test/game-scope");
  return { useGameScope: () => gameScopeState(null) };
});
vi.mock("@/hooks/useGameDescriptors", async () => {
  const { GAME_DESCRIPTORS } = await import("@/test/game-scope");
  return { useGameDescriptors: () => GAME_DESCRIPTORS };
});
// The owner lock is the store's; here it only has to report which game the opened sub-role names.
vi.mock("@/components/workspace/EntityWorkspace", () => ({
  EntityWorkspace: ({ discipline }: { discipline?: string | null }) => <span data-owner-game={discipline ?? ""} />
}));
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
  useDisciplineMetadata: (_axis: number, code: string | null) => ({
    data:
      code === null
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
                // An icon, so a role heading's text is its name rather than the monogram fallback.
                attrs: { icon: `/disciplines/${code}/roles/${role}.svg` }
              })
            )
          },
    isError: false,
    refetch: vi.fn()
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
function button(text: string) {
  return [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === text)!;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/admin/settings/sub-roles");
  push.mockClear();
  getPlayerSubRoles.mockReset().mockResolvedValue(CATALOG);
  createPlayerSubRole.mockReset().mockResolvedValue(CATALOG[1]);
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
  it("lists every game's sub-roles grouped under each game, without naming a game", async () => {
    await mount();

    expect(getPlayerSubRoles).toHaveBeenCalledWith({ workspace_id: 1, include_inactive: true }, expect.any(AbortSignal));
    expect(container.textContent).toContain("Overwatch");
    expect(container.textContent).toContain("League of Legends");
    expect(container.textContent).toContain("Main Tank");
    expect(container.textContent).toContain("Solo Top");
    // Each row is "parent › sub-role", the parent named from its own game's ontology.
    expect(container.textContent).toContain("Tank›Main Tank");
    expect(container.textContent).toContain("Top›Solo Top");
  });

  it("creates a sub-role in the game and parent picked in the dialog", async () => {
    await mount();
    await click(button("New sub-role"));

    const games = document.getElementById("sub-role-game")!.querySelectorAll('[role="radio"]');
    await click(games[1]);
    await click([...document.querySelectorAll('[role="radio"]')].find((node) => node.textContent === "Top")!);
    const input = document.querySelector<HTMLInputElement>("#sub-role-label")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Solo");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Save"));

    expect(createPlayerSubRole).toHaveBeenCalledWith({ workspace_id: 1, discipline: "lol", role: "top", label: "Solo" });
  });

  it("opens a sub-role in its own game's editor and locks the pill to that game", async () => {
    await mount();
    await click([...container.querySelectorAll("button")].find((node) => node.textContent?.includes("Main Tank"))!);

    const pushed = new URLSearchParams(push.mock.calls.at(-1)![0].split("?")[1]);
    expect(pushed.get("sub_role")).toBe("11");
    expect(pushed.get("role")).toBe("tank");
    expect(container.querySelector("[data-owner-game]")?.getAttribute("data-owner-game")).toBe("overwatch");
    expect([...container.querySelectorAll("h2")].map((node) => node.textContent)).toContain("Tank");
  });
});
