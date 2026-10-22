import { expect, test } from "../support/fixtures";
import { seedBracket, type BracketSeed } from "../support/flows";
import type { Api } from "../support/api";

type FfaRow = {
  team_id: number;
  /** Written by the async standings job; null until it has ranked the group once. */
  position: number | null;
  points: number;
  games_played: number;
  games: { position: number; state: string | null }[];
};
type FfaLobby = { encounter_id: number; best_of: number; status: string; result_status: string; rows: FfaRow[] };

function ranking(api: Api, seed: BracketSeed) {
  return api.get<FfaLobby[]>(`/api/v1/tournaments/${seed.tournament.id}/stages/${seed.stage.id}/ffa`);
}

async function lobbySeed(api: Api) {
  const seed = await seedBracket(api, { teams: 4, stageType: "ffa_league", bestOf: 3, players: false });
  const [lobby] = await ranking(api, seed);
  expect(lobby.rows.map((r) => r.team_id).sort(), "the lobby seats every team").toEqual(seed.teams.map((t) => t.id).sort());
  return { seed, lobby };
}

test.describe("ffa league", () => {
  test("games count reshapes the lobby's card; players cannot change it", async ({ adminApi, makeUser }) => {
    const { seed, lobby } = await lobbySeed(adminApi);
    expect(lobby.best_of).toBe(3);

    const updated = await adminApi.post<FfaLobby>(`/api/v1/admin/encounters/${lobby.encounter_id}/ffa/games-count`, { games: 2 });
    expect(updated.best_of).toBe(2);
    expect(updated.rows.every((r) => r.games.length === 2), "every row shows two game cells").toBe(true);
    expect((await ranking(adminApi, seed))[0].best_of, "public ranking reflects the new count").toBe(2);

    const player = await makeUser("ffa");
    const denied = await player.api.raw("POST", `/api/v1/admin/encounters/${lobby.encounter_id}/ffa/games-count`, { body: { games: 5 } });
    expect(denied.status(), "a player cannot reshape a lobby").toBe(403);
  });

  test("per-game results rank the lobby and a cancelled game drops out of the ranking", async ({ adminApi }) => {
    const { seed, lobby } = await lobbySeed(adminApi);
    const ids = seed.teams.map((t) => t.id);
    const enter = (position: number, scores: number[]) =>
      adminApi.post<FfaLobby>(`/api/v1/admin/encounters/${lobby.encounter_id}/ffa/games/${position}/results`, {
        results: ids.map((team_id, i) => ({ team_id, stats: { score: scores[i] } })),
      });

    // `[points, games played]` per team: the write answers them at once.
    const tally = (rows: FfaRow[]) => Object.fromEntries(rows.map((r) => [r.team_id, [r.points, r.games_played]]));
    // Positions come from the standings job the write enqueues, so they are read back from the public table.
    const expectOrder = (teamIds: number[], message: string) =>
      expect
        .poll(
          async () => {
            const [table] = await ranking(adminApi, seed);
            return [...table.rows].sort((a, b) => (a.position ?? 99) - (b.position ?? 99)).map((r) => [r.team_id, r.position]);
          },
          { message, timeout: 30_000 }
        )
        .toEqual(teamIds.map((id, i) => [id, i + 1]));

    await enter(1, [10, 7, 5, 1]);
    const after2 = await enter(2, [1, 8, 9, 3]);
    expect(tally(after2.rows), "points sum the score column over both games").toEqual({
      [ids[0]]: [11, 2],
      [ids[1]]: [15, 2],
      [ids[2]]: [14, 2],
      [ids[3]]: [4, 2],
    });
    await expectOrder([ids[1], ids[2], ids[0], ids[3]], "public ranking orders the lobby by points");

    const cancelled = await adminApi.post<FfaLobby>(`/api/v1/admin/encounters/${lobby.encounter_id}/ffa/games/2/cancel`, { reason: "Server crash" });
    expect(tally(cancelled.rows), "a cancelled game no longer counts").toEqual({
      [ids[0]]: [10, 1],
      [ids[1]]: [7, 1],
      [ids[2]]: [5, 1],
      [ids[3]]: [1, 1],
    });
    expect(tally((await ranking(adminApi, seed))[0].rows), "public table matches the organizer's after the cancel").toEqual(tally(cancelled.rows));
    await expectOrder([ids[0], ids[1], ids[2], ids[3]], "the ranking re-sorts without the cancelled game");

    const replayed = await enter(2, [0, 0, 0, 8]);
    expect(tally(replayed.rows), "the voided position is replayed as a new game").toEqual({
      [ids[0]]: [10, 2],
      [ids[1]]: [7, 2],
      [ids[2]]: [5, 2],
      [ids[3]]: [9, 2],
    });
    await expectOrder([ids[0], ids[3], ids[1], ids[2]], "the replayed game moves the ranking");
  });
});
