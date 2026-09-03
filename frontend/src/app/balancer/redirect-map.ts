// D28: permanent redirects from legacy /balancer/* routes to the hub routes.
// Filters worth keeping across the redirect (SK-O5) are carried over; the
// tournament id moves from the query string into the path.
const CARRIED_PARAMS = ["status", "source", "group"] as const;

export function balancerRedirectTarget(path: string, params: URLSearchParams): string {
  const t = params.get("tournament");
  const carry = new URLSearchParams();
  for (const k of CARRIED_PARAMS) {
    const v = params.get(k);
    if (v) carry.set(k, v);
  }
  const q = carry.size ? `?${carry}` : "";
  if (path.startsWith("/balancer/statuses")) return "/admin/settings/statuses";
  if (!t) return "/admin/tournaments";
  const base = `/admin/tournaments/${t}/registration`;
  if (path === "/balancer/registrations") return `${base}${q}`;
  if (path === "/balancer/registrations/form") return `${base}/form`;
  if (path === "/balancer/registrations/rank-autofill") return `${base}/rank-autofill`;
  if (path === "/balancer/registrations/feed") return `${base}/feed`;
  if (path === "/balancer/pool") return base;
  if (path === "/balancer/applications") return `${base}?source=google_sheets`;
  return "/admin/tournaments";
}

// Next.js server pages resolve `searchParams` to a plain record; multi-value
// params keep their first value, matching URLSearchParams.get semantics.
export function searchParamsFromRecord(
  record: Record<string, string | string[] | undefined>
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(record)) {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value !== undefined) params.set(key, value);
  }
  return params;
}
