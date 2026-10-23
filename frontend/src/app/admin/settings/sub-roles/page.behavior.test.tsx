// @vitest-environment happy-dom
//
// The sub-role catalog for one game. What is pinned here:
//  1. every sub-role sits in its own parent role's card, and switched-off ones
//     stay folded until asked for;
//  2. switching one off (in its editor) deactivates it (DELETE), saving any
//     edits first; "Restore" in the fold brings it back (PATCH is_active), each
//     behind its own grant;
//  3. a sub-role is added in its role's card: the game and parent come from the
//     card, never from a picker;
//  4. the editor sends only what changed, can set colour and icon to none, and
//     refuses a colour or icon the server would refuse, at the field.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayerSubRole } from "@/types/admin.types";
import WorkspaceSubRolesSettingsPage from "./page";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getPlayerSubRoles = vi.fn();
const createPlayerSubRole = vi.fn();
const updatePlayerSubRole = vi.fn();
const deletePlayerSubRole = vi.fn();
let denied: string[] = [];

vi.mock("@/services/admin.service", () => ({
  default: {
    getPlayerSubRoles: (...args: unknown[]) => getPlayerSubRoles(...args),
    createPlayerSubRole: (...args: unknown[]) => createPlayerSubRole(...args),
    updatePlayerSubRole: (...args: unknown[]) => updatePlayerSubRole(...args),
    deletePlayerSubRole: (...args: unknown[]) => deletePlayerSubRole(...args)
  }
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ canAccessPermission: (permission: string) => !denied.includes(permission) })
}));
vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (selector: (state: { currentWorkspaceId: number }) => unknown) =>
    selector({ currentWorkspaceId: 1 })
}));
vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), apiError: vi.fn() } }));
vi.mock("@/hooks/useGameScope", async () => {
  // vi.mock factories run hoisted above static imports, so the helper is imported here.
  const { gameScopeState } = await import("@/test/game-scope");
  return { useGameScope: () => gameScopeState("overwatch") };
});
vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search)
}));
vi.mock("@/hooks/useDisciplineMetadata", () => ({
  useDisciplineMetadata: (_axis: number, code: string) => ({
    data: {
      discipline: { code },
      workspace_id: 1,
      dimensions: [
        { id: 1, code: "position", name: "Position", rated: true, active: true, selection_mode: "single", sort_order: 0 }
      ],
      roles: ["tank", "damage", "support"].map((role, i) => ({
        id: i + 1,
        dimension: "position",
        code: role,
        name: role[0].toUpperCase() + role.slice(1),
        parent_id: null,
        workspace_id: null,
        active: true,
        selectable: true,
        sort_order: i,
        attrs: { icon: `/disciplines/${code}/roles/${role}.svg`, color: "#3388ff" }
      }))
    },
    isError: false,
    refetch: vi.fn()
  })
}));

const MAIN_TANK: PlayerSubRole = {
  id: 11, workspace_id: 1, discipline: "overwatch", dimension: "position", role: "tank", slug: "main",
  label: "Main Tank", description: "Holds space", sort_order: 0, is_active: true, attrs: { color: "#123456" }
};
const OFF_TANK: PlayerSubRole = {
  id: 12, workspace_id: 1, discipline: "overwatch", dimension: "position", role: "tank", slug: "off",
  label: "Off Tank", description: null, sort_order: 1, is_active: false, attrs: { icon: null }
};

let root: Root | undefined;
let container: HTMLDivElement;

function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}
async function settle() {
  for (let turn = 0; turn < 3; turn += 1) {
    await act(async () => {
      await tick();
    });
  }
}
async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root!.render(
      <QueryClientProvider client={client}>
        <WorkspaceSubRolesSettingsPage />
      </QueryClientProvider>
    );
  });
  await settle();
}
async function click(node: Element | undefined | null) {
  expect(node).toBeTruthy();
  await act(async () => {
    node!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}
async function type(input: HTMLInputElement | null, value: string) {
  expect(input).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
/** A role's card, by the role's heading. */
function card(role: string) {
  return [...container.querySelectorAll("section")].find(
    (section) => section.querySelector(":scope > header > h3")?.textContent === role
  );
}
const editRow = (name: string) => container.querySelector(`button[aria-label="Edit ${name}"]`);
const restore = (name: string) => container.querySelector(`button[aria-label="Restore ${name}"]`);
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === text);

beforeEach(() => {
  denied = [];
  getPlayerSubRoles.mockReset().mockResolvedValue([MAIN_TANK, OFF_TANK]);
  createPlayerSubRole.mockReset().mockResolvedValue(MAIN_TANK);
  updatePlayerSubRole.mockReset().mockResolvedValue(MAIN_TANK);
  deletePlayerSubRole.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  document.body.innerHTML = "";
  root = undefined;
});

describe("sub-role catalog", () => {
  it("files each sub-role under its parent role, folding the switched-off ones", async () => {
    await mount();

    expect(card("Tank")?.textContent).toContain("Main Tank");
    expect(card("Tank")?.textContent).toContain("Holds space");
    expect(card("Damage")?.textContent).not.toContain("Main Tank");
    expect(card("Tank")?.textContent).not.toContain("Off Tank");

    await click(button("1 switched off"));
    expect(card("Tank")?.textContent).toContain("Off Tank");
  });

  it("switches off in the editor and restores from the fold, each through its own endpoint", async () => {
    await mount();

    await click(editRow("Main Tank"));
    await click(button("Switch off"));
    expect(deletePlayerSubRole).toHaveBeenCalledWith(11);
    expect(updatePlayerSubRole).not.toHaveBeenCalled();

    await click(button("1 switched off"));
    await click(restore("Off Tank"));
    expect(updatePlayerSubRole).toHaveBeenCalledWith(12, { is_active: true });
  });

  it("saves pending edits before switching off, so nothing typed is lost", async () => {
    await mount();
    await click(editRow("Main Tank"));

    await type(document.querySelector<HTMLInputElement>("#sub-role-label"), "Anchor");
    await click(button("Switch off"));

    expect(updatePlayerSubRole).toHaveBeenCalledWith(11, { label: "Anchor" });
    expect(deletePlayerSubRole).toHaveBeenCalledWith(11);
    expect(updatePlayerSubRole.mock.invocationCallOrder[0]).toBeLessThan(
      deletePlayerSubRole.mock.invocationCallOrder[0]
    );
  });

  it("gates adding, switching off, restoring and editing each on its own grant", async () => {
    denied = ["player.create", "player.delete"];
    await mount();

    expect(container.querySelector('input[aria-label="New sub-role for Tank"]')).toBeNull();
    await click(button("1 switched off"));
    expect(restore("Off Tank")).toBeTruthy();
    await click(editRow("Main Tank"));
    expect(button("Save")).toBeTruthy();
    expect(button("Switch off")).toBeUndefined();

    await act(async () => root!.unmount());
    root = undefined;
    document.body.innerHTML = "";
    denied = ["player.update"];
    await mount();
    expect(editRow("Main Tank")).toBeNull();
    await click(button("1 switched off"));
    expect(restore("Off Tank")).toBeNull();
    expect(card("Tank")?.textContent).toContain("Off Tank");
  });

  it("adds a sub-role under the card's own game and role", async () => {
    await mount();

    const input = container.querySelector<HTMLInputElement>('input[aria-label="New sub-role for Damage"]');
    await type(input, "  Hitscan ");
    await act(async () => {
      input!.form!.requestSubmit();
    });
    await settle();

    expect(createPlayerSubRole).toHaveBeenCalledWith({
      workspace_id: 1,
      discipline: "overwatch",
      role: "damage",
      label: "Hitscan"
    });
    expect(input!.value).toBe("");
  });

  it("sends only the fields that changed, and can set colour and icon to none", async () => {
    await mount();
    await click(container.querySelector('button[aria-label="Edit Main Tank"]'));

    await click(document.querySelector('[aria-label="Remove Icon of Main Tank"]'));
    await click(document.querySelector('[aria-label="Remove Colour of Main Tank"]'));
    await click(button("Save"));

    expect(updatePlayerSubRole).toHaveBeenCalledTimes(1);
    expect(updatePlayerSubRole).toHaveBeenCalledWith(11, { icon: null, color: null });
  });

  it("refuses a colour the server would refuse, at the field, without saving", async () => {
    await mount();
    await click(container.querySelector('button[aria-label="Edit Main Tank"]'));

    await type(document.querySelector<HTMLInputElement>("#sub-role-11-color"), "red");
    await click(button("Save"));

    expect(updatePlayerSubRole).not.toHaveBeenCalled();
    const field = document.querySelector("#sub-role-11-color");
    expect(field?.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(field!.getAttribute("aria-describedby")!)?.textContent).toContain("#RRGGBB");
  });
});
