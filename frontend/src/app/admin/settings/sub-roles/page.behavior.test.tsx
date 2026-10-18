// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkspaceSubRolesSettingsPage from "./page";
import type { PlayerSubRole } from "@/types/admin.types";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const getPlayerSubRoles = vi.fn();
const createPlayerSubRole = vi.fn();
const updatePlayerSubRole = vi.fn();
const deletePlayerSubRole = vi.fn();
let discipline = "overwatch";
let denied: string[] = [];
vi.mock("@/services/admin.service", () => ({ default: {
  getPlayerSubRoles: (...args: unknown[]) => getPlayerSubRoles(...args), createPlayerSubRole: (...args: unknown[]) => createPlayerSubRole(...args),
  updatePlayerSubRole: (...args: unknown[]) => updatePlayerSubRole(...args), deletePlayerSubRole: (...args: unknown[]) => deletePlayerSubRole(...args)
} }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ canAccessPermission: (permission: string) => !denied.includes(permission) }) }));
vi.mock("@/stores/workspace.store", () => ({ useWorkspaceStore: (selector: (state: { currentWorkspaceId: number }) => unknown) => selector({ currentWorkspaceId: 1 }) }));
vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), apiError: vi.fn() } }));
vi.mock("@/hooks/useBrowsingDiscipline", () => ({ useBrowsingDiscipline: () => ({ axis: 1, resolved: { kind: "concrete", code: discipline }, disciplines: [], select: vi.fn(), refetch: vi.fn(), isError: false }) }));
vi.mock("@/components/workspace/DisciplineSelector", () => ({ DisciplineSelector: () => null, DisciplineUnavailable: () => null }));
vi.mock("@/hooks/useDisciplineMetadata", () => ({ useDisciplineMetadata: (_axis: number, code: string) => ({ data: {
  discipline: { code }, workspace_id: 1,
  dimensions: [{ id: 1, code: "position", name: "Position", rated: true, active: true, selection_mode: "single", sort_order: 0 }],
  roles: (code === "lol" ? ["top", "jungle", "mid", "bottom", "support"] : ["tank", "damage", "support"]).map((role, i) => ({ id: i + 1, dimension: "position", code: role, name: role[0].toUpperCase() + role.slice(1), parent_id: null, workspace_id: null, active: true, selectable: true, sort_order: i, attrs: { icon: `/disciplines/${code}/roles/${role}.svg` } }))
}, isError: false, refetch: vi.fn() }) }));
const CATALOG: PlayerSubRole[] = [{ id: 11, workspace_id: 1, discipline: "overwatch", dimension: "position", role: "tank", slug: "main", label: "Main Tank", description: null, sort_order: 0, is_active: true, attrs: { color: "#123456" } }, { id: 12, workspace_id: 1, discipline: "overwatch", dimension: "position", role: "tank", slug: "off", label: "Off Tank", description: null, sort_order: 1, is_active: false, attrs: { icon: null } }];
let root: Root | undefined;
let container: HTMLDivElement;
let client: QueryClient;
function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}
async function renderPage() {
  await act(async () => { root!.render(<QueryClientProvider client={client}><WorkspaceSubRolesSettingsPage /></QueryClientProvider>); await tick(); });
  // TanStack notifies after the mount commit starts the read, not during root.render().
  await act(async () => { await tick(); });
}
async function mount() { container = document.createElement("div"); document.body.append(container); root = createRoot(container); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); await renderPage(); }
async function click(node: Element) { await act(async () => { node.dispatchEvent(new MouseEvent("click", { bubbles: true })); await tick(); }); }
function toggle(label: string) { return [...container.querySelectorAll('[role="switch"]')].find(node => node.getAttribute("aria-label") === label)!; }
beforeEach(() => { discipline = "overwatch"; denied = []; getPlayerSubRoles.mockReset().mockResolvedValue(CATALOG); createPlayerSubRole.mockReset().mockResolvedValue(CATALOG[0]); updatePlayerSubRole.mockReset().mockResolvedValue(CATALOG[0]); deletePlayerSubRole.mockReset().mockResolvedValue(undefined); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); client?.clear(); container?.remove(); root = undefined; });

describe("native sub-role settings", () => {
  it("passes explicit discipline, includes retired children, and preserves delete/restore permission paths", async () => {
    await mount();
    expect(getPlayerSubRoles).toHaveBeenCalledWith({ workspace_id: 1, discipline: "overwatch", include_inactive: true }, expect.any(AbortSignal));
    expect(container.textContent).toContain("Off Tank");
    await click(toggle("Deactivate Main Tank"));
    expect(deletePlayerSubRole).toHaveBeenCalledWith(11);
    await click(toggle("Restore Off Tank"));
    expect(updatePlayerSubRole).toHaveBeenCalledWith(12, { is_active: true });
  });
  it("renders five LoL parents rather than three fixed role columns", async () => {
    discipline = "lol"; getPlayerSubRoles.mockResolvedValue([]); await mount();
    expect([...container.querySelectorAll("h2")].map(node => node.textContent)).toEqual(["Top", "Jungle", "Mid", "Bottom", "Support"]);
    expect(getPlayerSubRoles).toHaveBeenCalledWith({ workspace_id: 1, discipline: "lol", include_inactive: true }, expect.any(AbortSignal));
  });
  it("creates a child in the captured discipline without implicitly writing presentation overrides", async () => {
    discipline = "lol"; getPlayerSubRoles.mockResolvedValue([]); await mount();
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Name for Top"]') ?? container.querySelector<HTMLInputElement>("input")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Solo"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    const add = [...container.querySelectorAll("button")].find(node => node.textContent?.trim() === "Add")!;
    await click(add);
    expect(createPlayerSubRole).toHaveBeenCalledWith({ workspace_id: 1, discipline: "lol", role: "top", label: "Solo" });
  });
  it("cancels old reads and does not render delayed previous-game children", async () => {
    const old = Promise.withResolvers<PlayerSubRole[]>(); let oldSignal: AbortSignal | undefined;
    getPlayerSubRoles.mockImplementation((params: { discipline: string }, signal: AbortSignal) => { if (params.discipline === "overwatch") { oldSignal = signal; return old.promise; } return Promise.resolve([]); });
    await mount(); discipline = "lol"; await renderPage();
    await act(async () => { old.resolve(CATALOG); await old.promise; });
    expect(oldSignal?.aborted).toBe(true);
    expect(container.textContent).not.toContain("Off Tank");
    expect(container.textContent).toContain("Jungle");
  });
  it("can explicitly clear both inherited icons and stored colors without touching the name", async () => {
    await mount();
    const clearIcon = container.querySelector('[aria-label="Clear Icon URL for Main Tank"]')!;
    const clearColor = container.querySelector('[aria-label="Clear Color (#RRGGBB) for Main Tank"]')!;
    await click(clearIcon);
    await click(clearColor);
    expect(updatePlayerSubRole).toHaveBeenCalledWith(11, { icon: null });
    expect(updatePlayerSubRole).toHaveBeenCalledWith(11, { color: null });
    expect(updatePlayerSubRole.mock.calls.every(([, patch]) => !("label" in patch))).toBe(true);
  });
  it("hides create and gates delete independently from restore", async () => {
    denied = ["player.create", "player.delete"]; await mount();
    expect([...container.querySelectorAll("button")].filter(node => node.textContent?.trim() === "Add")).toHaveLength(0);
    expect(toggle("Deactivate Main Tank").hasAttribute("disabled")).toBe(true);
    expect(toggle("Restore Off Tank").hasAttribute("disabled")).toBe(false);
  });
});
