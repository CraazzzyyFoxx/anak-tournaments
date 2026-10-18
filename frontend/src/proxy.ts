import { NextRequest, NextResponse } from "next/server";
import { resolveHost } from "@/lib/site/host";
import { internalApiOrigin } from "@/lib/api/routes";
import {
  legacyCatalogSearch,
  type LegacyKind,
  type LegacyResolution
} from "@/lib/catalog/legacy-redirect";

// Small bounded TTL cache: the host->workspace map is tiny and rarely changes.
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 1000;
const cache = new Map<string, { id: number | null; at: number }>();
const legacyCache = new Map<string, { id: LegacyResolution | null; at: number }>();

function setCache<V>(store: Map<string, { id: V; at: number }>, key: string, id: V, at: number): void {
  // Rough FIFO eviction: Map preserves insertion order, so the first key is oldest.
  if (store.size >= CACHE_MAX) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { id, at });
}

type Lookup = { status: "found"; id: number } | { status: "not_found" } | { status: "error" };

function fromEntry(entry: { id: number | null }): Lookup {
  return entry.id === null ? { status: "not_found" } : { status: "found", id: entry.id };
}

async function resolveWorkspace(origin: string, host: string): Promise<Lookup> {
  const now = Date.now();
  const cached = cache.get(host);
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return fromEntry(cached);
  }
  try {
    const base = internalApiOrigin() ?? origin;
    const res = await fetch(`${base}/api/v1/workspaces/by-host?host=${encodeURIComponent(host)}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      // Transient backend failure: never cache it. Serve stale if we have it, else surface a 503.
      return cached ? fromEntry(cached) : { status: "error" };
    }
    const data = await res.json();
    const id = typeof data?.workspace_id === "number" ? data.workspace_id : null;
    setCache(cache, host, id, now);
    return id === null ? { status: "not_found" } : { status: "found", id };
  } catch {
    return cached ? fromEntry(cached) : { status: "error" };
  }
}

const CATALOG_KINDS: readonly string[] = ["character", "map", "mode"];

/**
 * What an old catalog id became (new id, its discipline and kind), or `null` (a new id, an unknown one, or the API
 * unreachable). The discipline travels with the id through the TTL cache so the redirect can open the entity in its
 * own game. Removed with discipline02.
 */
async function resolveLegacy(origin: string, kind: LegacyKind, id: string): Promise<LegacyResolution | null> {
  const key = `${kind}:${id}`;
  const now = Date.now();
  const cached = legacyCache.get(key);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.id;
  try {
    const base = internalApiOrigin() ?? origin;
    const res = await fetch(`${base}/api/v1/catalog/legacy/${kind}/${id}`, { headers: { accept: "application/json" } });
    if (!res.ok && res.status !== 404) return null;
    const data = res.ok ? await res.json() : null;
    const resolution: LegacyResolution | null =
      typeof data?.entity_id === "number" &&
      typeof data?.discipline === "string" &&
      CATALOG_KINDS.includes(data?.kind)
        ? { entityId: data.entity_id, discipline: data.discipline, kind: data.kind }
        : null;
    setCache(legacyCache, key, resolution, now);
    return resolution;
  } catch {
    return null;
  }
}

/**
 * Scoping headers this proxy owns. Every one is set (or deleted outright)
 * here, so a client-supplied value can never survive even if the set logic
 * below changes. nginx drops client-supplied copies at the edge as well —
 * `nginx/nginx.conf` — making this the second of two independent barriers,
 * not the only one.
 *
 * `x-owt-pathname` is the request path (with its query), which a server
 * component otherwise cannot see: layouts get no pathname prop. The admin
 * layout needs it to send a signed-out visitor to the sign-in modal with a
 * return path instead of dumping them on `/`.
 */
function scopedHeaders(request: NextRequest): Headers {
  const headers = new Headers(request.headers);
  headers.delete("x-owt-workspace-id");
  headers.delete("x-owt-host-mode");
  headers.set("x-owt-pathname", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return headers;
}

export async function proxy(request: NextRequest) {
  const legacySearch = await legacyCatalogSearch(request.nextUrl.pathname, request.nextUrl.searchParams, (kind, id) =>
    resolveLegacy(request.nextUrl.origin, kind, id)
  );
  if (legacySearch) {
    const target = request.nextUrl.clone();
    target.search = legacySearch;
    return NextResponse.redirect(target, 308);
  }

  const rawHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const host = rawHost?.split(",")[0]?.trim() ?? null;
  const resolution = resolveHost(host);

  if (resolution.mode === "platform") {
    return NextResponse.next({ request: { headers: scopedHeaders(request) } });
  }

  const lookup = await resolveWorkspace(request.nextUrl.origin, resolution.host);

  if (lookup.status === "found") {
    const headers = scopedHeaders(request);
    headers.set("x-owt-workspace-id", String(lookup.id));
    headers.set("x-owt-host-mode", "tenant");
    return NextResponse.next({ request: { headers } });
  }

  if (lookup.status === "not_found") {
    return NextResponse.rewrite(new URL("/not-configured", request.url), { status: 404 });
  }

  // Transient lookup failure — do not 404 a real tenant.
  return new NextResponse("Service temporarily unavailable", {
    status: 503,
    headers: { "retry-after": "5" },
  });
}

export const config = {
  // Skip API route handlers, Next internals, and static assets.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|webp|svg|ico)).*)"],
};
