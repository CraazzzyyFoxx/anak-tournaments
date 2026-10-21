import { PLAYER_SORTS, type PlayerSort } from "@/types/statistics.types";

export const PLAYERS_PER_PAGE = 20;

type RawParam = string | string[] | undefined;

const first = (value: RawParam) => (Array.isArray(value) ? value[0] : value);

export interface PlayersParams {
  sort: PlayerSort;
  /** The `?q=` search, trimmed; empty is no search. */
  query: string;
  page: number;
}

/** The players table's URL state; anything unreadable is the default. */
export function parsePlayersParams(raw: { sort?: RawParam; q?: RawParam; page?: RawParam }): PlayersParams {
  const sort = first(raw.sort);
  const page = Number(first(raw.page));
  return {
    sort: PLAYER_SORTS.includes(sort as PlayerSort) ? (sort as PlayerSort) : "titles",
    query: first(raw.q)?.trim() ?? "",
    page: Number.isInteger(page) && page > 1 ? page : 1
  };
}

/** A sort header's address: the page's game and search stay, the page resets, the default sort is the bare URL. */
export function playersSortHref(
  sort: PlayerSort,
  { discipline, query }: Readonly<{ discipline: RawParam; query: string }>
): string {
  const params = new URLSearchParams();
  const game = first(discipline);
  if (game) params.set("discipline", game);
  if (query) params.set("q", query);
  if (sort !== "titles") params.set("sort", sort);
  const search = params.toString();
  return search ? `/statistics?${search}` : "/statistics";
}

/** Seconds as `m:ss`: `754` → `12:34`. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** `Nick#1234` → `["Nick", "#1234"]`; a name without a discriminator has none. */
export function splitBattleTag(name: string): [string, string | null] {
  const at = name.indexOf("#");
  return at === -1 ? [name, null] : [name.slice(0, at), name.slice(at)];
}
