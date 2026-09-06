/**
 * A hub container (`/teams`, `/matches`, …) has no view of its own: its index
 * forwards to the first sub-tab. The query string carries over, so a deep link
 * like `?challongeSync=1` still reaches the screen that answers it.
 */
export function withSearch(
  path: string,
  searchParams: Record<string, string | string[] | undefined>
): string {
  const query = new URLSearchParams();
  for (const [key, raw] of Object.entries(searchParams)) {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value !== undefined) query.set(key, value);
  }
  return query.size ? `${path}?${query}` : path;
}
