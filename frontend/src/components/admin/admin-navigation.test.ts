import { describe, expect, it } from "vitest";

import {
  adminNavItemSearchValue,
  adminNavigationGroups,
  getMatchingAdminRoute,
  getVisibleAdminNavigationGroups,
} from "@/components/admin/admin-navigation";

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

describe("admin navigation lifecycle grouping (D12, §5)", () => {
  it("orders sidebar groups by tournament lifecycle", () => {
    expect(adminNavigationGroups.map((group) => group.title)).toEqual([
      "Overview",
      "Tournaments",
      "Data browser",
      "Workspace",
      "Game content",
      "Administration",
    ]);
  });

  it("keeps the data browser to cross-tournament read pages", () => {
    const group = adminNavigationGroups.find((g) => g.title === "Data browser");
    expect(group?.items.map((item) => item.href)).toEqual([
      "/admin/teams",
      "/admin/players",
      "/admin/encounters",
      "/admin/standings",
    ]);
  });

  it("collects workspace tools including the balancer statuses entry", () => {
    const group = adminNavigationGroups.find((g) => g.title === "Workspace");
    expect(group?.items.map((item) => item.href)).toEqual([
      "/admin/divisions",
      "/admin/balancer",
      "/admin/sub-roles",
      "/admin/achievements",
      "/admin/workspaces/members",
    ]);
  });

  it("gates /admin/balancer by team.read so status readers can open it", () => {
    expect(getMatchingAdminRoute("/admin/balancer")?.permissions).toEqual(["team.read"]);
    expect(getMatchingAdminRoute("/admin/balancer/anything")?.permissions).toEqual(["team.read"]);
  });

  it("gates /admin/sub-roles by player.read, not the broad workspace-admin entry", () => {
    expect(getMatchingAdminRoute("/admin/sub-roles")?.permissions).toEqual(["player.read"]);
    // Must not fall through to the /admin/players prefix or the /admin catch-all.
    expect(getMatchingAdminRoute("/admin/sub-roles")?.prefix).toBe("/admin/sub-roles");
  });

  it("shows the balancer statuses entry to team.read holders", () => {
    const groups = getVisibleAdminNavigationGroups((item) =>
      (item.permissions ?? []).includes("team.read"),
    );
    const hrefs = groups.flatMap((group) => group.items.map((item) => item.href));

    expect(hrefs).toContain("/admin/balancer");
  });
});

describe("admin administration entry and palette aliases (D10, D11)", () => {
  it("exposes staff access as the single administration access entry", () => {
    const admin = adminNavigationGroups.find((g) => g.title === "Administration");
    const hrefs = admin?.items.map((item) => item.href);

    expect(hrefs).toEqual(["/admin/access", "/admin/users", "/admin/rank", "/admin/workspaces"]);
  });

  it("keeps per-tab access route gating after the single-entry collapse", () => {
    expect(getMatchingAdminRoute("/admin/access/users")?.globalOnly).toBe(true);
    expect(getMatchingAdminRoute("/admin/access/api-keys")?.workspaceAdminVisible).toBe(true);
    expect(getMatchingAdminRoute("/admin/access")?.workspaceAdminVisible).toBe(true);
  });

  it("registers each destination exactly once across the whole navigation", () => {
    const hrefs = adminNavigationGroups.flatMap((g) => g.items.map((item) => item.href));

    expect(hrefs).toEqual([...new Set(hrefs)]);
    expect(hrefs.filter((href) => href === "/admin/workspaces")).toHaveLength(1);
  });

  it("keeps palette aliases unambiguous — one alias never hits two entries", () => {
    const aliases = adminNavigationGroups.flatMap((g) =>
      g.items.flatMap((item) => item.aliases ?? []),
    );

    expect(aliases).toEqual([...new Set(aliases)]);
  });

  it("gates /admin/rank by user.read instead of the broad admin entry", () => {
    expect(getMatchingAdminRoute("/admin/rank")?.permissions).toEqual(["user.read"]);
    expect(getMatchingAdminRoute("/admin/rank/anything")?.permissions).toEqual(["user.read"]);
  });

  it("aliases 'settings' to rank collection only", () => {
    const items = adminNavigationGroups.flatMap((g) => g.items);
    const settingsItems = items.filter((item) => item.aliases?.includes("settings"));

    expect(settingsItems.map((item) => item.href)).toEqual(["/admin/rank"]);
  });

  it("includes aliases in the command palette search value", () => {
    const items = adminNavigationGroups.flatMap((g) => g.items);
    const rank = items.find((item) => item.href === "/admin/rank");

    expect(rank).toBeDefined();
    expect(adminNavItemSearchValue(rank!)).toContain("settings");
    expect(adminNavItemSearchValue(rank!)).toContain(rank!.title);
  });
});
