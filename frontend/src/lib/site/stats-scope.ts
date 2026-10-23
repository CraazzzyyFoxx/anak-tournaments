/**
 * Cross-workspace public browsing, including Play lists. Actions and opened
 * objects retain their own concrete workspace. The platform defaults to "all".
 *
 * The mode is a visitor preference stored in {@link STATS_SCOPE_COOKIE} and
 * toggled from the workspace switcher. It exists only on the platform apex
 * host; a tenant (white-label) host is one workspace by definition, so the
 * scope is always resolved server-side (see `resolveStatsScope` in
 * `@/lib/site/tenant-host`) and handed to the client as a prop.
 *
 * Client-safe: this module must not import `next/headers`.
 */
export type StatsScope = "workspace" | "all";

export const STATS_SCOPE_COOKIE = "owt-stats-scope";

/**
 * The `workspace_id` query fragment for a scoped read. `all` is the backend's
 * cross-workspace sentinel. In workspace mode the fragment is empty — `apiFetch`
 * keeps injecting the ambient workspace — unless the caller names the concrete
 * workspace it resolved (an owner's, or a metadata read's), which is then sent
 * explicitly.
 */
export function scopeQuery(
  scope: StatsScope | undefined,
  workspaceId?: number | null
): { workspace_id?: number | "all" } {
  if (scope === "all") return { workspace_id: "all" };
  return workspaceId == null ? {} : { workspace_id: workspaceId };
}
