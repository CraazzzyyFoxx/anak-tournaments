import { cookies, headers } from "next/headers";
import { STATS_SCOPE_COOKIE, type StatsScope } from "@/lib/site/stats-scope";
import workspaceService from "@/services/workspace.service";
import {
  DISCIPLINE_COOKIE,
  resolveWorkspaceAxis,
  type BrowsingDiscipline,
  type WorkspaceAxis
} from "@/lib/site/discipline-scope";
import { LEGACY_WORKSPACE_COOKIE, WORKSPACE_COOKIE } from "@/stores/workspace.store";

/**
 * True when the current request is served on a white-label tenant host — a
 * workspace subdomain or a verified custom domain — per the `x-owt-host-mode`
 * header that `proxy.ts` sets (and strips on the platform apex). Server-only.
 *
 * Fail-safe: returns `false` (platform behaviour) if headers are unavailable.
 */
export async function isTenantHost(): Promise<boolean> {
  try {
    return (await headers()).get("x-owt-host-mode") === "tenant";
  } catch {
    return false;
  }
}

/**
 * The saved public viewing scope. First visits span all communities on the
 * platform; a tenant host always overrides the preference with its own scope.
 * Server-only.
 */
export async function resolveStatsScope(): Promise<StatsScope> {
  if (await isTenantHost()) return "workspace";
  try {
    return (await cookies()).get(STATS_SCOPE_COOKIE)?.value === "workspace" ? "workspace" : "all";
  } catch {
    return "all";
  }
}

/**
 * The server half of the browsing-discipline inputs: the saved choice (cookie) and
 * the workspace axis its metadata is read for — the tenant host's workspace on a
 * tenant host, otherwise the visitor's viewing scope. Server loaders feed this to
 * the same `resolveDiscipline` the client runs, so hydration agrees with SSR.
 * Server-only.
 */
export interface ServerDisciplineScope {
  stored: BrowsingDiscipline;
  axis: WorkspaceAxis;
  /** The tenant host's workspace, so a client that has not locked its store yet still reads that axis. */
  hostLockedWorkspaceId: number | null;
}

export async function resolveServerDisciplineScope(): Promise<ServerDisciplineScope> {
  try {
    const [h, store] = await Promise.all([headers(), cookies()]);
    const hostId = Number(h.get("x-owt-workspace-id"));
    const hostLockedWorkspaceId = h.get("x-owt-host-mode") === "tenant" && hostId > 0 ? hostId : null;
    const workspaceCookie = Number(store.get(WORKSPACE_COOKIE)?.value ?? store.get(LEGACY_WORKSPACE_COOKIE)?.value);
    return {
      stored: store.get(DISCIPLINE_COOKIE)?.value ?? null,
      hostLockedWorkspaceId,
      axis: resolveWorkspaceAxis({
        hostLockedWorkspaceId,
        ownerWorkspaceId: null,
        statsScope: store.get(STATS_SCOPE_COOKIE)?.value === "workspace" ? "workspace" : "all",
        currentWorkspaceId: workspaceCookie > 0 ? workspaceCookie : null
      })
    };
  } catch {
    return { stored: null, axis: "all", hostLockedWorkspaceId: null };
  }
}

/** Tenant (white-label) host branding: the host community's avatar source. */
export interface TenantWorkspaceBranding {
  id: number;
  name: string;
  icon_url: string | null;
}

/**
 * The host workspace's branding on a tenant (white-label) host, resolved from
 * the `x-owt-workspace-id` header that `proxy.ts` injects. `null` on the
 * platform apex host or on any failure (fail-safe: platform branding).
 * Server-only.
 */
export async function resolveTenantWorkspace(): Promise<TenantWorkspaceBranding | null> {
  try {
    const h = await headers();
    if (h.get("x-owt-host-mode") !== "tenant") return null;
    const raw = h.get("x-owt-workspace-id");
    const id = raw ? Number(raw) : NaN;
    if (!Number.isFinite(id)) return null;
    const workspace = await workspaceService.getById(id);
    return { id: workspace.id, name: workspace.name, icon_url: workspace.icon_url };
  } catch {
    return null;
  }
}
