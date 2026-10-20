import { describe, expect, it } from "vitest";

import {
  browsingSurfaceOf,
  defaultCreationGame,
  disciplineParamOf,
  pageClassOf,
  reconcileStoredDiscipline,
  resolveDiscipline,
  resolvePageGame,
  resolveWorkspaceAxis,
  showsGameMarks,
  withBrowsingDiscipline,
  type DisciplineChoice
} from "./discipline-scope";
import { scopeQuery } from "./stats-scope";

const OW: DisciplineChoice = { code: "overwatch", enabled: true };
const LOL: DisciplineChoice = { code: "lol", enabled: true };
const OFF: DisciplineChoice = { code: "lol", enabled: false };
const CHESS: DisciplineChoice = { code: "chess", enabled: true };

const resolve = (overrides: Partial<Parameters<typeof resolvePageGame>[0]> = {}) =>
  resolvePageGame({
    pageClass: "multi",
    ownerGame: null,
    explicit: null,
    stored: "all",
    lastGame: null,
    games: [OW, LOL],
    ...overrides
  });

describe("pageClassOf", () => {
  const expectClass = (paths: string[], pageClass: string) => {
    for (const path of paths) expect(pageClassOf(path), path).toBe(pageClass);
  };

  it("classifies the lists that can show every game as multi", () => {
    expectClass(
      [
        "/",
        "/tournaments",
        "/tournaments/",
        "/balancer/mix",
        "/encounters",
        "/achievements",
        "/admin/tournaments",
        "/admin/teams",
        "/admin/settings/divisions"
      ],
      "multi"
    );
  });

  it("classifies the one-game-by-nature comparisons as single", () => {
    expectClass(["/users/compare", "/users/heroes-compare", "/users/compare/"], "single");
  });

  it("classifies the game-bound site pages as single until their cross-game reads land", () => {
    expectClass(["/statistics", "/users", "/users/", "/users/some-player", "/workspace/community"], "single");
  });

  it("classifies the game-bound admin pages as single until their cross-game reads land", () => {
    expectClass(
      [
        "/admin/matches",
        "/admin/achievements",
        "/admin/achievements/",
        "/admin/settings/sub-roles",
        "/admin/settings/registration-forms",
        "/admin/ranks"
      ],
      "single"
    );
  });

  it("classifies every page opened on one object as owner", () => {
    expectClass(
      [
        "/tournaments/spring-cup",
        "/tournaments/spring-cup/bracket",
        "/tournaments/analytics",
        "/encounters/12",
        "/matches/3",
        "/draft/4",
        "/balancer",
        "/balancer/mix/9",
        "/scrims/abc",
        "/admin/tournaments/5",
        "/admin/tournaments/5/settings/general",
        "/admin/settings/divisions/v/8",
        "/admin/achievements/2",
        "/admin/teams/7",
        "/achievements/3"
      ],
      "owner"
    );
  });

  it("classifies the admin platform group as platform", () => {
    expectClass(
      [
        "/admin/content",
        "/admin/content/heroes",
        "/admin/collectors/rank",
        "/admin/workspaces",
        "/admin/workspaces/3/general",
        "/admin/access/roles",
        "/admin/announcements",
        "/admin/notifications",
        "/admin/audit"
      ],
      "platform"
    );
  });

  it("classifies game-neutral pages, creation flows and unknown routes as none", () => {
    expectClass(
      [
        "/admin",
        "/admin/people",
        "/admin/members",
        "/admin/settings",
        "/admin/settings/general",
        "/admin/tournaments/new",
        "/privacy",
        "/terms",
        "/docs/dev/schema",
        "/get-workspace",
        "/scrims",
        "/admin/people/12"
      ],
      "none"
    );
  });
});

describe("resolvePageGame", () => {
  it("is empty with no pill and no tabs when the area runs no game", () => {
    for (const pageClass of ["multi", "single", "platform"] as const) {
      expect(resolve({ pageClass, games: [OFF] })).toEqual({
        game: { kind: "empty" },
        pill: { kind: "hidden" },
        tabs: false,
        scope: "all"
      });
      expect(resolve({ pageClass, games: [] }).game).toEqual({ kind: "empty" });
    }
  });

  it("reads the one game of a one-game area everywhere but on an owner page, with no pill part and no tabs", () => {
    for (const pageClass of ["multi", "single", "platform"] as const) {
      expect(resolve({ pageClass, games: [OW, OFF], stored: "lol", lastGame: "lol" })).toEqual({
        game: { kind: "game", code: "overwatch", source: "default" },
        pill: { kind: "hidden" },
        tabs: false,
        scope: "all"
      });
      expect(resolve({ pageClass, games: [OW, OFF], explicit: "overwatch" }).game).toEqual({
        kind: "game",
        code: "overwatch",
        source: "url"
      });
    }
    expect(resolve({ pageClass: "none", games: [OW, OFF], stored: "lol" })).toEqual({
      game: { kind: "game", code: "overwatch", source: "default" },
      pill: { kind: "hidden" },
      tabs: false,
      scope: "all"
    });
    expect(resolve({ pageClass: "none", games: [OW], explicit: "overwatch" })).toEqual({
      game: { kind: "game", code: "overwatch", source: "url" },
      pill: { kind: "hidden" },
      tabs: false,
      scope: "all"
    });
  });

  it("keeps an explicit code that is not installed or not enabled as an error, never a corrected game", () => {
    expect(resolve({ explicit: "starcraft" }).game).toEqual({ kind: "invalid", requested: "starcraft", reason: "unknown" });
    expect(resolve({ explicit: "" }).game).toEqual({ kind: "invalid", requested: "", reason: "unknown" });
    expect(resolve({ games: [OW, OFF], explicit: "lol" }).game).toEqual({
      kind: "invalid",
      requested: "lol",
      reason: "disabled"
    });
    // A single page's way out is its tabs; a multi page's is "show all games".
    expect(resolve({ pageClass: "single", explicit: "starcraft" }).tabs).toBe(true);
    expect(resolve({ explicit: "starcraft" }).tabs).toBe(false);
    // The owner's game outranks any URL.
    expect(resolve({ pageClass: "owner", ownerGame: "lol", explicit: "starcraft" }).game).toEqual({
      kind: "game",
      code: "lol",
      source: "owner"
    });
  });

  it("reads ?discipline=all from old links as no parameter", () => {
    expect(resolve({ explicit: "all", stored: "lol" }).game).toEqual({ kind: "game", code: "lol", source: "scope" });
    expect(resolve({ explicit: "all" }).game).toEqual({ kind: "all" });
    expect(resolve({ pageClass: "single", explicit: "all" }).game).toEqual({
      kind: "game",
      code: "overwatch",
      source: "default"
    });
  });

  it("multi: the URL's game, else the effective scope, else all games, and the pill mirrors it", () => {
    expect(resolve({ explicit: "lol", stored: "overwatch" })).toEqual({
      game: { kind: "game", code: "lol", source: "url" },
      pill: { kind: "game", code: "lol", locked: false },
      tabs: false,
      scope: "overwatch"
    });
    expect(resolve({ stored: "lol" })).toEqual({
      game: { kind: "game", code: "lol", source: "scope" },
      pill: { kind: "game", code: "lol", locked: false },
      tabs: false,
      scope: "lol"
    });
    expect(resolve({ lastGame: "lol" })).toEqual({
      game: { kind: "all" },
      pill: { kind: "all" },
      tabs: false,
      scope: "all"
    });
  });

  it("single under a game scope: the URL's game or the scope's, named by the pill, without tabs", () => {
    expect(resolve({ pageClass: "single", stored: "lol" })).toEqual({
      game: { kind: "game", code: "lol", source: "scope" },
      pill: { kind: "game", code: "lol", locked: false },
      tabs: false,
      scope: "lol"
    });
    expect(resolve({ pageClass: "single", stored: "lol", explicit: "overwatch" })).toEqual({
      game: { kind: "game", code: "overwatch", source: "url" },
      pill: { kind: "game", code: "overwatch", locked: false },
      tabs: false,
      scope: "lol"
    });
  });

  it("single under all games: the URL's game, else the last game the area runs, else the first enabled, with tabs", () => {
    expect(resolve({ pageClass: "single", explicit: "lol" })).toEqual({
      game: { kind: "game", code: "lol", source: "url" },
      pill: { kind: "all" },
      tabs: true,
      scope: "all"
    });
    expect(resolve({ pageClass: "single", lastGame: "lol" }).game).toEqual({ kind: "game", code: "lol", source: "last" });
    expect(resolve({ pageClass: "single", lastGame: "chess" }).game).toEqual({
      kind: "game",
      code: "overwatch",
      source: "default"
    });
    expect(resolve({ pageClass: "single", games: [LOL, OW] }).game).toEqual({ kind: "game", code: "lol", source: "default" });
    expect(resolve({ pageClass: "single", stored: "chess" })).toMatchObject({ pill: { kind: "all" }, tabs: true, scope: "all" });
  });

  it("platform: the URL's game, else the scope's, else the last game, else the first, with tabs and no pill", () => {
    expect(resolve({ pageClass: "platform", explicit: "lol", stored: "overwatch" })).toEqual({
      game: { kind: "game", code: "lol", source: "url" },
      pill: { kind: "hidden" },
      tabs: true,
      scope: "overwatch"
    });
    expect(resolve({ pageClass: "platform", stored: "lol", lastGame: "overwatch" }).game).toEqual({
      kind: "game",
      code: "lol",
      source: "scope"
    });
    expect(resolve({ pageClass: "platform", lastGame: "lol" }).game).toEqual({ kind: "game", code: "lol", source: "last" });
    expect(resolve({ pageClass: "platform" }).game).toEqual({ kind: "game", code: "overwatch", source: "default" });
  });

  it("owner: the owner's game, locked, even a disabled one; a pending owner reads nothing and dims the pill", () => {
    expect(
      resolve({ pageClass: "owner", ownerGame: "lol", games: [OW, OFF], stored: "overwatch", explicit: "overwatch" })
    ).toEqual({
      game: { kind: "game", code: "lol", source: "owner" },
      pill: { kind: "game", code: "lol", locked: true },
      tabs: false,
      scope: "overwatch"
    });
    expect(resolve({ pageClass: "owner", ownerGame: null })).toEqual({
      game: { kind: "empty" },
      pill: { kind: "dimmed" },
      tabs: false,
      scope: "all"
    });
  });

  it("none: not game-dependent, the pill's game part dimmed, no tabs", () => {
    expect(resolve({ pageClass: "none", stored: "lol", explicit: "overwatch" })).toEqual({
      game: { kind: "all" },
      pill: { kind: "dimmed" },
      tabs: false,
      scope: "lol"
    });
  });

  it("uses the saved game only where the area runs it, and never rewrites it", () => {
    const input = {
      pageClass: "multi" as const,
      ownerGame: null,
      explicit: null,
      stored: "lol",
      lastGame: "lol",
      games: [OW, OFF, CHESS]
    };
    const before = structuredClone(input);
    expect(resolvePageGame(input)).toMatchObject({ game: { kind: "all" }, scope: "all" });
    expect(input).toEqual(before);
    expect(resolvePageGame({ ...input, games: [OW, LOL, CHESS] }).scope).toBe("lol");
  });
});

describe("showsGameMarks", () => {
  it("marks rows only in an all-games view over two or more enabled games", () => {
    expect(showsGameMarks(resolve(), [OW, LOL])).toBe(true);
    expect(showsGameMarks(resolve({ stored: "lol" }), [OW, LOL])).toBe(false);
    expect(showsGameMarks(resolve({ games: [OW, OFF] }), [OW, OFF])).toBe(false);
  });
});

describe("defaultCreationGame", () => {
  it("is the scope's game, else the last game the area runs, else the first enabled, else none", () => {
    expect(defaultCreationGame({ scope: "lol", lastGame: "overwatch", games: [OW, LOL] })).toBe("lol");
    expect(defaultCreationGame({ scope: "all", lastGame: "lol", games: [OW, LOL] })).toBe("lol");
    expect(defaultCreationGame({ scope: "all", lastGame: "lol", games: [OW, OFF] })).toBe("overwatch");
    expect(defaultCreationGame({ scope: "lol", lastGame: null, games: [OW, OFF] })).toBe("overwatch");
    expect(defaultCreationGame({ scope: "all", lastGame: null, games: [OFF] })).toBeNull();
  });
});

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
