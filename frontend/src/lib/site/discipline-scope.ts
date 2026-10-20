import type { DisciplineDescriptor } from "@/types/discipline.types";

/**
 * The viewer's game scope and each page's game (spec §2, §4), resolved from the opened owner, the URL,
 * the saved scope and the last game. Pure and client-safe: this module must not import
 * `next/headers`, so server loaders and client hooks run the very same resolver.
 */
export const DISCIPLINE_COOKIE = "owt-discipline";
/** The last concrete game the viewer picked, in the pill or a local tab (spec §2). */
export const LAST_GAME_COOKIE = "owt-last-game";
export const DISCIPLINE_PARAM = "discipline";
export const ALL_DISCIPLINES = "all";

/** Which workspaces a game-sensitive read spans: one workspace, or `all` of them. */
export type WorkspaceAxis = number | "all";

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
/**
 * One-game-by-nature pages, then the interim single pages (plan C8, R22): game-bound until their cross-game reads
 * land, when each moves back to its spec §5 class (multi).
 */
const SINGLE_PATHS: readonly string[] = [
  "/users/compare",
  "/users/heroes-compare",
  "/admin/settings/registration-forms"
];
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
  "/admin/settings/divisions",
  "/admin/settings/sub-roles",
  "/admin/achievements",
  "/admin/ranks"
];
const MULTI_PREFIXES: readonly string[] = ["/workspace/", "/users/"];
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

/**
 * The spec §5 route → class table, the interim single pages aside. Editors on multi routes are owners by their
 * page's own `pageClass`.
 */
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
 * The class an ownerless one-game block (a player's rank table or rank history) resolves under: its route's single
 * rules, or — on a game-neutral page, whose pill offers no game — the platform rules: its own tabs over ≥2 games,
 * defaulting to the scope's game (R23).
 */
export function blockClassOf(pathname: string): "single" | "platform" {
  return pageClassOf(pathname) === "none" ? "platform" : "single";
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
