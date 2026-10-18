import { describe, expect, it } from "vitest";

import {
  browsingSurfaceOf,
  disciplineParamOf,
  reconcileStoredDiscipline,
  resolveDiscipline,
  resolveWorkspaceAxis,
  withBrowsingDiscipline,
  type DisciplineChoice
} from "./discipline-scope";
import { scopeQuery } from "./stats-scope";

const OW: DisciplineChoice = { code: "overwatch", enabled: true };
const LOL: DisciplineChoice = { code: "lol", enabled: true };
const OFF: DisciplineChoice = { code: "lol", enabled: false };

const base = {
  ownerDiscipline: null,
  explicitDiscipline: null,
  storedDiscipline: null,
  disciplines: [OW, LOL],
  allowsAll: false
};

describe("resolveDiscipline", () => {
  it("lets the owner win over URL and saved choice, even for a disabled game", () => {
    expect(resolveDiscipline({ ...base, ownerDiscipline: "lol", explicitDiscipline: "overwatch", storedDiscipline: "overwatch" }))
      .toEqual({ kind: "concrete", code: "lol", source: "owner" });
    expect(resolveDiscipline({ ...base, disciplines: [OW, OFF], ownerDiscipline: "lol" }))
      .toEqual({ kind: "concrete", code: "lol", source: "owner" });
  });

  it("treats an owner that is not installed as unknown rather than falling back", () => {
    expect(resolveDiscipline({ ...base, ownerDiscipline: "dota", storedDiscipline: "overwatch" }))
      .toEqual({ kind: "invalid", requested: "dota", reason: "unknown" });
  });

  it("prefers a valid explicit URL over the saved choice", () => {
    expect(resolveDiscipline({ ...base, explicitDiscipline: "lol", storedDiscipline: "overwatch" }))
      .toEqual({ kind: "concrete", code: "lol", source: "url" });
  });

  it("keeps an unknown, disabled or unsupported-all explicit value as an error", () => {
    expect(resolveDiscipline({ ...base, explicitDiscipline: "missing" }))
      .toEqual({ kind: "invalid", requested: "missing", reason: "unknown" });
    expect(resolveDiscipline({ ...base, disciplines: [OW, OFF], explicitDiscipline: "lol", storedDiscipline: "overwatch" }))
      .toEqual({ kind: "invalid", requested: "lol", reason: "disabled" });
    expect(resolveDiscipline({ ...base, explicitDiscipline: "all", storedDiscipline: "overwatch" }))
      .toEqual({ kind: "invalid", requested: "all", reason: "all-not-supported" });
  });

  it("accepts all only where the surface allows it", () => {
    expect(resolveDiscipline({ ...base, explicitDiscipline: "all", allowsAll: true })).toEqual({ kind: "all" });
  });

  it("uses a valid saved concrete choice, ignoring one that is gone or disabled", () => {
    expect(resolveDiscipline({ ...base, storedDiscipline: "lol" }))
      .toEqual({ kind: "concrete", code: "lol", source: "stored" });
    expect(resolveDiscipline({ ...base, disciplines: [OW, OFF], storedDiscipline: "lol" }))
      .toEqual({ kind: "concrete", code: "overwatch", source: "default" });
    expect(resolveDiscipline({ ...base, storedDiscipline: "dota" }))
      .toEqual({ kind: "concrete", code: "overwatch", source: "default" });
  });

  it("honours a saved all only on a directory, and a saved concrete choice there too", () => {
    expect(resolveDiscipline({ ...base, storedDiscipline: "all", allowsAll: true })).toEqual({ kind: "all" });
    expect(resolveDiscipline({ ...base, storedDiscipline: "all" }))
      .toEqual({ kind: "concrete", code: "overwatch", source: "default" });
    expect(resolveDiscipline({ ...base, storedDiscipline: "lol", allowsAll: true }))
      .toEqual({ kind: "concrete", code: "lol", source: "stored" });
  });

  it("defaults a directory to all and a concrete view to the first enabled game in registry order", () => {
    expect(resolveDiscipline({ ...base, allowsAll: true })).toEqual({ kind: "all" });
    expect(resolveDiscipline({ ...base, disciplines: [{ code: "lol", enabled: false }, OW, LOL] }))
      .toEqual({ kind: "concrete", code: "overwatch", source: "default" });
    expect(resolveDiscipline({ ...base, disciplines: [LOL, OW] }))
      .toEqual({ kind: "concrete", code: "lol", source: "default" });
  });

  it("is empty when no game is enabled, and never invents one", () => {
    expect(resolveDiscipline({ ...base, disciplines: [] })).toEqual({ kind: "empty" });
    expect(resolveDiscipline({ ...base, disciplines: [OFF], storedDiscipline: "lol" })).toEqual({ kind: "empty" });
  });
});

describe("disciplineParamOf", () => {
  it("writes back a selection, never an owner, an error or an empty set", () => {
    expect(disciplineParamOf({ kind: "all" })).toBe("all");
    expect(disciplineParamOf({ kind: "concrete", code: "lol", source: "stored" })).toBe("lol");
    expect(disciplineParamOf({ kind: "concrete", code: "lol", source: "owner" })).toBeNull();
    expect(disciplineParamOf({ kind: "invalid", requested: "x", reason: "unknown" })).toBeNull();
    expect(disciplineParamOf({ kind: "empty" })).toBeNull();
  });
});

describe("resolveWorkspaceAxis", () => {
  const axis = { hostLockedWorkspaceId: null, ownerWorkspaceId: null, statsScope: "all" as const, currentWorkspaceId: 4 };

  it("is host, then owner, then the viewing scope", () => {
    expect(resolveWorkspaceAxis({ ...axis, hostLockedWorkspaceId: 9, ownerWorkspaceId: 7 })).toBe(9);
    expect(resolveWorkspaceAxis({ ...axis, ownerWorkspaceId: 7 })).toBe(7);
    expect(resolveWorkspaceAxis(axis)).toBe("all");
    expect(resolveWorkspaceAxis({ ...axis, statsScope: "workspace" })).toBe(4);
    expect(resolveWorkspaceAxis({ ...axis, statsScope: "workspace", currentWorkspaceId: null })).toBe("all");
  });
});

describe("reconcileStoredDiscipline", () => {
  it("drops a concrete choice the workspace does not run and keeps all/nothing", () => {
    expect(reconcileStoredDiscipline("lol", ["overwatch"])).toBeNull();
    expect(reconcileStoredDiscipline("lol", ["overwatch", "lol"])).toBe("lol");
    expect(reconcileStoredDiscipline("all", [])).toBe("all");
    expect(reconcileStoredDiscipline(null, ["overwatch"])).toBeNull();
  });
});

describe("scopeQuery", () => {
  it("sends the sentinel for all, the id when the caller resolved one, and nothing otherwise", () => {
    expect(scopeQuery("all")).toEqual({ workspace_id: "all" });
    expect(scopeQuery("all", 5)).toEqual({ workspace_id: "all" });
    expect(scopeQuery("workspace", 5)).toEqual({ workspace_id: 5 });
    expect(scopeQuery("workspace")).toEqual({});
    expect(scopeQuery(undefined)).toEqual({});
  });
});

describe("browsingSurfaceOf", () => {
  it("classifies directories, concrete surfaces and owner pages", () => {
    expect(browsingSurfaceOf("/tournaments")).toBe("directory");
    expect(browsingSurfaceOf("/tournaments/")).toBe("directory");
    expect(browsingSurfaceOf("/balancer/mix")).toBe("directory");
    for (const path of ["/achievements", "/encounters", "/statistics", "/users", "/users/compare", "/users/some-player/stats", "/workspace/community", "/admin/content/heroes", "/admin/achievements"]) {
      expect(browsingSurfaceOf(path)).toBe("concrete");
    }
    for (const path of ["/", "/tournaments/spring-cup", "/tournaments/analytics", "/encounters/12", "/matches/3", "/draft/4", "/balancer/mix/9", "/admin/members", "/privacy"]) {
      expect(browsingSurfaceOf(path)).toBeNull();
    }
  });
});

describe("withBrowsingDiscipline", () => {
  const from = (pathname: string, discipline: string | null) => ({ pathname, discipline });

  it("carries a concrete game between browsing surfaces and keeps the rest of the href", () => {
    expect(withBrowsingDiscipline("/achievements", from("/tournaments", "lol"))).toBe("/achievements?discipline=lol");
    expect(withBrowsingDiscipline("/users/heroes-compare?hero_id=3#x", from("/achievements", "lol"))).toBe(
      "/users/heroes-compare?hero_id=3&discipline=lol#x"
    );
    expect(withBrowsingDiscipline("/tournaments", from("/achievements", "lol"))).toBe("/tournaments?discipline=lol");
  });

  it("carries all only to a directory, never to a concrete destination", () => {
    expect(withBrowsingDiscipline("/tournaments", from("/tournaments", "all"))).toBe("/tournaments?discipline=all");
    expect(withBrowsingDiscipline("/achievements", from("/tournaments", "all"))).toBe("/achievements");
  });

  it("leaves owner and non-game destinations, owner sources, absent values and explicit hrefs alone", () => {
    expect(withBrowsingDiscipline("/tournaments/spring-cup", from("/tournaments", "lol"))).toBe("/tournaments/spring-cup");
    expect(withBrowsingDiscipline("/privacy", from("/tournaments", "lol"))).toBe("/privacy");
    expect(withBrowsingDiscipline("/achievements", from("/tournaments/spring-cup", "lol"))).toBe("/achievements");
    expect(withBrowsingDiscipline("/achievements", from("/tournaments", null))).toBe("/achievements");
    expect(withBrowsingDiscipline("/achievements?discipline=overwatch", from("/tournaments", "lol"))).toBe("/achievements?discipline=overwatch");
    expect(withBrowsingDiscipline("https://elsewhere.test/achievements", from("/tournaments", "lol"))).toBe("https://elsewhere.test/achievements");
  });
});
