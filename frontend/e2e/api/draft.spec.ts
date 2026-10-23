import { expect, test } from "../support/fixtures";
import { listTeams } from "../support/flows";
import { draftBoard, pickFirstSafe, seedDraft, type DraftSession, type PickOptions } from "../support/team-formation";

// Live draft (schemasplit01 moved it into the `draft` schema): seed → start →
// captain picks with the server clock and admin controls → export into
// tournament teams; the public spectate reads and the room chat.

test("captains draft in snake order; admin extend/autopick/pause/resume/rollback/override; export creates the teams", async ({
  adminApi,
  anonApi,
  makeUser,
}) => {
  const d = await seedDraft(adminApi, makeUser, { start: true });
  const [c1, c2] = d.captains;
  const sid = d.session.id;
  expect(d.session.status).toBe("live");

  let board = await draftBoard(anonApi, sid);
  expect(board.teams.map((t) => t.captain_auth_user_id)).toEqual([c1.id, c2.id]);
  expect(board.players.filter((p) => !p.is_captain)).toHaveLength(8);
  expect(board.current_pick).toMatchObject({ overall_no: 1, draft_team_id: board.teams[0].id, status: "on_clock" });
  const team1 = board.teams[0].id;
  const team2 = board.teams[1].id;
  const available = () => board.players.filter((p) => p.status === "available").map((p) => p.id);

  // Only the on-clock captain picks, with the pick's current version.
  const pick1 = board.current_pick!;
  const target = available()[0];
  expect((await c2.api.raw("POST", `/api/v1/balancer/draft/picks/${pick1.id}/select`, { body: { expected_version: pick1.version, player_id: target } })).status(), "out of turn").toBe(403);
  expect((await anonApi.raw("POST", `/api/v1/balancer/draft/picks/${pick1.id}/select`, { body: { expected_version: pick1.version, player_id: target } })).status(), "anonymous").toBe(401);
  expect((await c1.api.raw("POST", `/api/v1/balancer/draft/picks/${pick1.id}/select`, { body: { expected_version: pick1.version + 7, player_id: target } })).status(), "stale version").toBe(409);
  expect((await c2.api.raw("GET", `/api/v1/balancer/draft/picks/${pick1.id}/options`)).status(), "options are the on-clock captain's").toBe(403);
  const first = await pickFirstSafe(c1.api, pick1.id);
  board = await draftBoard(anonApi, sid);
  expect(board.picks[0]).toMatchObject({ status: "completed", picked_player_id: first.player_id, picked_by_user_id: expect.any(Number), is_autopick: false });
  expect(board.current_pick).toMatchObject({ overall_no: 2, draft_team_id: team2 });

  // Captain-private reads: own fit/queue yes, the other team's no; suggestions/journal are staff reads.
  const fit = await c2.api.get<{ scores: { player_id: number }[] }>(`/api/v1/balancer/draft/sessions/${sid}/teams/${team2}/fit`);
  expect(fit.scores.length).toBeGreaterThan(0);
  expect((await c2.api.raw("GET", `/api/v1/balancer/draft/sessions/${sid}/teams/${team1}/fit`)).status()).toBe(403);
  const queueHead = available().at(-1)!;
  await c2.api.put(`/api/v1/balancer/draft/sessions/${sid}/teams/${team2}/queue`, { player_ids: [queueHead] });
  expect(await c2.api.get(`/api/v1/balancer/draft/sessions/${sid}/teams/${team2}/queue`)).toMatchObject({
    player_ids: [queueHead],
    autopick_preview: { player_id: queueHead, source: "queue" },
  });
  expect((await c1.api.raw("GET", `/api/v1/balancer/draft/sessions/${sid}/teams/${team2}/queue`)).status(), "another team's queue").toBe(403);
  expect((await c2.api.raw("PUT", `/api/v1/balancer/draft/sessions/${sid}/teams/${team2}/queue`, { body: { player_ids: [first.player_id] } })).status(), "queueing a drafted player").toBe(422);
  const suggestions = await adminApi.get<{ pick_id: number; suggestions: unknown[] }>(`/api/v1/balancer/draft/sessions/${sid}/suggestions`);
  expect(suggestions.pick_id).toBe(board.current_pick!.id);
  expect(suggestions.suggestions.length).toBeGreaterThan(0);
  expect((await c2.api.raw("GET", `/api/v1/balancer/draft/sessions/${sid}/journal`)).status()).toBe(403);

  // Admin: extend moves the deadline, autopick takes the captain's queue head.
  let pick = board.current_pick!;
  await adminApi.post(`/api/v1/balancer/draft/picks/${pick.id}/extend`, { expected_version: pick.version, seconds: 30 });
  board = await draftBoard(anonApi, sid);
  expect(Date.parse(board.current_pick!.clock_expires_at!) - Date.parse(pick.clock_expires_at!)).toBe(30_000);
  pick = board.current_pick!;
  expect((await c2.api.raw("POST", `/api/v1/balancer/draft/picks/${pick.id}/autopick`, { body: { expected_version: pick.version, reason: "admin" } })).status()).toBe(403);
  await adminApi.post(`/api/v1/balancer/draft/picks/${pick.id}/autopick`, { expected_version: pick.version, reason: "admin" });
  board = await draftBoard(anonApi, sid);
  expect(board.picks[1]).toMatchObject({ status: "autopicked", is_autopick: true, picked_player_id: queueHead });

  // Pause freezes picking; resume reopens the same pick.
  await adminApi.post(`${d.lifecycle}/pause`);
  board = await draftBoard(anonApi, sid);
  expect(board.session.status).toBe("paused");
  pick = board.current_pick!;
  const paused = await c2.api.raw("POST", `/api/v1/balancer/draft/picks/${pick.id}/select`, { body: { expected_version: pick.version, player_id: available()[0] } });
  expect(paused.status(), "pick while paused").toBe(409);
  await adminApi.post(`${d.lifecycle}/resume`);
  expect((await draftBoard(anonApi, sid)).session.status).toBe("live");

  // Rollback returns the newest pick's player to the pool.
  const third = await pickFirstSafe(c2.api, pick.id);
  await adminApi.post(`${d.lifecycle}/rollback`);
  board = await draftBoard(anonApi, sid);
  expect(board.players.find((p) => p.id === third.player_id)?.status).toBe("available");
  expect(board.current_pick).toMatchObject({ overall_no: 3, draft_team_id: team2 });
  if (board.session.status === "paused") await adminApi.post(`${d.lifecycle}/resume`);

  // Override: an admin picks for the on-clock team.
  board = await draftBoard(anonApi, sid);
  pick = board.current_pick!;
  const override = available().find((id) => id !== third.player_id)!;
  await adminApi.post(`/api/v1/balancer/draft/picks/${pick.id}/override`, { expected_version: pick.version, player_id: override, note: "e2e" });
  board = await draftBoard(anonApi, sid);
  expect(board.picks[2]).toMatchObject({ picked_player_id: override, is_admin_override: true });

  // The captains finish the draft.
  while (board.current_pick) {
    const captain = board.current_pick.draft_team_id === team1 ? c1 : c2;
    await pickFirstSafe(captain.api, board.current_pick.id);
    board = await draftBoard(anonApi, sid);
  }
  expect(board.session.status).toBe("completed");
  expect(board.players.every((p) => p.status !== "available"), "every pool player drafted").toBe(true);
  expect(await adminApi.get(`/api/v1/balancer/draft/sessions/${sid}/feasibility`)).toMatchObject({ is_feasible: true, total_open_slots: 0 });

  const journal = await adminApi.get<{ entries: { action: string }[] }>(`/api/v1/balancer/draft/sessions/${sid}/journal`);
  expect(journal.entries.map((e) => e.action)).toEqual(
    expect.arrayContaining(["started", "pick_made", "pick_extended", "pick_autopicked", "paused", "resumed", "rollback", "pick_overridden"])
  );

  const exported = await adminApi.post<DraftSession & { advisories: string[] }>(`${d.base}/export`);
  expect(exported.advisories).toEqual([]);
  const teams = await listTeams(adminApi, d.tournament.id);
  expect(teams).toHaveLength(2);
  for (const [i, team] of board.teams.entries()) {
    const drafted = board.players.filter((p) => p.drafted_by_team_id === team.id).map((p) => p.identity!.handle).sort();
    const materialized = teams.find((t) => t.players.some((p) => p.name === d.captainTags[i]));
    expect(materialized, `exported team of ${d.captainTags[i]}`).toBeTruthy();
    expect(materialized!.players.map((p) => p.name).sort()).toEqual(drafted);
    expect(materialized!.players.find((p) => p.user_id === materialized!.captain_id)?.name, "captain carried over").toBe(d.captainTags[i]);
  }
  expect(await adminApi.post(`${d.base}/export-ranks`)).toMatchObject({ success: true });

  // A completed session can be erased; the teams it exported stay.
  await adminApi.delete(d.base, 204);
  expect(await anonApi.get(`/api/v1/balancer/draft/tournaments/${d.tournament.id}/draft`)).toBeNull();
  expect((await listTeams(adminApi, d.tournament.id)).map((t) => t.id).sort()).toEqual(teams.map((t) => t.id).sort());
});

test("the server clock autopicks an expired pick", async ({ adminApi, anonApi, makeUser }) => {
  const d = await seedDraft(adminApi, makeUser, { start: true, pickTimeSeconds: 10 });
  await expect
    .poll(async () => (await draftBoard(anonApi, d.session.id)).picks[0].status, { timeout: 30_000, message: "pick 1 autopicked after its 10 s clock" })
    .toBe("autopicked");
  const board = await draftBoard(anonApi, d.session.id);
  expect(board.current_pick).toMatchObject({ overall_no: 2, status: "on_clock" });
  const journal = await adminApi.get<{ entries: { action: string; actor_auth_user_id: number | null; reason: string }[] }>(
    `/api/v1/balancer/draft/sessions/${d.session.id}/journal`
  );
  expect(journal.entries[0]).toMatchObject({ action: "pick_autopicked", actor_auth_user_id: null, reason: "expiry" });
  await adminApi.post(`${d.lifecycle}/cancel`);
});

test("session lifecycle guards: one active draft, delete needs a stopped draft, seed needs captains, preview writes nothing", async ({
  adminApi,
  anonApi,
  makeUser,
}) => {
  const d = await seedDraft(adminApi, makeUser);
  const sessions = `/api/v1/balancer/draft/tournaments/${d.tournament.id}/sessions`;
  const captainRegs = (await draftBoard(anonApi, d.session.id)).players
    .filter((p) => p.is_captain)
    .map((p) => ({ registration_id: p.registration_id }));
  expect((await adminApi.raw("POST", sessions, { body: { pool_source: "manual" } })).status(), "a second active draft").toBe(409);

  expect((await adminApi.post<DraftSession>(`${d.lifecycle}/start`)).status).toBe("live");
  expect((await adminApi.raw("DELETE", d.base)).status(), "delete while live").toBe(409);
  const outsider = await makeUser("nodraft");
  expect((await outsider.api.raw("POST", `${d.lifecycle}/pause`)).status()).toBe(403);
  expect((await anonApi.get<{ session: DraftSession }>(`/api/v1/balancer/draft/tournaments/${d.tournament.id}/draft`)).session.id).toBe(d.session.id);
  expect(await anonApi.get(`/api/v1/balancer/draft/sessions/${d.session.id}`)).toMatchObject({ status: "live" });
  expect((await adminApi.post<DraftSession>(`${d.lifecycle}/cancel`)).status).toBe("cancelled");
  await adminApi.delete(d.base, 204);

  const fresh = await adminApi.post<DraftSession>(sessions, { pool_source: "manual" });
  const base = `${sessions}/${fresh.id}`;
  expect((await adminApi.raw("POST", `${base}/seed`, { body: { pool_captains: [] } })).status()).toBe(422);
  expect((await adminApi.raw("POST", `/api/v1/balancer/draft/sessions/${fresh.id}/start`)).status(), "start from setup").toBe(400);
  const preview = await adminApi.post<{ preview_only: boolean; diff: { teams_after: number; picks_after: number } }>(`${base}/seed`, {
    pool_captains: captainRegs,
    preview_only: true,
  });
  expect(preview).toMatchObject({ preview_only: true, diff: { teams_after: 2, picks_after: 8 } });
  const after = await draftBoard(anonApi, fresh.id);
  expect(after.session.status, "preview leaves the session in setup").toBe("setup");
  expect(after.teams).toHaveLength(0);
  await adminApi.delete(base, 204);
});

test("draft room chat: captains write, spectators read while open, moderators mute", async ({ adminApi, anonApi, makeUser }) => {
  const d = await seedDraft(adminApi, makeUser, { start: true });
  const [c1, c2] = d.captains;
  const chat = `/api/v1/balancer/draft/sessions/${d.session.id}/chat`;
  type Envelope = { messages: { id: number; body: string; author_role: string }[]; viewer: { can_write: boolean; role: string } };

  const posted = await c1.api.post<{ id: number; author_role: string }>(chat, { body: "glhf" });
  expect(posted.author_role).toBe("captain");
  const spectator = await makeUser("spec");
  expect((await spectator.api.raw("POST", chat, { body: { body: "hi" } })).status(), "spectators never write").toBe(403);
  const read = await anonApi.get<Envelope>(chat);
  expect(read.messages.map((m) => m.body)).toEqual(["glhf"]);
  expect(read.viewer).toMatchObject({ can_write: false, role: "spectator" });

  await adminApi.patch(`${chat}/settings`, { spectators_can_read: false });
  expect(await anonApi.get(chat), "closed to spectators: empty and read-only").toMatchObject({
    messages: [],
    settings: { spectators_can_read: false },
    viewer: { role: "spectator", can_write: false },
  });
  expect((await c2.api.get<Envelope>(chat)).messages).toHaveLength(1);

  await adminApi.put(`${chat}/mutes/${c2.id}`, { minutes: 5, reason: "e2e" });
  const muted = await c2.api.raw("POST", chat, { body: { body: "let me talk" } });
  expect(muted.status()).toBe(403);
  expect(await muted.json()).toMatchObject({ fields: [expect.objectContaining({ code: "chat_muted" })] });
  await adminApi.delete(`${chat}/mutes/${c2.id}`);
  await c2.api.post(chat, { body: "thanks" });

  expect((await c2.api.raw("DELETE", `${chat}/${posted.id}`)).status(), "deleting someone else's message").toBe(403);
  await c1.api.delete(`${chat}/${posted.id}`);
  expect((await c2.api.get<Envelope>(chat)).messages.map((m) => m.body)).toEqual(["thanks"]);
  await adminApi.post(`${d.lifecycle}/cancel`);
});

test("pick options never offer a choice that would starve another team", async ({ adminApi, makeUser }) => {
  const d = await seedDraft(adminApi, makeUser, { start: true });
  const board = await draftBoard(adminApi, d.session.id);
  const options = await d.captains[0].api.get<PickOptions>(`/api/v1/balancer/draft/picks/${board.current_pick!.id}/options`);
  // 4 damage + 4 support for 2 × (2 damage + 2 support): every non-captain is a safe pick on their one role.
  expect(options.options.filter((o) => o.is_safe).map((o) => o.player_id).sort()).toEqual(
    board.players.filter((p) => !p.is_captain).map((p) => p.id).sort()
  );
  expect(new Set(options.options.map((o) => o.role.role))).toEqual(new Set(["damage", "support"]));
  await adminApi.post(`${d.lifecycle}/cancel`);
});
