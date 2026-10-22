import type { BrowserContext } from "@playwright/test";
import { Api } from "./api";
import { BASE_URL } from "./env";
import type { Discipline } from "./seed";
import type { TestUser } from "./users";

export type WorkspaceRole = "owner" | "admin" | "referee" | "host" | "player";

export type GridTier = {
  id?: number;
  slug: string;
  number: number;
  name: string;
  sort_order: number;
  rank_min: number;
  rank_max: number | null;
  icon_url: string;
};
export type GridVersion = { id: number; grid_id: number; version: number; label: string; status: "draft" | "published"; tiers: GridTier[] };
export type Grid = {
  id: number;
  workspace_id: number;
  discipline: Discipline;
  slug: string;
  name: string;
  archived_at: string | null;
  source_workspace_id: number | null;
  versions: GridVersion[];
};
export type WorkspaceRead = {
  id: number;
  slug: string;
  name: string;
  is_hidden: boolean;
  disciplines_enabled: Discipline[];
  default_division_grid_versions: Partial<Record<Discipline, number>>;
};

export const ALL_GAMES: Discipline[] = ["overwatch", "lol", "deadlock"];

export async function enableGames(api: Api, workspaceId: number, games: Discipline[] = ALL_GAMES): Promise<WorkspaceRead> {
  return api.patch<WorkspaceRead>(`/api/v1/workspaces/${workspaceId}`, { disciplines_enabled: games });
}

/** The workspace's system role ids by name (owner/admin/referee/host/player). */
export async function systemRoles(api: Api, workspaceId: number): Promise<Record<WorkspaceRole, number>> {
  const page = await api.get<{ results: { id: number; name: WorkspaceRole; is_system: boolean }[] }>("/api/v1/auth/rbac/roles", {
    workspace_id: workspaceId,
  });
  return Object.fromEntries(page.results.filter((r) => r.is_system).map((r) => [r.name, r.id])) as Record<WorkspaceRole, number>;
}

export async function addMember(api: Api, workspaceId: number, user: Pick<TestUser, "id">, roleId: number) {
  return api.post(`/api/v1/workspaces/${workspaceId}/members`, { auth_user_id: user.id, role_ids: [roleId] }, 201);
}

/**
 * A fresh session for `user`. The gateway caches a token's resolved
 * permissions for 30 s (principal/resolver.go cacheTTL), so a token that was
 * used before a membership change keeps its old grants for up to that long; a
 * new login is resolved from the database and shows the change at once.
 */
export async function freshSession(user: Pick<TestUser, "email" | "password">): Promise<Api> {
  const anon = await Api.create();
  const tokens = await anon.post<{ access_token: string }>("/api/v1/auth/login", { email: user.email, password: user.password });
  await anon.dispose();
  return Api.create(tokens.access_token);
}

export async function listGrids(api: Api, workspaceId: number): Promise<Grid[]> {
  return api.get<Grid[]>(`/api/v1/division-grids/by-workspace/${workspaceId}`);
}

export const THREE_TIERS: GridTier[] = [
  { slug: "top", number: 1, name: "Top", sort_order: 0, rank_min: 2000, rank_max: null, icon_url: "/divisions/champion-1.png" },
  { slug: "mid", number: 2, name: "Mid", sort_order: 1, rank_min: 1000, rank_max: 1999, icon_url: "/divisions/gold-1.png" },
  { slug: "low", number: 3, name: "Low", sort_order: 2, rank_min: 0, rank_max: 999, icon_url: "/divisions/bronze-1.png" },
];

/** The smallest ruleset the engine accepts for a map veto: one pick settles the map. */
export const MAP_PICK_RULESET = {
  version: 2,
  timer_seconds: 90,
  on_timeout: "random_fill",
  phases: [{ id: "main", when: {}, steps: [{ id: "s1", action: "pick", actors: "first" }] }],
};

export type CatalogEntity = { id: number; slug: string; name: string; kind: string; discipline: string; active: boolean; parent_id: number | null; aliases: string[] };

/** A mode and one map under it, named uniquely for this test. */
export async function seedModeAndMap(api: Api, discipline: Discipline, tag: string) {
  const mode = await api.post<CatalogEntity>(`/api/v1/admin/catalog/${discipline}/mode`, { name: `Mode ${tag}` });
  const map = await api.post<CatalogEntity>(`/api/v1/admin/catalog/${discipline}/map`, { name: `Map ${tag}`, parent_id: mode.id });
  return { mode, map };
}

export async function setMapPool(api: Api, tournamentId: number, mapIds: number[]) {
  return api.put(`/api/v1/admin/tournaments/${tournamentId}/pick-ban-configs`, {
    kind: "map",
    mode: "pool",
    ruleset: MAP_PICK_RULESET,
    item_ids: mapIds,
  });
}

/**
 * Points the admin UI at `workspaceId` (the cookie the workspace switcher persists)
 * and records a cookie decision, so the consent banner does not cover the sticky save bar.
 */
export async function selectWorkspace(context: BrowserContext, workspaceId: number) {
  await context.addCookies([
    { name: "owt-workspace-id", value: String(workspaceId), url: BASE_URL },
    { name: "owt-cookie-consent", value: "declined", url: BASE_URL },
  ]);
}
