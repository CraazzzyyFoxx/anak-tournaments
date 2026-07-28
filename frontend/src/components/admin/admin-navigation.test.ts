import { describe, expect, it } from "bun:test";

import { getMatchingAdminRoute, getVisibleAdminNavigationGroups } from "@/components/admin/admin-navigation";

describe("admin navigation visibility", () => {
  it("shows workspace-admin entries when the access callback allows workspace-admin items", () => {
    const groups = getVisibleAdminNavigationGroups((item) => item.workspaceAdminVisible === true);
    const hrefs = groups.flatMap((group) => group.items.map((item) => item.href));

    expect(hrefs).toContain("/admin/divisions");
    expect(hrefs).toContain("/admin/workspaces");
    expect(hrefs).toContain("/admin/workspaces/members");
  });

  it("keeps global-only admin pages hidden when only workspace access is available", () => {
    const groups = getVisibleAdminNavigationGroups((item) => item.workspaceAdminVisible === true);
    const hrefs = groups.flatMap((group) => group.items.map((item) => item.href));

    expect(hrefs).not.toContain("/admin/access/users");
    expect(hrefs).not.toContain("/admin/access/oauth");
    expect(hrefs).not.toContain("/admin/access/permissions");
  });

  it("keeps game content out of reach for non-superusers", () => {
    const groups = getVisibleAdminNavigationGroups((item) => item.superuserOnly !== true);
    const hrefs = groups.flatMap((group) => group.items.map((item) => item.href));

    for (const href of ["/admin/heroes", "/admin/gamemodes", "/admin/maps"]) {
      expect(hrefs).not.toContain(href);
      expect(getMatchingAdminRoute(href)?.superuserOnly).toBe(true);
    }
  });
});
