import { test, expect } from "../support/fixtures";
import { poll } from "../support/api";
import { createTournament, createWorkspace } from "../support/seed";
import {
  act,
  actingSeat,
  getState,
  HERO_CLASSIC,
  heroRuleset,
  mapRuleset,
  readyBoth,
  seedCatalog,
  seedRoom,
  upsertConfig,
  waitForSession,
  type PickBanState,
} from "../support/pickban";

const enc = (id: number) => `/api/v1/encounters/${id}`;
const adminEnc = (id: number) => `/api/v1/admin/encounters/${id}`;
const poolStatus = (state: PickBanState, itemId: number) => state.pool.find((p) => p.item_id === itemId);

test.describe("pick-ban config", () => {
  test("rules catalog is public, per discipline, and names the presets the constructor offers", async ({ anonApi }) => {
    const catalog = await anonApi.get<{ presets: { id: string; kind: string }[]; groups: Record<string, string[]> }>(
      "/api/v1/pick-ban-rules/catalog",
      { discipline: "overwatch" }
    );
    expect(catalog.presets.map((p) => p.id)).toEqual(expect.arrayContaining(["map_bracket", "hero_classic"]));
    expect(catalog.groups.hero).toEqual(expect.arrayContaining(["tank", "damage", "support"]));

    expect((await anonApi.raw("GET", "/api/v1/pick-ban-rules/catalog")).status(), "discipline is required").toBe(422);
    expect((await anonApi.raw("GET", "/api/v1/pick-ban-rules/catalog", { query: { discipline: "nope" } })).status()).toBe(404);
  });

  test("organizer validates, previews, saves, lists and deletes configs", async ({ adminApi, anonApi, makeUser }) => {
    const ws = await createWorkspace(adminApi);
    const t = await createTournament(adminApi, ws.id);
    const { maps, heroes } = await seedCatalog(adminApi);
    const mapIds = maps.map((m) => m.id);
    const heroIds = heroes.map((h) => h.id);

    // The map pool is picked from the public overwatch catalog.
    const listed = await anonApi.get<{ results: { id: number }[] }>("/api/v1/catalog/overwatch/map", {
      search: maps[0].name.replace(/ Map \d+$/, ""),
      per_page: 50,
    });
    expect(listed.results.map((r) => r.id)).toEqual(expect.arrayContaining(mapIds));

    const rules = `/api/v1/admin/tournaments/${t.id}/pick-ban-rules`;
    const valid = await adminApi.post(`${rules}/validate`, { kind: "hero", mode: "pool", ruleset: heroRuleset(HERO_CLASSIC) });
    expect(valid).toEqual({ valid: true, issues: [] });
    const broken = heroRuleset([{ id: "b", action: "ban", actors: "first", count: 0 }]);
    const invalid = await adminApi.post<{ valid: boolean; issues: { path: string; code: string }[] }>(`${rules}/validate`, {
      kind: "hero",
      mode: "pool",
      ruleset: broken,
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.issues).toContainEqual(expect.objectContaining({ path: "phases[0].steps[0].count", code: "count_range" }));

    const preview = await adminApi.post<{ maps: { map_index: number; steps: { action: string }[] }[] }>(`${rules}/preview`, {
      kind: "map",
      mode: "pool",
      ruleset: mapRuleset(),
      best_of: 3,
      item_ids: mapIds,
      slots: [],
    });
    expect(preview.maps[0].steps.map((s) => s.action), "Bo3 over a 5-map pool").toEqual(["ban", "ban", "pick", "pick", "decider"]);

    const configs = `/api/v1/admin/tournaments/${t.id}/pick-ban-configs`;
    const bad = await adminApi.raw("PUT", configs, { body: { kind: "hero", mode: "pool", ruleset: broken, item_ids: heroIds } });
    expect(bad.status()).toBe(422);
    expect(JSON.stringify(await bad.json())).toContain("ruleset_invalid");
    const wrongPool = await adminApi.raw("PUT", configs, { body: { kind: "map", mode: "pool", ruleset: mapRuleset(), item_ids: heroIds } });
    expect(wrongPool.status(), "heroes are not map catalog items").toBe(422);
    expect(JSON.stringify(await wrongPool.json())).toContain("pool_item_not_in_catalog");

    const mapConfig = await upsertConfig(adminApi, t.id, "map", mapRuleset(), mapIds);
    expect(mapConfig).toMatchObject({ kind: "map", mode: "pool", item_ids: mapIds, tournament_id: t.id });
    await upsertConfig(adminApi, t.id, "hero", heroRuleset(HERO_CLASSIC), heroIds);
    // Upsert replaces the same cascade level instead of adding a second row.
    await upsertConfig(adminApi, t.id, "map", mapRuleset(), mapIds.slice(0, 4));

    const all = await adminApi.get<{ configs: { id: number; kind: string; item_ids: number[] }[] }>(configs);
    expect(all.configs.map((c) => c.kind).sort()).toEqual(["hero", "map"]);
    expect(all.configs.find((c) => c.kind === "map")!.item_ids).toEqual(mapIds.slice(0, 4));
    const pub = await anonApi.get<{ configs: { kind: string }[] }>(`/api/v1/tournaments/${t.id}/pick-ban-configs`);
    expect(pub.configs.map((c) => c.kind), "public read lists the map configs").toEqual(["map"]);

    const outsider = await makeUser("pbout");
    expect((await outsider.api.raw("GET", configs)).status()).toBe(403);
    expect((await outsider.api.raw("PUT", configs, { body: { kind: "map", mode: "pool", ruleset: mapRuleset(), item_ids: mapIds } })).status()).toBe(403);

    const heroConfig = all.configs.find((c) => c.kind === "hero")!;
    await adminApi.delete(`/api/v1/admin/pick-ban-configs/${heroConfig.id}`);
    expect((await adminApi.get<{ configs: { kind: string }[] }>(configs)).configs.map((c) => c.kind)).toEqual(["map"]);
  });
});

test("captains: readiness gate, alternating map veto, mutual undo, then hero bans", async ({ adminApi, anonApi, makeUser }) => {
  const [a, b, outsider] = [await makeUser("capa"), await makeUser("capb"), await makeUser("pbout")];
  const room = await seedRoom(adminApi, a, b);
  const e = room.encounterId;
  const [m1, m2, m3, m4, m5] = room.maps.map((m) => m.id);

  expect(await outsider.api.get(`${enc(e)}/my-role`)).toEqual({ encounter_team_id: null, slot: null });
  expect((await anonApi.raw("GET", `${enc(e)}/my-role`)).status()).toBe(401);
  expect(room.a.participationId).not.toBe(room.b.participationId);

  // Readiness gates the session: one side ready opens nothing.
  const waiting = await getState(a.api, e, "map");
  expect(waiting).toMatchObject({ session: null, reason: "not_ready" });
  expect((await outsider.api.raw("POST", `${enc(e)}/ready`)).status()).toBe(403);
  const half = await a.api.post<{ readiness: Record<string, boolean> }>(`${enc(e)}/ready`);
  expect(half.readiness).toEqual({ [room.a.participationId]: true, [room.b.participationId]: false });
  expect((await a.api.post<{ readiness: Record<string, boolean> }>(`${enc(e)}/ready`)).readiness, "ready is idempotent").toEqual(half.readiness);
  expect((await getState(b.api, e, "map")).session).toBeNull();

  await b.api.post(`${enc(e)}/ready`);
  let state = await waitForSession(a.api, e, "map");
  expect(state.sequence.map((s) => s.action), "Bo3 bracket veto over 5 maps").toEqual(["ban", "ban", "pick", "pick", "decider"]);
  expect(state.step_deadline, "a timed step shows its deadline").not.toBeNull();
  const first = actingSeat(room, state);
  const second = first === room.a ? room.b : room.a;
  expect(state.viewer_team_id).toBe(room.a.participationId);
  expect(state.viewer_can_act).toBe(first === room.a);

  // Rejections: wrong turn, wrong action, outsider, anonymous, unknown item.
  const wrongTurn = await second.captain.api.raw("POST", `${enc(e)}/pick-ban/map/act`, { body: { item_id: m1, action: "ban" } });
  expect(wrongTurn.status(), "acting out of turn is rejected").toBe(400);
  expect(await wrongTurn.text()).toContain("turn");
  expect((await first.captain.api.raw("POST", `${enc(e)}/pick-ban/map/act`, { body: { item_id: m1, action: "pick" } })).status()).toBe(400);
  expect((await outsider.api.raw("POST", `${enc(e)}/pick-ban/map/act`, { body: { item_id: m1, action: "ban" } })).status()).toBe(403);
  expect((await anonApi.raw("POST", `${enc(e)}/pick-ban/map/act`, { body: { item_id: m1, action: "ban" } })).status()).toBe(401);
  expect((await first.captain.api.raw("POST", `${enc(e)}/pick-ban/map/act`, { body: { item_id: room.heroes[0].id, action: "ban" } })).status()).toBe(400);

  state = await act(first.captain, e, "map", m1, "ban");
  expect(state.current_step_index).toBe(1);
  expect(state.acting_team_ids).toEqual([second.participationId]);
  expect(poolStatus(state, m1)).toMatchObject({ status: "banned", picked_by_team_id: first.participationId });

  // Undo needs both captains: the ask alone changes nothing, the consent applies it.
  const asked = await first.captain.api.post(`${enc(e)}/pick-ban/map/undo`, { consent: true });
  expect(asked).toMatchObject({ requested_by_team_id: first.participationId, item_ids: [m1] });
  expect((await getState(second.captain.api, e, "map")).current_step_index).toBe(1);
  await second.captain.api.post(`${enc(e)}/pick-ban/map/undo`, { consent: true });
  state = await getState(first.captain.api, e, "map");
  expect(state.current_step_index, "undo re-opens the undone step").toBe(0);
  expect(poolStatus(state, m1)?.status).toBe("available");

  await act(first.captain, e, "map", m1, "ban");
  await act(second.captain, e, "map", m2, "ban");
  await act(first.captain, e, "map", m3, "pick");
  state = await act(second.captain, e, "map", m4, "pick");
  expect(state.is_complete).toBe(true);
  expect(state.session?.status).toBe("completed");
  expect(poolStatus(state, m5)?.status, "the decider takes the last map").toBe("picked");
  expect(state.games.map((g) => [g.position, g.map_id]), "games are played on the veto's maps in order").toEqual([
    [1, m3],
    [2, m4],
    [3, m5],
  ]);
  expect((await first.captain.api.raw("POST", `${enc(e)}/pick-ban/map/act`, { body: { item_id: m2, action: "ban" } })).status()).toBe(400);

  // Map 1 settled: round 1's hero bans open, same alternation.
  const [h1, h2] = room.heroes.map((h) => h.id);
  let hero = await waitForSession(a.api, e, "hero");
  expect(hero.current_round).toBe(1);
  const heroFirst = actingSeat(room, hero);
  const heroSecond = heroFirst === room.a ? room.b : room.a;
  expect((await heroSecond.captain.api.raw("POST", `${enc(e)}/pick-ban/hero/act`, { body: { item_id: h1, action: "ban" } })).status()).toBe(400);
  await act(heroFirst.captain, e, "hero", h1, "ban");
  hero = await act(heroSecond.captain, e, "hero", h2, "ban");
  expect(poolStatus(hero, h1)).toMatchObject({ status: "banned", picked_by_team_id: heroFirst.participationId });
  expect(poolStatus(hero, h2)).toMatchObject({ status: "banned", picked_by_team_id: heroSecond.participationId });

  // A spectator reads the same room, with no seat and no turn.
  const spectator = await getState(anonApi, e, "map");
  expect(spectator).toMatchObject({ viewer_team_id: null, viewer_can_act: false, is_complete: true });
});

test("blind hero step: drafts stay hidden until both lock, a dispute re-opens it once", async ({ adminApi, makeUser }) => {
  const [a, b] = [await makeUser("capa"), await makeUser("capb")];
  const room = await seedRoom(adminApi, a, b, {
    map: null,
    hero: heroRuleset([{ id: "blind", action: "ban", actors: "both", blind: true, dispute: 1 }]),
  });
  const e = room.encounterId;
  const [h1, h2, h3] = room.heroes.map((h) => h.id);
  let state = await readyBoth(room, "hero");
  expect(state.sequence[0]).toMatchObject({ blind: true });
  expect(state.acting_team_ids.sort()).toEqual([room.a.participationId, room.b.participationId].sort());

  const submit = (who: typeof room.a, item_id: number, lock: boolean) =>
    who.captain.api.post<PickBanState>(`${enc(e)}/pick-ban/hero/submit`, { items: [{ item_id }], lock });

  state = await submit(room.a, h1, false);
  expect(state.submissions.flatMap((s) => s.items.map((i) => i.item_id)), "the captain sees their own draft").toEqual([h1]);
  // An open (non-blind) act is refused on a blind step.
  expect((await a.api.raw("POST", `${enc(e)}/pick-ban/hero/act`, { body: { item_id: h1, action: "ban" } })).status()).toBe(400);

  await submit(room.a, h1, true);
  const peek = await getState(b.api, e, "hero");
  expect(peek.step_progress?.[room.a.participationId], "the opponent sees progress").toMatchObject({ locked: true, filled: 1 });
  expect(peek.submissions.flatMap((s) => s.items.map((i) => i.item_id)), "…but never the unrevealed items").not.toContain(h1);
  expect(poolStatus(peek, h1)?.status).toBe("available");
  expect((await a.api.raw("POST", `${enc(e)}/pick-ban/hero/submit`, { body: { items: [{ item_id: h2 }], lock: true } })).status(), "a locked draft is final").toBe(400);

  state = await submit(room.b, h2, true);
  expect(poolStatus(state, h1)).toMatchObject({ status: "banned", picked_by_team_id: room.a.participationId });
  expect(poolStatus(state, h2)).toMatchObject({ status: "banned", picked_by_team_id: room.b.participationId });
  expect(state.dispute).toMatchObject({ available: true, max: 1, attempts_used: 0 });

  // Dispute: the revealed step re-opens with the previous drafts, and the budget is spent.
  state = await b.api.post<PickBanState>(`${enc(e)}/pick-ban/hero/dispute`, {});
  expect(state.current_step_index).toBe(0);
  expect(poolStatus(state, h2)?.status).toBe("available");
  expect(state.submissions.filter((s) => s.state === "draft").flatMap((s) => s.items.map((i) => i.item_id)), "the disputing side's draft is prefilled").toEqual([h2]);
  await submit(room.a, h1, true);
  state = await submit(room.b, h3, true);
  expect(poolStatus(state, h3)).toMatchObject({ status: "banned", picked_by_team_id: room.b.participationId });
  expect(state.dispute, "the re-revealed step has spent its one dispute").toMatchObject({ available: false, attempts_used: 1, max: 1 });
  expect((await b.api.raw("POST", `${enc(e)}/pick-ban/hero/dispute`, { body: {} })).status(), "dispute budget is spent").toBe(400);

  // The organizer's reopen has no budget.
  state = await adminApi.post<PickBanState>(`${adminEnc(e)}/pick-ban-reopen`, { kind: "hero" });
  expect(state.current_step_index).toBe(0);
  await submit(room.a, h1, true);
  state = await submit(room.b, h2, true);
  expect(poolStatus(state, h2)).toMatchObject({ status: "banned", picked_by_team_id: room.b.participationId });
  expect(poolStatus(state, h3)?.status).toBe("available");
});

test("result_loser_choice: map 1's loser elects who opens round 2's hero bans", async ({ adminApi, makeUser }) => {
  const [a, b] = [await makeUser("capa"), await makeUser("capb")];
  const room = await seedRoom(adminApi, a, b, { heroRotation: "result_loser_choice" });
  const e = room.encounterId;
  const [m1, m2, m3, m4] = room.maps.map((m) => m.id);
  const [h1, h2, h3, h4] = room.heroes.map((h) => h.id);
  let state = await readyBoth(room);
  expect((await a.api.raw("POST", `${enc(e)}/pick-ban/hero/elect-opener`, { body: { first_team_id: room.a.participationId } })).status(), "nothing awaits a choice yet").toBe(400);

  const first = actingSeat(room, state);
  const second = first === room.a ? room.b : room.a;
  await act(first.captain, e, "map", m1, "ban");
  await act(second.captain, e, "map", m2, "ban");
  await act(first.captain, e, "map", m3, "pick");
  state = await act(second.captain, e, "map", m4, "pick");
  let hero = await waitForSession(a.api, e, "hero");
  await act(actingSeat(room, hero).captain, e, "hero", h1, "ban");
  hero = await getState(a.api, e, "hero");
  await act(actingSeat(room, hero).captain, e, "hero", h2, "ban");

  // Both captains claim map 1 for A: the agreement confirms it.
  const game1 = state.games.find((g) => g.position === 1)!;
  const claim = {
    basis_version: game1.result_version,
    results: [
      { encounter_team_id: room.a.participationId, score: 1 },
      { encounter_team_id: room.b.participationId, score: 0 },
    ],
  };
  await a.api.post(`${enc(e)}/games/${game1.id}/report`, claim);
  const resolved = await b.api.post<{ resolved: boolean; disputed: boolean; game: { state: string } }>(`${enc(e)}/games/${game1.id}/report`, claim);
  expect(resolved).toMatchObject({ resolved: true, disputed: false, game: { state: "confirmed" } });

  hero = await poll(
    async () => {
      const s = await getState(b.api, e, "hero");
      return s.session?.awaiting_choice ? s : undefined;
    },
    "round 2 to wait on the loser's choice"
  );
  expect(hero.session?.pending_chooser_team_id, "the loser of map 1 chooses").toBe(room.b.participationId);
  const winnerTry = await a.api.raw("POST", `${enc(e)}/pick-ban/hero/elect-opener`, { body: { first_team_id: room.a.participationId } });
  expect(winnerTry.status(), "the winner cannot choose").toBeGreaterThanOrEqual(400);
  hero = await b.api.post<PickBanState>(`${enc(e)}/pick-ban/hero/elect-opener`, { first_team_id: room.a.participationId });
  expect(hero.session?.awaiting_choice).toBe(false);
  expect(hero.current_round).toBe(2);
  expect(hero.acting_team_ids, "the elected side opens round 2").toEqual([room.a.participationId]);
  hero = await act(a, e, "hero", h3, "ban");
  expect(hero.acting_team_ids).toEqual([room.b.participationId]);
  hero = await act(b, e, "hero", h4, "ban");
  expect(poolStatus(hero, h4)?.status).toBe("banned");
});

test("organizer overrides: readiness, pause, extend, act, cancel, reset — on the board and in the history", async ({ adminApi, makeUser }) => {
  const [a, b] = [await makeUser("capa"), await makeUser("capb")];
  const room = await seedRoom(adminApi, a, b);
  const e = room.encounterId;
  const [m1, m2] = room.maps.map((m) => m.id);
  const board = async () => {
    const res = await adminApi.get<{ rooms: { encounter_id: number; phase: string; map: { status: string; paused_at: string | null } | null }[] }>(
      `/api/v1/admin/tournaments/${room.tournament.id}/pregame-rooms`
    );
    return res.rooms.find((r) => r.encounter_id === e)!;
  };
  expect((await board()).phase).toBe("readiness");

  // Captains never reach the organizer routes.
  expect((await a.api.raw("POST", `${adminEnc(e)}/readiness`, { body: { encounter_team_id: room.a.participationId, ready: true } })).status()).toBe(403);
  expect((await a.api.raw("GET", `${adminEnc(e)}/room-history`)).status()).toBe(403);
  expect((await a.api.raw("GET", `/api/v1/admin/tournaments/${room.tournament.id}/pregame-rooms`)).status()).toBe(403);

  const forced = await adminApi.post<{ readiness: Record<string, boolean> }>(`${adminEnc(e)}/readiness`, { encounter_team_id: room.a.participationId, ready: true });
  expect(forced.readiness[room.a.participationId]).toBe(true);
  const cleared = await adminApi.post<{ readiness: Record<string, boolean> }>(`${adminEnc(e)}/readiness`, { encounter_team_id: room.a.participationId, ready: false });
  expect(cleared.readiness[room.a.participationId], "an organizer may clear readiness before the room opens").toBe(false);
  await adminApi.post(`${adminEnc(e)}/readiness`, { encounter_team_id: room.a.participationId, ready: true });
  await adminApi.post(`${adminEnc(e)}/readiness`, { encounter_team_id: room.b.participationId, ready: true });
  let state = await waitForSession(a.api, e, "map");
  expect((await adminApi.raw("POST", `${adminEnc(e)}/readiness`, { body: { encounter_team_id: room.a.participationId, ready: false } })).status(), "readiness is locked once a session exists").toBe(409);
  const first = actingSeat(room, state);
  const second = first === room.a ? room.b : room.a;

  // Pause freezes the clock and every captain write, not the organizer's.
  expect((await a.api.raw("POST", `${adminEnc(e)}/pick-ban-pause`, { body: { kind: "map", paused: true } })).status()).toBe(403);
  state = await adminApi.post<PickBanState>(`${adminEnc(e)}/pick-ban-pause`, { kind: "map", paused: true });
  expect(state.session?.paused_at).not.toBeNull();
  expect(state.step_deadline, "a paused step has no deadline").toBeNull();
  expect((await board()).map?.paused_at).not.toBeNull();
  const blocked = await first.captain.api.raw("POST", `${enc(e)}/pick-ban/map/act`, { body: { item_id: m1, action: "ban" } });
  expect(blocked.status(), "captain act while paused").toBe(409);
  state = await adminApi.post<PickBanState>(`${adminEnc(e)}/pick-ban-extend`, { kind: "map", seconds: 120 });
  state = await adminApi.post<PickBanState>(`${adminEnc(e)}/pick-ban-act`, { kind: "map", encounter_team_id: first.participationId, item_id: m1, action: "ban" });
  expect(poolStatus(state, m1)).toMatchObject({ status: "banned", picked_by_team_id: first.participationId });
  state = await adminApi.post<PickBanState>(`${adminEnc(e)}/pick-ban-pause`, { kind: "map", paused: false });
  expect(state.session?.paused_at).toBeNull();
  expect(state.step_deadline).not.toBeNull();
  expect((await adminApi.raw("POST", `${adminEnc(e)}/pick-ban-extend`, { body: { kind: "map", seconds: 5 } })).status(), "extend is 10..3600 s").toBe(422);

  // The captains carry on from the organizer's act.
  state = await act(second.captain, e, "map", m2, "ban");
  expect(state.current_step_index).toBe(2);

  // Cancel retires the veto; the room falls back to free map choice.
  state = await adminApi.post<PickBanState>(`${adminEnc(e)}/pick-ban-cancel`, { kind: "map", reason: "e2e: server outage" });
  expect(state.session?.status).toBe("cancelled");
  expect((await second.captain.api.raw("POST", `${enc(e)}/pick-ban/map/act`, { body: { item_id: m2, action: "ban" } })).status()).toBeGreaterThanOrEqual(400);
  expect((await board()).map?.status).toBe("cancelled");
  expect((await adminApi.raw("POST", `${adminEnc(e)}/pick-ban-cancel`, { body: { kind: "map", reason: "again" } })).status()).toBe(409);

  // Reset is the way back: a fresh session with the whole pool.
  state = await adminApi.post<PickBanState>(`${adminEnc(e)}/pick-ban-session/reset`, { kind: "map" });
  expect(state.session?.status).toBe("active");
  expect(state.current_step_index).toBe(0);
  expect(state.pool.every((p) => p.status === "available")).toBe(true);

  const history = await adminApi.get<{ entries: { action: string; source: string; kind: string | null }[] }>(`${adminEnc(e)}/room-history`, { limit: 100 });
  const actions = history.entries.map((x) => x.action);
  for (const expected of ["ready_marked", "ready_cleared", "session_opened", "paused", "timer_extended", "acted", "resumed", "session_cancelled", "session_reset"]) {
    expect(actions, `room history records ${expected}`).toContain(expected);
  }
  expect(history.entries.find((x) => x.action === "acted" && x.source === "admin"), "the organizer's act is attributed to admin").toBeTruthy();
  expect(history.entries.find((x) => x.action === "acted" && x.source === "captain")).toBeTruthy();
});

test("organizer reopen of an open step hands the step back to its captain", async ({ adminApi, makeUser }) => {
  const [a, b] = [await makeUser("capa"), await makeUser("capb")];
  const room = await seedRoom(adminApi, a, b);
  const e = room.encounterId;
  const [m1, m2] = room.maps.map((m) => m.id);
  const first = actingSeat(room, await readyBoth(room));
  await act(first.captain, e, "map", m1, "ban");

  // Documented: "voids the last fully revealed step's submissions and re-opens it for a fresh attempt".
  let state = await adminApi.post<PickBanState>(`${adminEnc(e)}/pick-ban-reopen`, { kind: "map" });
  expect(state.current_step_index).toBe(0);
  expect(state.acting_team_ids).toEqual([first.participationId]);
  const retry = await first.captain.api.raw("POST", `${enc(e)}/pick-ban/map/act`, { body: { item_id: m2, action: "ban" } });
  expect(retry.status(), `the reopened step must accept a fresh ban: ${await retry.text()}`).toBe(200);
  state = await getState(first.captain.api, e, "map");
  expect(poolStatus(state, m2)?.status).toBe("banned");
  expect(poolStatus(state, m1)?.status, "the voided ban is released").toBe("available");
});

test("room chat: captains talk, spectators are locked out by default, staff moderate", async ({ adminApi, anonApi, makeUser }) => {
  const [a, b, outsider] = [await makeUser("capa"), await makeUser("capb"), await makeUser("pbout")];
  const room = await seedRoom(adminApi, a, b);
  const chat = `${enc(room.encounterId)}/chat`;
  type Message = { id: number; body: string; author_role: string; auth_user_id: number };
  type History = { messages: Message[]; settings: { spectators_can_read: boolean }; viewer: { role: string; can_write: boolean; can_moderate: boolean }; mutes: { auth_user_id: number }[] };

  const sent = await a.api.post<Message>(chat, { body: "lobby code E2E-1234" });
  expect(sent).toMatchObject({ body: "lobby code E2E-1234", author_role: "captain", auth_user_id: a.id });
  const seen = await b.api.get<History>(chat);
  expect(seen.messages.map((m) => m.body)).toContain("lobby code E2E-1234");
  expect(seen.viewer).toMatchObject({ role: "captain", can_write: true, can_moderate: false });
  expect(seen.settings.spectators_can_read, "a pre-game room is closed to spectators by default").toBe(false);

  expect((await anonApi.raw("GET", chat)).status()).toBe(403);
  expect((await outsider.api.raw("GET", chat)).status()).toBe(403);
  expect((await outsider.api.raw("POST", chat, { body: { body: "hi" } })).status()).toBe(403);
  expect((await b.api.raw("DELETE", `${chat}/${sent.id}`)).status(), "a captain deletes only their own messages").toBe(403);
  expect((await a.api.raw("PUT", `${chat}/mutes/${b.id}`, { body: { minutes: 5 } })).status(), "captains do not moderate").toBe(403);

  const own = await b.api.post<Message>(chat, { body: "typo" });
  await b.api.delete(`${chat}/${own.id}`);

  await adminApi.put(`${chat}/mutes/${b.id}`, { minutes: 10, reason: "e2e" });
  const muted = await b.api.raw("POST", chat, { body: { body: "let me talk" } });
  expect(muted.status()).toBe(403);
  expect(await muted.text()).toContain("chat_muted");
  const staffView = await adminApi.get<History>(chat);
  expect(staffView.viewer).toMatchObject({ role: "staff", can_moderate: true });
  expect(staffView.mutes.map((m) => m.auth_user_id)).toEqual([b.id]);
  await adminApi.delete(`${chat}/mutes/${b.id}`);
  await b.api.post(chat, { body: "back again" });

  await adminApi.delete(`${chat}/${sent.id}`);
  const after = await a.api.get<History>(chat);
  expect(after.messages.map((m) => m.body)).toEqual(["back again"]);

  await adminApi.patch(`${chat}/settings`, { spectators_can_read: true });
  const spectator = await anonApi.get<History>(chat);
  expect(spectator.viewer).toMatchObject({ role: "spectator", can_write: false });
  expect(spectator.messages.map((m) => m.body)).toEqual(["back again"]);
  expect((await anonApi.raw("POST", chat, { body: { body: "anon" } })).status()).toBe(401);
});
