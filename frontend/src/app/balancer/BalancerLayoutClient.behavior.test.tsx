// @vitest-environment happy-dom
//
// The pickup mix tool used to replace the site shell entirely: its own top
// bar, the `.admin-theme` palette, a fixed full-viewport frame. Hosting a mix
// is a member-level grant, read by the same audience as the rest of the
// site, so its shell must be the site's own — `Header` above the tool
// content, `Footer` below it, no `.admin-theme` class anywhere in the tree.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/balancer/pickup",
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isLoaded: true,
    isOrganizer: true,
    canAccessAdminRoute: () => true,
    canAccessPermission: () => true,
  }),
}));

vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (selector: (s: { currentWorkspaceId: number | null }) => unknown) =>
    selector({ currentWorkspaceId: 1 }),
}));

vi.mock("@/app/balancer/useToolContext", () => ({
  useToolContext: () => ({ status: "ready", summary: null }),
}));

vi.mock("@/components/Header", () => ({
  default: () => <header data-testid="site-header">site header</header>,
}));

vi.mock("@/components/Footer", () => ({
  Footer: () => <footer data-testid="site-footer">site footer</footer>,
}));

import { BalancerLayoutClient } from "./BalancerLayoutClient";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("BalancerLayoutClient on /balancer/pickup", () => {
  it("renders the site Header and Footer around the tool content instead of the admin shell", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <BalancerLayoutClient>
          <div data-testid="tool-content">mix tool</div>
        </BalancerLayoutClient>,
      );
    });

    const header = container.querySelector('[data-testid="site-header"]');
    const footer = container.querySelector('[data-testid="site-footer"]');
    const content = container.querySelector('[data-testid="tool-content"]');
    expect(header).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(content).not.toBeNull();

    // Header, then the tool content, then Footer, in that document order —
    // one cohesive shell instead of the tool's own top bar stacked above it.
    const all = [...container.querySelectorAll("*")];
    const order = [header, content, footer].map((node) => all.indexOf(node as Element));
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);

    // The admin-theme palette and the old standalone tool top bar are gone.
    expect(container.querySelector(".admin-theme")).toBeNull();
    expect(container.textContent).not.toContain("Back to site");

    act(() => root.unmount());
    container.remove();
  });
});
