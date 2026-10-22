import { Api } from "../support/api";
import { expect, test } from "../support/fixtures";
import { createWorkspace } from "../support/seed";
import { createMap, createMix, seedMembers, type Mix, type MixVariant } from "../support/team-formation";

// Pickup mixes (custom games, the `mix` schema after schemasplit01): roster,
// balance, lobbies, recorded matches with rank movement, self-service seats,
// and the public read surface.

const SHAPE = { tank: 1, damage: 2, support: 2 };
const seatCounts = (variant: MixVariant) =>
  variant.teams.map((team) => Object.fromEntries(Object.entries(team.roster).map(([role, ids]) => [role, ids.length])));

test("host runs a mix: balance → page options → swap → roll map → record → undo → close → delete", async ({ adminApi, anonApi }) => {
  const ws = await createWorkspace(adminApi);
  const members = await seedMembers(adminApi, ws.id, 11);
  const map = await createMap(adminApi);
  let mix = await createMix(adminApi, ws.id, members.map((m) => m.member_id));
  const game = `/api/v1/balancer/workspaces/${ws.id}/custom-games/${mix.id}`;
  expect(mix).toMatchObject({ status: "draft", lobby_count: 1 });
  expect(mix.players).toHaveLength(11);
  expect(mix.players.every((p) => p.participation === "pool" && Object.values(p.ranks).some((r) => r !== null)), "every seat resolved a rank").toBe(true);

  mix = await adminApi.post<Mix>(`${game}/balance`, { scope: "lobby", lobby_index: 0 });
  expect(mix.status).toBe("balanced");
  const [lobby] = mix.lobbies;
  expect(lobby.balanced_at).not.toBeNull();
  expect(lobby.selected_variant_index).toBe(0);
  const variants = lobby.balance_result!.variants;
  expect(variants.length).toBeGreaterThan(1);
  expect(seatCounts(variants[0])).toEqual([SHAPE, SHAPE]);
  expect(variants[0].benched).toHaveLength(1);
  expect(mix.players.filter((p) => p.current_lobby === 0)).toHaveLength(10);

  await adminApi.put(`${game}/variant`, { lobby_index: 0, variant_index: 1 });
  expect((await anonApi.get<Mix>(`/api/v1/balancer/custom-games/${mix.id}`)).lobbies[0].selected_variant_index, "the shown option is shared by every viewer").toBe(1);
  expect((await adminApi.raw("PUT", `${game}/variant`, { body: { lobby_index: 0, variant_index: 999 } })).status()).toBe(404);
  await adminApi.put(`${game}/variant`, { lobby_index: 0, variant_index: 0 });

  const [a] = variants[0].teams[0].roster.damage;
  const [b] = variants[0].teams[1].roster.damage;
  mix = await adminApi.post<Mix>(`${game}/teams/swap`, { variant_index: 0, first_uuid: a, second_uuid: b });
  const swapped = mix.lobbies[0].balance_result!.variants[0];
  expect(swapped.teams[0].roster.damage).toContain(b);
  expect(swapped.teams[1].roster.damage).toContain(a);
  const crossRole = await adminApi.raw("POST", `${game}/teams/swap`, {
    body: { variant_index: 0, first_uuid: swapped.teams[0].roster.tank[0], second_uuid: swapped.teams[1].roster.support[0] },
  });
  expect(crossRole.status(), "swap across roles").toBe(422);

  await adminApi.put(`${game}/team-names`, { team_names: { "0": "Red", "1": "Blue" } });
  mix = await adminApi.put<Mix>(`${game}/next-map`, { lobby_index: 0, map_id: map.id });
  expect(mix.lobbies[0].next_map_id).toBe(map.id);
  expect((await adminApi.raw("PUT", `${game}/next-map`, { body: { lobby_index: 0, map_id: 2_000_000_000 } })).status()).toBe(404);

  expect((await adminApi.raw("POST", `${game}/outcome`, { body: { lobby_index: 0, outcome: { winner: 1 } } })).status(), "a result needs a started match").toBe(409);
  await adminApi.post(`${game}/match/start`, { lobby_index: 0 });
  expect((await adminApi.raw("POST", `${game}/teams/swap`, { body: { variant_index: 0, first_uuid: a, second_uuid: b } })).status(), "a live match's lineup is frozen").toBe(409);
  mix = await adminApi.post<Mix>(`${game}/outcome`, { lobby_index: 0, outcome: { winner: 1 } });
  expect(mix.matches_count).toBe(1);
  expect(mix.lobbies[0].next_map_id, "a recorded match consumes the rolled map").toBeNull();
  type Match = { id: number; winner_slot: number | null; map_id: number | null; map_name: string | null; teams: { slot: number; name: string; score: number }[] };
  let matches = await anonApi.get<Match[]>(`${game}/matches`);
  expect(matches).toEqual([
    expect.objectContaining({
      winner_slot: 1,
      map_id: map.id,
      map_name: map.name,
      teams: [expect.objectContaining({ slot: 1, name: "Red", score: 1 }), expect.objectContaining({ slot: 2, name: "Blue", score: 0 })],
    }),
  ]);

  type StatRow = { workspace_member_id: number; games: number; wins: number; losses: number };
  const stats = await anonApi.get<{ members: StatRow[] }>(`/api/v1/balancer/workspaces/${ws.id}/custom-games/stats`, { discipline: "overwatch" });
  const winners = Object.values(swapped.teams[0].roster).flat().map(Number);
  expect(stats.members.filter((m) => winners.includes(m.workspace_member_id)).map((m) => m.wins)).toEqual([1, 1, 1, 1, 1]);
  expect(stats.members.filter((m) => !winners.includes(m.workspace_member_id)).every((m) => m.wins === 0)).toBe(true);
  const rotation = await anonApi.get<{ workspace_member_id: number; games_played: number }[]>(`${game}/rotation`);
  expect(rotation.find((r) => r.workspace_member_id === Number(variants[0].benched[0]))?.games_played, "benched player sat out").toBe(0);

  await adminApi.post(`${game}/match/start`, { lobby_index: 0 });
  await adminApi.post(`${game}/match/cancel`, { lobby_index: 0 });
  expect((await anonApi.get<Match[]>(`${game}/matches`)).length, "a cancelled match leaves no result").toBe(1);
  await adminApi.post(`${game}/match/start`, { lobby_index: 0 });
  mix = await adminApi.post<Mix>(`${game}/outcome`, { lobby_index: 0, outcome: { winner: null } });
  matches = await anonApi.get<Match[]>(`${game}/matches`);
  expect(matches.map((m) => m.winner_slot)).toEqual([null, 1]);
  expect((await adminApi.raw("DELETE", `${game}/matches/${matches[1].id}`)).status(), "only the lobby's newest match can be undone").toBe(409);
  await adminApi.delete(`${game}/matches/${matches[0].id}`);
  expect((await anonApi.get<Match[]>(`${game}/matches`)).map((m) => m.id)).toEqual([matches[1].id]);

  mix = await adminApi.put<Mix>(`${game}/players`, {
    players: [
      { workspace_member_id: members[0].member_id, participation: "benched" },
      { workspace_member_id: members[1].member_id, participation: "must_play" },
    ],
  });
  expect(mix.players.find((p) => p.workspace_member_id === members[0].member_id)?.participation).toBe("benched");
  expect(mix.players.find((p) => p.workspace_member_id === members[1].member_id)?.participation).toBe("must_play");

  mix = await adminApi.post<Mix>(`${game}/close`);
  expect(mix.status).toBe("completed");
  expect((await adminApi.raw("PUT", `${game}/name`, { body: { name: "late" } })).status(), "writes after close").toBe(409);
  const list = (status: string) =>
    anonApi.get<{ items: { id: number }[] }>(`/api/v1/balancer/workspaces/${ws.id}/custom-games`, { status }).then((page) => page.items.map((i) => i.id));
  expect(await list("history")).toContain(mix.id);
  expect(await list("open")).not.toContain(mix.id);
  expect((await anonApi.get<Match[]>(`${game}/matches`)).length, "closing keeps history").toBe(1);

  await adminApi.delete(game);
  expect((await anonApi.raw("GET", `/api/v1/balancer/custom-games/${mix.id}`)).status()).toBe(404);
});

test("mix reads are public; writes belong to the host and co-hosts; delete to workspace admins", async ({ adminApi, anonApi, makeUser }) => {
  const ws = await createWorkspace(adminApi);
  const members = await seedMembers(adminApi, ws.id, 10);
  const mix = await createMix(adminApi, ws.id, members.map((m) => m.member_id));
  const game = `/api/v1/balancer/workspaces/${ws.id}/custom-games/${mix.id}`;

  for (const url of [
    `/api/v1/balancer/workspaces/${ws.id}/custom-games`,
    `/api/v1/balancer/workspaces/${ws.id}/custom-games/stats`,
    `/api/v1/balancer/custom-games/${mix.id}`,
    `${game}/matches`,
    `${game}/rotation`,
  ]) {
    expect((await anonApi.raw("GET", url)).status(), `anonymous GET ${url}`).toBe(200);
  }
  expect((await anonApi.raw("GET", `/api/v1/balancer/custom-games/${mix.id}`, { query: { workspace_id: ws.id + 100_000 } })).status(), "foreign workspace scope").toBe(404);
  expect((await anonApi.raw("POST", `${game}/balance`, { body: {} })).status()).toBe(401);
  expect((await anonApi.raw("GET", `/api/v1/balancer/workspaces/${ws.id}/custom-games`, { query: { status: "nope" } })).status()).toBe(422);

  const invited = await makeUser("cohost");
  const stranger = await makeUser("stranger");
  await adminApi.post(`/api/v1/workspaces/${ws.id}/members`, { auth_user_id: invited.id }, 201);
  // The gateway/identity RBAC caches pin a session's memberships for ~40 s (reported
  // separately); a session opened after the join sees the membership at once.
  const login = await anonApi.post<{ access_token: string }>("/api/v1/auth/login", { email: invited.email, password: invited.password });
  const cohost = new Api(anonApi.ctx, login.access_token);
  expect((await stranger.api.raw("PUT", `${game}/name`, { body: { name: "nope" } })).status(), "a stranger").toBe(403);
  expect((await adminApi.raw("POST", `${game}/co-hosts`, { body: { co_host_user_id: stranger.id } })).status(), "co-host outside the workspace").toBe(404);

  await adminApi.post(`${game}/co-hosts`, { co_host_user_id: invited.id });
  expect((await cohost.put<Mix>(`${game}/name`, { name: "  Co-hosted  " })).name, "trimmed").toBe("Co-hosted");
  expect((await cohost.raw("DELETE", game)).status(), "co-hosts cannot hard-delete").toBe(403);
  await adminApi.delete(`${game}/co-hosts/${invited.id}`);
  expect((await cohost.raw("PUT", `${game}/name`, { body: { name: "ex" } })).status(), "revoked co-host").toBe(403);

  const handedOver = await adminApi.put<Mix>(`${game}/host`, { new_host_user_id: invited.id });
  expect(handedOver.host_user_id).toBe(invited.id);
  expect((await cohost.post<Mix>(`${game}/close`)).status).toBe("completed");
  await adminApi.delete(game);
});

test("two lobbies: pins are validated and a whole-pool balance seats disjoint lobbies", async ({ adminApi, anonApi }) => {
  const ws = await createWorkspace(adminApi);
  const members = await seedMembers(adminApi, ws.id, 20);
  const mix = await createMix(adminApi, ws.id, members.map((m) => m.member_id));
  const game = `/api/v1/balancer/workspaces/${ws.id}/custom-games/${mix.id}`;

  expect((await adminApi.raw("POST", `${game}/balance`, { body: { scope: "all" } })).status(), "scope all on one lobby").toBe(422);
  expect((await adminApi.raw("PUT", `${game}/lobbies`, { body: { lobby_count: 7 } })).status()).toBe(422);
  const two = await adminApi.put<Mix>(`${game}/lobbies`, { lobby_count: 2 });
  expect(two.lobbies.map((l) => l.lobby_index)).toEqual([0, 1]);
  expect((await adminApi.raw("PUT", `${game}/players/${members[0].member_id}`, { body: { lobby_pin: 2 } })).status(), "pin past the lobby count").toBe(422);
  await adminApi.put(`${game}/players/${members[0].member_id}`, { lobby_pin: 1 });

  const balanced = await adminApi.post<Mix>(`${game}/balance`, { scope: "all" });
  const seated = balanced.lobbies.map((l) => l.balance_result!.variants[l.selected_variant_index].teams.flatMap((t) => Object.values(t.roster).flat()));
  expect(seated.map((ids) => ids.length)).toEqual([10, 10]);
  expect(new Set([...seated[0], ...seated[1]]).size, "nobody plays in both lobbies").toBe(20);
  expect(seated[1], "the pinned player is in lobby B").toContain(String(members[0].member_id));
  const board = await anonApi.get<Mix>(`/api/v1/balancer/custom-games/${mix.id}`);
  expect(board.players.find((p) => p.workspace_member_id === members[0].member_id)?.current_lobby).toBe(1);

  const one = await adminApi.put<Mix>(`${game}/lobbies`, { lobby_count: 1 });
  expect(one.lobbies).toHaveLength(1);
  expect(one.players.find((p) => p.workspace_member_id === members[0].member_id)?.lobby_pin, "shrinking frees pins to dropped lobbies").toBeNull();
  await adminApi.delete(game);
});

test("self-service seat: unlinked accounts get the blocker, a seated player may leave; mix preferences are per account", async ({ adminApi, makeUser }) => {
  const ws = await createWorkspace(adminApi);
  const members = await seedMembers(adminApi, ws.id, 4);
  const player = await makeUser("seat");
  const joined = await adminApi.post<{ id: number }>(`/api/v1/workspaces/${ws.id}/members`, { auth_user_id: player.id }, 201);
  const roster = await adminApi.get<{ results: { member_id: number; auth_user_id: number | null }[] }>(`/api/v1/balancer/workspaces/${ws.id}/players`, {
    discipline: "overwatch",
    query: player.username,
  });
  const seat = roster.results.find((r) => r.auth_user_id === player.id);
  expect(seat, `roster row for workspace member ${joined.id}`).toBeTruthy();
  await adminApi.put(`/api/v1/balancer/workspaces/${ws.id}/players/${seat!.member_id}/ranks`, { discipline: "overwatch", scope: "workspace", ranks: { support: 2500 } });
  const mix = await createMix(adminApi, ws.id, [...members.map((m) => m.member_id), seat!.member_id]);
  const game = `/api/v1/balancer/workspaces/${ws.id}/custom-games/${mix.id}`;
  await adminApi.put(`${game}/self-service`, { self_signup: "pool", self_role_edit: true });

  type SelfState = { seat: { participation: string; ranks: Record<string, number | null> } | null; policy: { can_join: boolean; can_leave: boolean; join_blocker: string | null; edit_blocker: string | null } };
  const mine = await player.api.get<SelfState>(`${game}/me`);
  expect(mine.seat).toMatchObject({ participation: "pool", ranks: expect.objectContaining({ support: 2500 }) });
  // No Discord / Battle.net link can exist in this stack (OAuth is out of scope): the policy says so instead of failing open.
  expect(mine.policy).toMatchObject({ can_join: false, can_leave: true, join_blocker: "discord_not_linked" });
  const outsider = await makeUser("noseat");
  const refused = await outsider.api.raw("POST", `${game}/me`);
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toMatchObject({ detail: "discord_not_linked" });

  expect((await player.api.call<SelfState>("DELETE", `${game}/me`)).seat).toBeNull();
  expect((await player.api.raw("DELETE", `${game}/me`)).status(), "leaving twice").toBe(404);
  expect((await adminApi.get<Mix>(`/api/v1/balancer/custom-games/${mix.id}`)).players.map((p) => p.workspace_member_id)).not.toContain(seat!.member_id);

  const prefs = { max_result_variants: 5, mix_comfort_tilt: 0.3, open_slot_settings: null, points_per_win: 25, rating_mode: "points", role_settings: null };
  expect(await player.api.put("/api/v1/balancer/me/mix-preferences", prefs)).toMatchObject(prefs);
  expect(await player.api.get("/api/v1/balancer/me/mix-preferences")).toMatchObject(prefs);
  expect(await outsider.api.get("/api/v1/balancer/me/mix-preferences"), "another account keeps its defaults").toMatchObject({ points_per_win: null, mix_comfort_tilt: null });
  await adminApi.delete(game);
});
