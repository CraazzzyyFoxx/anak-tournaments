import type { DisciplineDescriptor } from "@/types/discipline.types";

/**
 * One browsing discipline, resolved from the opened owner, the URL and the saved
 * preference (P7 contracts §2). Pure and client-safe: this module must not import
 * `next/headers`, so server loaders and client hooks run the very same resolver.
 */
export const DISCIPLINE_COOKIE = "owt-discipline";
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
