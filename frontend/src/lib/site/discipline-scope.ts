import type { DisciplineDescriptor } from "@/types/discipline.types";

/**
 * One browsing discipline, resolved from the opened owner, the URL and the saved
 * preference (P7 contracts §2). Pure and client-safe: this module must not import
 * `next/headers`, so server loaders and client hooks run the very same resolver.
 */
export const DISCIPLINE_COOKIE = "owt-discipline";
/** The last concrete game the viewer picked, in the pill or a local tab (spec §2). */
export const LAST_GAME_COOKIE = "owt-last-game";
export const DISCIPLINE_PARAM = "discipline";
export const ALL_DISCIPLINES = "all";

/** The saved preference: a concrete installed code, `all` (directories only) or nothing. */
export type BrowsingDiscipline = string | "all" | null;
/** Which workspaces a game-sensitive read spans: one workspace, or `all` of them. */
export type WorkspaceAxis = number | "all";

export type ResolvedDiscipline =
  | { kind: "all" }
  | { kind: "concrete"; code: string; source: "owner" | "url" | "stored" | "default" }
  | { kind: "invalid"; requested: string; reason: "unknown" | "disabled" | "all-not-supported" }
  | { kind: "empty" };

export type DisciplineChoice = Pick<DisciplineDescriptor, "code" | "enabled">;

/** The viewer's saved game filter (spec §2): one game code, or `all`. An absent cookie is `all`. */
export type GameScope = string;

/** What kind of page a route is (spec §5). */
export type PageClass = "multi" | "single" | "owner" | "platform" | "none";

/** What a page's data reads (spec §4.3). `invalid` and `empty` make no game request. */
export type PageGame =
  | { kind: "all" }
  | { kind: "game"; code: string; source: "owner" | "url" | "scope" | "last" | "default" }
  | { kind: "invalid"; requested: string; reason: "unknown" | "disabled" }
  | { kind: "empty" };

/** What the scope pill's game part shows on a page. */
export type PillGame =
  | { kind: "all" }
  | { kind: "game"; code: string; locked: boolean }
  | { kind: "dimmed" }
  | { kind: "hidden" };

export interface PageGameResolution {
  game: PageGame;
  pill: PillGame;
  /** Local game tabs are rendered. */
  tabs: boolean;
  /** The effective scope (spec §4.2): the saved game when the area runs it, else `all`. */
  scope: GameScope;
}

/** A server render's inputs, handed to the client so hydration resolves exactly as the server did. */
export interface GameScopeInit {
  stored: GameScope;
  lastGame: string | null;
  axis: WorkspaceAxis;
  hostLockedWorkspaceId: number | null;
  /** `null` when the server read failed — the client then reads the list itself. */
  disciplines: DisciplineDescriptor[] | null;
}

const PLATFORM_ROOTS: readonly string[] = [
  "/admin/content",
  "/admin/collectors",
  "/admin/workspaces",
  "/admin/access",
  "/admin/announcements",
  "/admin/notifications",
  "/admin/audit"
];
const SINGLE_PATHS: readonly string[] = ["/users/compare", "/users/heroes-compare"];
/** Creation flows are not a class (spec §5): they carry their own game field. */
const NONE_PATHS: readonly string[] = ["/admin/tournaments/new"];
const MULTI_PATHS: readonly string[] = [
  "/",
  "/tournaments",
  "/balancer/mix",
  "/encounters",
  "/achievements",
  "/statistics",
  "/users",
  "/admin/tournaments",
  "/admin/teams",
  "/admin/matches",
  "/admin/ranks",
  "/admin/achievements",
  "/admin/settings/divisions",
  "/admin/settings/registration-forms",
  "/admin/settings/sub-roles"
];
const OWNER_PATHS: readonly string[] = ["/balancer"];
const OWNER_PREFIXES: readonly string[] = [
  "/tournaments/",
  "/encounters/",
  "/matches/",
  "/draft/",
  "/balancer/mix/",
  "/scrims/",
  "/admin/tournaments/",
  "/admin/settings/divisions/v/",
  "/admin/achievements/",
  "/admin/teams/",
  "/achievements/"
];
const MULTI_PREFIXES: readonly string[] = ["/users/", "/workspace/"];

/** The spec §5 route → class table. Editors on multi routes are owners by their page's own `pageClass`. */
export function pageClassOf(pathname: string): PageClass {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (PLATFORM_ROOTS.some((root) => path === root || path.startsWith(`${root}/`))) return "platform";
  if (SINGLE_PATHS.includes(path)) return "single";
  if (NONE_PATHS.includes(path)) return "none";
  if (MULTI_PATHS.includes(path)) return "multi";
  if (OWNER_PATHS.includes(path) || OWNER_PREFIXES.some((prefix) => path.startsWith(prefix))) return "owner";
  if (MULTI_PREFIXES.some((prefix) => path.startsWith(prefix))) return "multi";
  return "none";
}

/**
 * Which game a page reads, what the pill shows and whether local tabs appear (spec §4.3). Pure: it
 * never writes the scope, the last game or the URL. `?discipline=all` from old links is no parameter.
 */
export function resolvePageGame(input: {
  pageClass: PageClass;
  ownerGame: string | null;
  explicit: string | null;
  stored: GameScope;
  lastGame: string | null;
  games: readonly DisciplineChoice[];
}): PageGameResolution {
  const { pageClass, ownerGame, explicit, stored, lastGame, games } = input;
  const enabled = games.filter((game) => game.enabled).map((game) => game.code);
  const scope: GameScope = stored !== ALL_DISCIPLINES && enabled.includes(stored) ? stored : ALL_DISCIPLINES;
  const scoped = scope === ALL_DISCIPLINES ? null : scope;
  const resolution = (game: PageGame, pill: PillGame, tabs = false): PageGameResolution => ({ game, pill, tabs, scope });
  const shown = (code: string): PillGame => ({ kind: "game", code, locked: false });

  if (pageClass === "owner") {
    return ownerGame === null
      ? resolution({ kind: "empty" }, { kind: "dimmed" })
      : resolution({ kind: "game", code: ownerGame, source: "owner" }, { kind: "game", code: ownerGame, locked: true });
  }
  const first = enabled[0];
  if (pageClass === "none") {
    if (first !== undefined && enabled.length === 1) {
      return resolution({ kind: "game", code: first, source: explicit === first ? "url" : "default" }, { kind: "hidden" });
    }
    return resolution({ kind: "all" }, first === undefined ? { kind: "hidden" } : { kind: "dimmed" });
  }
  if (first === undefined) return resolution({ kind: "empty" }, { kind: "hidden" });

  const several = enabled.length > 1;
  const requested = explicit === null || explicit === ALL_DISCIPLINES ? null : explicit;
  if (requested !== null && !enabled.includes(requested)) {
    const reason = games.some((game) => game.code === requested) ? "disabled" : "unknown";
    const pill: PillGame =
      pageClass === "platform" || !several ? { kind: "hidden" } : scoped ? shown(scoped) : { kind: "all" };
    return resolution({ kind: "invalid", requested, reason }, pill, several && pageClass !== "multi");
  }
  if (!several) {
    return resolution({ kind: "game", code: first, source: requested ? "url" : "default" }, { kind: "hidden" });
  }

  if (pageClass === "multi") {
    if (requested) return resolution({ kind: "game", code: requested, source: "url" }, shown(requested));
    return scoped
      ? resolution({ kind: "game", code: scoped, source: "scope" }, shown(scoped))
      : resolution({ kind: "all" }, { kind: "all" });
  }
  if (pageClass === "single" && scoped) {
    const code = requested ?? scoped;
    return resolution({ kind: "game", code, source: requested ? "url" : "scope" }, shown(code));
  }
  // A single page under all games, or a platform page (whose own tab also follows a game scope).
  const last = lastGame !== null && enabled.includes(lastGame) ? lastGame : null;
  const fromScope = pageClass === "platform" ? scoped : null;
  let game: PageGame;
  if (requested) game = { kind: "game", code: requested, source: "url" };
  else if (fromScope) game = { kind: "game", code: fromScope, source: "scope" };
  else if (last) game = { kind: "game", code: last, source: "last" };
  else game = { kind: "game", code: first, source: "default" };
  return resolution(game, pageClass === "platform" ? { kind: "hidden" } : { kind: "all" }, true);
}

/** Rows carry a game mark only in an all-games view over two or more enabled games (spec §6.1). */
export function showsGameMarks(resolution: PageGameResolution, games: readonly DisciplineChoice[]): boolean {
  return resolution.game.kind === "all" && games.filter((game) => game.enabled).length > 1;
}

/** A creation form's default game (spec §7.2): the scope's, else the last game the area runs, else the first. */
export function defaultCreationGame(input: {
  scope: GameScope;
  lastGame: string | null;
  games: readonly DisciplineChoice[];
}): string | null {
  const enabled = input.games.filter((game) => game.enabled).map((game) => game.code);
  if (input.scope !== ALL_DISCIPLINES && enabled.includes(input.scope)) return input.scope;
  if (input.lastGame !== null && enabled.includes(input.lastGame)) return input.lastGame;
  return enabled[0] ?? null;
}

/**
 * What a server render hands its client tree so hydration resolves exactly as the
 * server did: the saved cookie, the axis (and tenant lock) the list was read for,
 * and that list (`null` when the read failed — the client then reads it itself).
 */
export interface BrowsingDisciplineInit {
  stored: BrowsingDiscipline;
  axis: WorkspaceAxis;
  hostLockedWorkspaceId: number | null;
  disciplines: DisciplineDescriptor[] | null;
}

/**
 * Owner > URL > stored > default (§2.1). `empty` and `invalid` make no game request.
 * An owner may be a disabled game (history); a URL or stored choice may not.
 */
export function resolveDiscipline(input: {
  ownerDiscipline: string | null;
  explicitDiscipline: string | null;
  storedDiscipline: BrowsingDiscipline;
  disciplines: readonly DisciplineChoice[];
  allowsAll: boolean;
}): ResolvedDiscipline {
  const { ownerDiscipline, explicitDiscipline, storedDiscipline, disciplines, allowsAll } = input;
  const find = (code: string) => disciplines.find((discipline) => discipline.code === code);

  if (ownerDiscipline !== null) {
    return find(ownerDiscipline)
      ? { kind: "concrete", code: ownerDiscipline, source: "owner" }
      : { kind: "invalid", requested: ownerDiscipline, reason: "unknown" };
  }

  if (explicitDiscipline !== null) {
    if (explicitDiscipline === ALL_DISCIPLINES) {
      return allowsAll
        ? { kind: "all" }
        : { kind: "invalid", requested: explicitDiscipline, reason: "all-not-supported" };
    }
    const match = find(explicitDiscipline);
    if (!match) return { kind: "invalid", requested: explicitDiscipline, reason: "unknown" };
    if (!match.enabled) return { kind: "invalid", requested: explicitDiscipline, reason: "disabled" };
    return { kind: "concrete", code: explicitDiscipline, source: "url" };
  }

  if (storedDiscipline === ALL_DISCIPLINES) {
    if (allowsAll) return { kind: "all" };
  } else if (storedDiscipline !== null && find(storedDiscipline)?.enabled) {
    return { kind: "concrete", code: storedDiscipline, source: "stored" };
  }

  if (allowsAll) return { kind: "all" };
  const first = disciplines.find((discipline) => discipline.enabled);
  return first ? { kind: "concrete", code: first.code, source: "default" } : { kind: "empty" };
}

/** host lock > opened owner > the visitor's viewing scope (§2.1). */
export function resolveWorkspaceAxis(input: {
  hostLockedWorkspaceId: number | null;
  ownerWorkspaceId: number | null;
  statsScope: "workspace" | "all";
  currentWorkspaceId: number | null;
}): WorkspaceAxis {
  const { hostLockedWorkspaceId, ownerWorkspaceId, statsScope, currentWorkspaceId } = input;
  return hostLockedWorkspaceId ?? ownerWorkspaceId ?? (statsScope === "all" ? "all" : (currentWorkspaceId ?? "all"));
}

/** A saved concrete choice the workspace does not run is dropped; `all` and nothing are kept. */
export function reconcileStoredDiscipline(
  stored: BrowsingDiscipline,
  enabledCodes: readonly string[]
): BrowsingDiscipline {
  return stored === null || stored === ALL_DISCIPLINES || enabledCodes.includes(stored) ? stored : null;
}

/**
 * The value a surface writes back to the URL for a resolution, or `null` when
 * the resolution is not a selection (invalid keeps the user's text, empty has none).
 */
export function disciplineParamOf(resolved: ResolvedDiscipline): string | null {
  if (resolved.kind === "all") return ALL_DISCIPLINES;
  return resolved.kind === "concrete" && resolved.source !== "owner" ? resolved.code : null;
}

export type BrowsingSurface = "directory" | "concrete";

const DIRECTORY_PATHS: readonly string[] = ["/tournaments", "/balancer/mix"];
const CONCRETE_EXACT: readonly string[] = [
  "/encounters",
  "/statistics",
  "/achievements",
  "/admin/achievements",
  "/admin/ranks",
  "/admin/matches",
  "/admin/settings/divisions",
  "/admin/collectors"
];
const CONCRETE_PREFIXES: readonly string[] = ["/users", "/workspace", "/admin/content"];

/**
 * Which kind of browsing surface a path is (§2.3): a `directory` may show all games, a
 * `concrete` one needs a game. Owner pages (`/tournaments/<slug>`, `/encounters/<id>`,
 * `/matches/<id>`, `/draft/<id>`, …), the composite home and non-game pages are `null`:
 * they neither read nor receive `?discipline=`.
 */
export function browsingSurfaceOf(pathname: string): BrowsingSurface | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (DIRECTORY_PATHS.includes(path)) return "directory";
  if (CONCRETE_EXACT.includes(path)) return "concrete";
  return CONCRETE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)) ? "concrete" : null;
}

/**
 * The href a browsing link should navigate to (§2.4): from a browsing surface that carries
 * `?discipline=`, a link to another browsing surface carries it too — `all` only to a
 * directory, since a concrete destination resolves and shows its own game. Owner and
 * non-game destinations, and hrefs that already name a game, are untouched. Pure: it never
 * decides or stores a preference.
 */
export function withBrowsingDiscipline(
  href: string,
  from: { pathname: string; discipline: string | null }
): string {
  if (!from.discipline || browsingSurfaceOf(from.pathname) === null || !href.startsWith("/")) return href;
  const target = new URL(href, "http://x");
  const surface = browsingSurfaceOf(target.pathname);
  if (surface === null || target.searchParams.has(DISCIPLINE_PARAM)) return href;
  if (surface === "concrete" && from.discipline === ALL_DISCIPLINES) return href;
  target.searchParams.set(DISCIPLINE_PARAM, from.discipline);
  return `${target.pathname}${target.search}${target.hash}`;
}
