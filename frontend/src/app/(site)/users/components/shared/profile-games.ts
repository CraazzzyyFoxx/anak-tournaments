import { resolvePageGame, type GameScopeInit } from "@/lib/site/discipline-scope";
import type { DisciplineDescriptor } from "@/types/discipline.types";
import type { UserGameSummary, UserProfile } from "@/types/user.types";

/**
 * The player's games, most tournaments first, ties in the area's order (R14): `init.disciplines` is the area's list
 * in area order (the community's `disciplines_enabled`; installed order under all communities).
 */
export function orderPlayerGames(games: readonly UserGameSummary[], init: GameScopeInit): UserGameSummary[] {
  const area = (init.disciplines ?? []).map((entry) => entry.code);
  const rank = (code: string) => (area.includes(code) ? area.indexOf(code) : area.length);
  return [...games].sort(
    (a, b) => b.tournaments_count - a.tournaments_count || rank(a.discipline) - rank(b.discipline)
  );
}

/** The area's games the player played, in `orderPlayerGames` order. */
export function playerGameChoices(games: readonly UserGameSummary[], init: GameScopeInit): DisciplineDescriptor[] {
  const area = init.disciplines ?? [];
  return orderPlayerGames(games, init).flatMap((game) => area.filter((entry) => entry.code === game.discipline));
}

/** Under a concrete scope the profile is bound to one game: its card comes from that profile (R15). */
export function boundGameSummary(
  profile: Pick<UserProfile, "roles" | "tournaments_count" | "tournaments_won">,
  discipline: string
): UserGameSummary {
  return {
    discipline,
    roles: profile.roles,
    tournaments_count: profile.tournaments_count,
    tournaments_won: profile.tournaments_won
  };
}

/**
 * The game a per-game profile tab reads under "all games" (spec §6.6): the last game if the player played it, else
 * the player's main game. The same "single" resolution `ProfileGameTabs` runs on the client, so both agree.
 */
export function blockGameOf(games: readonly UserGameSummary[], init: GameScopeInit): string | null {
  const { game } = resolvePageGame({
    pageClass: "single",
    ownerGame: null,
    explicit: null,
    stored: init.stored,
    lastGame: init.lastGame,
    games: playerGameChoices(games, init)
  });
  return game.kind === "game" ? game.code : null;
}
