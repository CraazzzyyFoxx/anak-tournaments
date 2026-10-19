// @vitest-environment happy-dom
//
// The chrome both workspace-settings shells share. What is pinned here:
//  1. section <-> route: the URL alone decides the heading, which rail page is
//     current and which of its tabs is, so a shared link opens the section it
//     names;
//  2. a child screen of a section keeps that section current —
//     `/admin/settings/divisions/import` is Divisions, not a blank rail. The
//     active key comes from the first segment after `basePath`, never the last
//     segment of the path;
//  3. the superuser shell (`/admin/workspaces/[id]`) rails and tabs only the
//     sections it actually routes, so it cannot link to a 404;
//  4. the bare root of either shell is the overview: its rail item links to the
//     root itself (there is no `/overview` route) and is current there.
import { act, forwardRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/i18n/messages/en.json";

import { WORKSPACE_RECORD_SECTIONS } from "./sections";
import { WorkspaceSettingsShell } from "./WorkspaceSettingsShell";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let pathname = "/admin/settings/general";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() })
}));

vi.mock("next/link", () => ({
  default: forwardRef<
    HTMLAnchorElement,
    { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>
  >(function Link({ href, children, ...props }, ref) {
    return (
      <a ref={ref} href={href} {...props}>
        {children}
      </a>
    );
  })
}));

let container: HTMLDivElement;
let root: Root;

async function render(node: React.ReactNode) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {node}
      </NextIntlClientProvider>
    )
  );
}

/** The rail's links only — the narrow-viewport `Select` renders the same list. */
function railLinks() {
  return [
    ...container.querySelectorAll('nav[aria-label="Settings sections"] a')
  ] as HTMLAnchorElement[];
}

function currentLabel() {
  return railLinks()
    .find((link) => link.getAttribute("aria-current") === "page")
    ?.textContent?.trim();
}

/** The page's routed tabs: every `<nav>` that is not the rail. */
function tabLinks() {
  return [
    ...container.querySelectorAll('nav:not([aria-label="Settings sections"]) a')
  ] as HTMLAnchorElement[];
}

function currentTab() {
  return tabLinks()
    .find((link) => link.getAttribute("aria-current") === "page")
    ?.textContent?.trim();
}

beforeEach(() => {
  pathname = "/admin/settings/general";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("WorkspaceSettingsShell", () => {
  it("names the page that owns the URL's section, and makes that page and that tab current", async () => {
    pathname = "/admin/settings/branding";
    await render(
      <WorkspaceSettingsShell basePath="/admin/settings">
        <p>section body</p>
      </WorkspaceSettingsShell>
    );

    expect(container.querySelector("h1")?.textContent).toBe("Profile");
    expect(currentLabel()).toBe("Profile");
    expect(railLinks().filter((link) => link.getAttribute("aria-current"))).toHaveLength(1);
    expect(tabLinks().map((link) => link.getAttribute("href"))).toEqual([
      "/admin/settings/general",
      "/admin/settings/branding",
      "/admin/settings/visibility"
    ]);
    expect(currentTab()).toBe("Branding");
    expect(container.textContent).toContain("section body");
  });

  it("draws no tab row for a page of one section", async () => {
    pathname = "/admin/settings/domain";
    await render(
      <WorkspaceSettingsShell basePath="/admin/settings">
        <p />
      </WorkspaceSettingsShell>
    );

    expect(container.querySelector("h1")?.textContent).toBe("Domain");
    expect(tabLinks()).toHaveLength(0);
  });

  it("keeps a section current for its child screens", async () => {
    pathname = "/admin/settings/divisions/import";
    await render(
      <WorkspaceSettingsShell basePath="/admin/settings">
        <p>import wizard</p>
      </WorkspaceSettingsShell>
    );

    expect(container.querySelector("h1")?.textContent).toBe("Divisions");
    expect(currentLabel()).toBe("Divisions");
  });

  it.each([
    ["/admin/settings", undefined],
    ["/admin/workspaces/8", WORKSPACE_RECORD_SECTIONS]
  ] as const)("makes the overview current at the bare root %s", async (basePath, sections) => {
    pathname = basePath;
    await render(
      <WorkspaceSettingsShell basePath={basePath} sections={sections}>
        <p />
      </WorkspaceSettingsShell>
    );

    expect(container.querySelector("h1")?.textContent).toBe("Overview");
    expect(currentLabel()).toBe("Overview");
    expect(container.querySelector('nav a[aria-current="page"]')?.getAttribute("href")).toBe(
      basePath
    );
  });

  it("stands aside entirely for the full-screen division-grid editor", async () => {
    // Next.js nests layouts: the editor's own `v/layout.tsx` cannot remove this
    // one, so the header and the rail would eat a column of its three-column
    // workspace unless the chrome itself steps out of the way.
    pathname = "/admin/settings/divisions/v/12";
    await render(
      <WorkspaceSettingsShell basePath="/admin/settings">
        <p>grid editor</p>
      </WorkspaceSettingsShell>
    );

    expect(container.textContent).toBe("grid editor");
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("nav")).toBeNull();
  });

  it("rails the hub as eight pages, the overview first, each linking to its first section", async () => {
    await render(
      <WorkspaceSettingsShell basePath="/admin/settings">
        <p />
      </WorkspaceSettingsShell>
    );

    expect(railLinks().map((link) => link.getAttribute("href"))).toEqual([
      "/admin/settings",
      "/admin/settings/general",
      "/admin/settings/domain",
      "/admin/settings/discord",
      "/admin/settings/divisions",
      "/admin/settings/sub-roles",
      "/admin/settings/registration-forms",
      "/admin/settings/subscriptions"
    ]);
  });

  it("rails only the routed sections under a workspace id", async () => {
    pathname = "/admin/workspaces/8/general";
    await render(
      <WorkspaceSettingsShell basePath="/admin/workspaces/8" sections={WORKSPACE_RECORD_SECTIONS}>
        <p />
      </WorkspaceSettingsShell>
    );

    expect(railLinks().map((link) => link.getAttribute("href"))).toEqual([
      "/admin/workspaces/8",
      "/admin/workspaces/8/general",
      "/admin/workspaces/8/domain",
      "/admin/workspaces/8/discord"
    ]);
    expect(currentLabel()).toBe("Profile");
    expect(currentTab()).toBe("General");
    expect(tabLinks().map((link) => link.getAttribute("href"))).toEqual([
      "/admin/workspaces/8/general",
      "/admin/workspaces/8/branding",
      "/admin/workspaces/8/visibility"
    ]);
    expect(container.textContent).not.toContain("Divisions");
  });
});
