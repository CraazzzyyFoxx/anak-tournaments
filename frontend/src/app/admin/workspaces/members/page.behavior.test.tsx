// @vitest-environment happy-dom
//
// The members table's role filter, after it moved out of the toolbar and into
// the "Role" column header. What is pinned here:
//  1. the funnel's options come from the workspace's role catalogue, not a
//     hardcoded list -- custom roles are filterable too;
//  2. picking one refetches with the endpoint's own `role_id`, as a number:
//     the header filter carries values as strings, `getMembers` takes an int;
//  3. `?role_id=` survives a reload, so a shared link lands on the same view.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import WorkspaceMembersPage from "./page";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getMembers = vi.fn();
const listRolesAll = vi.fn();

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/workspaces/members"
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ isSuperuser: true, canAccessAnyPermission: () => true })
}));
vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (
    selector: (state: {
      currentWorkspaceId: number;
      getCurrentWorkspace: () => { name: string };
    }) => unknown
  ) => selector({ currentWorkspaceId: 1, getCurrentWorkspace: () => ({ name: "Anak" }) })
}));
vi.mock("@/services/rbac.service", () => ({
  rbacService: {
    listRolesAll: (...args: unknown[]) => listRolesAll(...args),
    listUsersAll: () => Promise.resolve([])
  }
}));
vi.mock("@/services/workspace.service", () => ({
  default: {
    getMembers: (...args: unknown[]) => getMembers(...args),
    addMember: vi.fn(),
    removeMember: vi.fn(),
    updateMemberRole: vi.fn(),
    autofillMemberRoles: vi.fn()
  }
}));
vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() }
}));

// `caster` is deliberately custom: the toolbar select listed every scoped role,
// and the header filter has to keep doing that rather than fall back to the
// five system role names the row editor uses.
const ROLES = [
  { id: 3, name: "admin", is_system: true, description: null },
  { id: 4, name: "member", is_system: true, description: null },
  { id: 9, name: "caster", is_system: false, description: "Streams matches" }
];

let container: HTMLElement;
let root: Root;

function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

async function render(search = "") {
  window.history.replaceState(null, "", `/admin/workspaces/members${search}`);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <WorkspaceMembersPage />
      </QueryClientProvider>
    );
  });
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      await tick();
    });
  }
}

async function click(element: Element | null | undefined) {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
  });
}

function funnel() {
  return container.querySelector<HTMLButtonElement>('button[aria-label^="Filter by role"]');
}

function lastRoleId(): unknown {
  return (getMembers.mock.calls.at(-1)?.[1] as { role_id?: unknown } | undefined)?.role_id;
}

beforeEach(() => {
  getMembers.mockReset().mockResolvedValue({ results: [], total: 0, page: 1, per_page: 25 });
  listRolesAll.mockReset().mockResolvedValue(ROLES);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("WorkspaceMembersPage role filter", () => {
  it("no longer offers a role select in the toolbar", async () => {
    await render();
    const toolbarSelect = [...container.querySelectorAll("[aria-label='Filter by role']")].find(
      (node) => node.getAttribute("role") === "combobox"
    );
    expect(toolbarSelect).toBeUndefined();
    expect(funnel()).not.toBeNull();
  });

  it("offers every scoped role, custom ones included", async () => {
    await render();
    await click(funnel());
    expect(
      [...document.querySelectorAll('[cmdk-item=""]')].map((item) => item.textContent?.trim())
    ).toEqual(["admin", "member", "caster"]);
  });

  it("refetches with role_id as a number when a role is picked", async () => {
    await render();
    expect(lastRoleId()).toBeNull();

    await click(funnel());
    await click(
      [...document.querySelectorAll('[cmdk-item=""]')].find(
        (item) => item.textContent?.trim() === "caster"
      )
    );

    expect(lastRoleId()).toBe(9);
    expect(window.location.search).toContain("role_id=9");
  });

  it("applies role_id from the URL on load", async () => {
    await render("?role_id=9");
    expect(lastRoleId()).toBe(9);
  });
});
