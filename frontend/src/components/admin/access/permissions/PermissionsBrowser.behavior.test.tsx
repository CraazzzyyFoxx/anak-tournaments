// @vitest-environment happy-dom
//
// Access › Permissions — the access map: one row per permission, one column
// per role. What is pinned here: a role marks the permissions it holds, and a
// held `resource.*` wildcard marks every action of that resource it covers.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionsBrowser } from "./PermissionsBrowser";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isSuperuser: true,
    hasPermission: () => true,
    canAccessAnyPermission: () => true
  })
}));

vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (selector: (state: { workspaces: unknown[] }) => unknown) =>
    selector({ workspaces: [] })
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/access/permissions",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  )
}));

const permission = (id: number, resource: string, action: string) => ({
  id,
  name: `${resource}.${action}`,
  resource,
  action,
  description: null,
  created_at: "2026-01-01"
});

const PERMISSIONS = [
  permission(1, "match", "read"),
  permission(2, "match", "update"),
  permission(3, "match", "*"),
  permission(4, "team", "read")
];

const role = (id: number, name: string) => ({
  id,
  name,
  is_system: false,
  workspace_id: null,
  created_at: "2026-01-01"
});

const GRANTS: Record<number, typeof PERMISSIONS> = {
  1: [PERMISSIONS[2]],
  2: [PERMISSIONS[0]]
};

vi.mock("@/services/rbac.service", () => ({
  rbacService: {
    listRolesAll: async () => [role(1, "caster"), role(2, "viewer")],
    getRole: async (id: number) => ({ ...role(id, ""), permissions: GRANTS[id] }),
    listPermissionsAll: async () => PERMISSIONS
  }
}));

const mounted: { root: Root; container: HTMLElement }[] = [];

async function settle(turns = 8) {
  for (let turn = 0; turn < turns; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
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
        <PermissionsBrowser />
      </QueryClientProvider>
    );
  });
  await settle();
  return container;
}

/** Each role's mark on one permission row, in column order. */
function marks(container: HTMLElement, permissionId: number) {
  const row = container.querySelector(`tr[data-row-id="${permissionId}"]`);
  if (!row) return null;
  return Array.from(row.querySelectorAll("td .sr-only"), (mark) => mark.textContent);
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.matchMedia = ((query: string) => ({
    matches: query.includes("min-width"),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
});

afterEach(async () => {
  await act(async () => {
    for (const { root, container } of mounted.splice(0)) {
      root.unmount();
      container.remove();
    }
  });
});

describe("Access › Permissions · access map", () => {
  it("marks held permissions, counting a resource wildcard as what it covers", async () => {
    const container = await mount();

    // caster holds `match.*`, viewer holds `match.read`.
    expect(marks(container, 1)).toEqual(["Granted", "Granted"]);
    expect(marks(container, 2)).toEqual(["Granted", "Not granted"]);
    expect(marks(container, 4)).toEqual(["Not granted", "Not granted"]);
    // The wildcard itself is not a row.
    expect(marks(container, 3)).toBeNull();
  });
});
