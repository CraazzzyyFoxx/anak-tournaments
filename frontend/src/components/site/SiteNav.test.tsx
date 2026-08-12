import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

interface TestNavGroup {
  key: string;
  items: { key: string; href: string }[];
}

vi.mock("next/navigation", () => ({ usePathname: () => "/tournaments" }));

const groups = vi.hoisted(() => ({ value: [] as TestNavGroup[] }));

vi.mock("./useVisibleNavGroups", () => ({ useVisibleNavGroups: () => groups.value }));

// Must follow the hoisted vi.mock calls above.
import { SiteNav } from "./SiteNav";

const messages = {
  nav: {
    groups: { tournaments: "Tournaments", organization: "Organization" },
    items: {
      tournaments: { title: "Tournaments", desc: "Every tournament" },
      teams: { title: "Teams", desc: "Team rosters" },
      admin: { title: "Admin", desc: "Manage tournaments" }
    }
  }
};

const MULTI: TestNavGroup = {
  key: "tournaments",
  items: [
    { key: "tournaments", href: "/tournaments" },
    { key: "teams", href: "/teams" }
  ]
};
const SINGLE: TestNavGroup = { key: "organization", items: [{ key: "admin", href: "/admin" }] };

function render(variant: "desktop" | "mobile", value: TestNavGroup[]): string {
  groups.value = value;
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SiteNav variant={variant} />
    </NextIntlClientProvider>
  );
}

// A dropdown that opens onto a single row costs a click and a guess for nothing,
// and labels the destination with a section name it does not have.
describe.each(["desktop", "mobile"] as const)("SiteNav (%s)", (variant) => {
  it("renders a single-item group as a direct link to that item", () => {
    const html = render(variant, [SINGLE]);

    expect(html).toContain('href="/admin"');
    expect(html).toContain("Admin");
    // No disclosure: nothing to expand when there is one destination.
    expect(html).not.toContain("<button");
    // The group label must not appear: the link goes to Admin, not to a section.
    expect(html).not.toContain("Organization");
  });

  it("keeps a multi-item group as a disclosure labelled by the group", () => {
    const html = render(variant, [MULTI]);

    // Both surfaces render the panel lazily, so a closed group shows only its
    // trigger — asserting on the item hrefs here would assert on nothing.
    expect(html).toContain("<button");
    expect(html).toContain("Tournaments");
    expect(html).not.toContain("href=");
  });

  it("marks the single link as the current page when it matches the route", () => {
    const html = render(variant, [
      { key: "organization", items: [{ key: "admin", href: "/tournaments" }] }
    ]);

    expect(html).toContain('aria-current="page"');
  });
});

describe("SiteNav (desktop)", () => {
  it("emits one list for the whole nav, not one per group", () => {
    const html = render("desktop", [MULTI, SINGLE]);

    // N single-item <ul>s announced N separate navigations to assistive tech.
    expect(html.match(/<ul/g)?.length).toBe(1);
  });
});
