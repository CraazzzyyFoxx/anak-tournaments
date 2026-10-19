import { resolveServerDisciplineScope } from "@/lib/site/tenant-host";
import {
  resolveDiscipline,
  resolvePageGame,
  type BrowsingDisciplineInit,
  type GameScopeInit,
  type PageClass,
  type PageGameResolution,
  type ResolvedDiscipline
} from "@/lib/site/discipline-scope";
import disciplineService from "@/services/discipline.service";

/**
 * The server render's browsing-discipline inputs: the saved cookie, the workspace
 * axis (tenant host first) and the installed games read for that same axis. A failed
 * read is `disciplines: null`, never an empty list — the client then fetches it
 * itself instead of rendering an "unavailable" state the server only guessed at.
 * Server-only.
 */
export async function loadBrowsingDisciplineInit(): Promise<BrowsingDisciplineInit> {
  const { stored, axis, hostLockedWorkspaceId } = await resolveServerDisciplineScope();
  const disciplines = await disciplineService.list(axis).catch(() => null);
  return { stored, axis, hostLockedWorkspaceId, disciplines };
}

/**
 * The game of a server-rendered concrete-browsing page (§2.1, no `all`): the same resolver the client runs, on the
 * server's own inputs and the raw `?discipline=` (an empty value is an explicit, invalid request). A page about one
 * community names its workspace as `axis` (that community's games, whatever the viewing scope; a tenant host keeps
 * its own). `resolved` is `null` when the installed games could not be read — no game request may be made then.
 * Server-only.
 */
export async function resolveServerBrowsingDiscipline(
  explicit: string | string[] | undefined,
  axis?: number
): Promise<{ init: BrowsingDisciplineInit; resolved: ResolvedDiscipline | null }> {
  const loaded = await loadBrowsingDisciplineInit();
  const init =
    axis === undefined || loaded.hostLockedWorkspaceId !== null || loaded.axis === axis
      ? loaded
      : { ...loaded, axis, disciplines: await disciplineService.list(axis).catch(() => null) };
  const resolved = init.disciplines
    ? resolveDiscipline({
        ownerDiscipline: null,
        explicitDiscipline: (Array.isArray(explicit) ? explicit[0] : explicit) ?? null,
        storedDiscipline: init.stored,
        disciplines: init.disciplines,
        allowsAll: false
      })
    : null;
  return { init, resolved };
}

/**
 * The server render's game-scope inputs: the saved scope and last game, the workspace axis (tenant
 * host first) and the installed games read for that axis. A failed read is `disciplines: null`,
 * never an empty list — the client then reads it itself. Server-only.
 */
export async function loadGameScopeInit(): Promise<GameScopeInit> {
  const { stored, lastGame, axis, hostLockedWorkspaceId } = await resolveServerDisciplineScope();
  const disciplines = await disciplineService.list(axis).catch(() => null);
  return { stored, lastGame, axis, hostLockedWorkspaceId, disciplines };
}

/**
 * A server-rendered page's game (spec §4): the client's resolver on the server's inputs and the raw
 * `?discipline=` (an empty value is an explicit, invalid request). A page about one community names
 * its workspace as `axis` (a tenant host keeps its own). `resolution` is `null` when the games could
 * not be read — no game request may be made then. Server-only.
 */
export async function resolveServerPageGame(
  pageClass: PageClass,
  explicit: string | string[] | undefined,
  axis?: number
): Promise<{ init: GameScopeInit; resolution: PageGameResolution | null }> {
  const loaded = await loadGameScopeInit();
  const init =
    axis === undefined || loaded.hostLockedWorkspaceId !== null || loaded.axis === axis
      ? loaded
      : { ...loaded, axis, disciplines: await disciplineService.list(axis).catch(() => null) };
  const resolution = init.disciplines
    ? resolvePageGame({
        pageClass,
        ownerGame: null,
        explicit: (Array.isArray(explicit) ? explicit[0] : explicit) ?? null,
        stored: init.stored,
        lastGame: init.lastGame,
        games: init.disciplines
      })
    : null;
  return { init, resolution };
}
