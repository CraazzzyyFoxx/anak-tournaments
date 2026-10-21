// @vitest-environment happy-dom
//
// The settings outline: a page's `SettingGroup`s as links under the active
// rail item. What is pinned here:
//  1. links follow the page's order, including a group that renders late in
//     the middle (a permission-gated group, a section that loads after the
//     rest) — a registry that appended would list it last;
//  2. a page with fewer than three groups gets no outline: it is not a choice;
//  3. following a link scrolls to the group and rewrites the fragment in place,
//     without stacking a history entry per click.
import { act, forwardRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SectionNav } from "@/components/kit/SectionNav";
import { SettingGroup } from "@/components/kit/SettingRow";
import { SettingsOutlineProvider } from "@/components/kit/SettingsOutline";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() })
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

const NAV = [
  {
    items: [
      { key: "overview", label: "Overview", href: "/admin/settings" },
      { key: "profile", label: "Profile", href: "/admin/settings/general" }
    ]
  }
];

let container: HTMLDivElement;
let root: Root;
const scrollIntoView = vi.fn();

async function render(groups: readonly string[]) {
  await act(async () => {
    root.render(
      <SettingsOutlineProvider>
        <SectionNav groups={NAV} activeKey="profile" />
        {groups.map((id) => (
          <SettingGroup key={id} id={id} title={`Group ${id}`}>
            <p>{id}</p>
          </SettingGroup>
        ))}
      </SettingsOutlineProvider>
    );
  });
}

const outlineLinks = () =>
  [...container.querySelectorAll<HTMLAnchorElement>("nav ul ul a")].map((link) =>
    link.getAttribute("href")
  );

beforeEach(() => {
  window.history.replaceState(null, "", "/admin/settings/general");
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("SettingsOutline", () => {
  it("lists the page's groups in page order, a late group in its place", async () => {
    await render(["identity", "links", "games"]);
    expect(outlineLinks()).toEqual(["#identity", "#links", "#games"]);

    await render(["identity", "community", "links", "games"]);
    expect(outlineLinks()).toEqual(["#identity", "#community", "#links", "#games"]);
  });

  it("offers no outline for a page of two groups", async () => {
    await render(["listing", "newcomers"]);
    expect(outlineLinks()).toEqual([]);
  });

  it("jumps to a group and rewrites the fragment without a history entry", async () => {
    await render(["identity", "community", "links"]);
    const before = window.history.length;
    const link = container.querySelector<HTMLAnchorElement>('nav ul ul a[href="#links"]')!;

    await act(async () => {
      link.click();
    });

    expect(window.location.hash).toBe("#links");
    expect(window.history.length).toBe(before);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById("links"));
    expect(link.getAttribute("aria-current")).toBe("true");
  });
});
