import { expect, test } from "../support/fixtures";
import { mapRuleset, seedCatalog } from "../support/pickban";
import { createWorkspace } from "../support/seed";
import { addMember, freshSession, systemRoles } from "../support/workspace";

type ScrimRoom = {
  token: string;
  encounter_id: number;
  best_of: number;
  teams: { slot: number; name: string; captain_claimed: boolean }[];
  viewer_slot: number | null;
  can_claim: boolean;
  can_close: boolean;
  closed_at: string | null;
};

test("scrim room: a member creates it, a member claims the free side by token, strangers are kept out, and it closes", async ({
  adminApi,
  anonApi,
  makeUser,
}) => {
  const ws = await createWorkspace(adminApi);
  const roles = await systemRoles(adminApi, ws.id);
  const [creatorUser, opponentUser, bystanderUser, outsider] = await Promise.all(["host", "opp", "by", "out"].map((p) => makeUser(p)));
  for (const user of [creatorUser, opponentUser, bystanderUser]) await addMember(adminApi, ws.id, user, roles.player);
  // A membership granted after login reaches a token only on a fresh session (gateway permission cache).
  const [creator, opponent, bystander] = await Promise.all([creatorUser, opponentUser, bystanderUser].map(freshSession));
  const { maps } = await seedCatalog(adminApi, 3, 0);

  const room = await creator.post<ScrimRoom>(
    "/api/v1/scrims",
    {
      workspace_id: ws.id,
      discipline: "overwatch",
      label: "Friday scrim",
      best_of: 3,
      team_names: ["Alpha", "Bravo"],
      pool: { source: "custom", configs: [{ kind: "map", mode: "pool", ruleset: mapRuleset(), item_ids: maps.map((m) => m.id) }] },
    },
    201
  );
  expect(room).toMatchObject({ best_of: 3, viewer_slot: 1, can_close: true, closed_at: null });
  expect(room.teams.map((t) => [t.slot, t.name, t.captain_claimed])).toEqual([
    [1, "Alpha", true],
    [2, "Bravo", false],
  ]);

  const url = `/api/v1/scrims/${room.token}`;
  expect((await anonApi.raw("GET", url)).status(), "an anonymous token holder cannot read the room").toBe(404);
  expect((await outsider.api.raw("GET", url)).status(), "a non-member token holder cannot read the room").toBe(404);
  expect((await outsider.api.raw("POST", `${url}/claim`)).status(), "a non-member cannot claim a side").toBe(403);
  expect(await opponent.get<ScrimRoom>(url), "a member sees the free side").toMatchObject({ can_claim: true, viewer_slot: null, can_close: false });

  const claimed = await opponent.post<ScrimRoom>(`${url}/claim`);
  expect(claimed).toMatchObject({ viewer_slot: 2, can_close: true });
  expect(claimed.teams.every((t) => t.captain_claimed), "both sides are captained").toBe(true);
  expect(await opponent.get(`/api/v1/encounters/${room.encounter_id}/my-role`), "the claimer captains the room's encounter").toMatchObject({ slot: 2 });
  expect((await bystander.raw("POST", `${url}/claim`)).status(), "a third member finds no free side").toBe(409);
  expect((await creator.post<ScrimRoom>(`${url}/claim`)).viewer_slot, "claiming again is idempotent for a captain").toBe(1);
  expect((await bystander.raw("POST", `${url}/close`)).status(), "a member outside the room cannot close it").toBe(403);

  const mine = await creator.get<{ rooms: ScrimRoom[] }>("/api/v1/scrims", { workspace_id: ws.id });
  expect(mine.rooms.map((r) => r.token)).toContain(room.token);

  const closed = await opponent.post<ScrimRoom>(`${url}/close`);
  expect(closed.closed_at, "a captain closes the room").not.toBeNull();
  expect(closed.can_claim).toBe(false);
  expect((await bystander.raw("POST", `${url}/claim`)).status(), "a closed room refuses claims").toBe(409);

  await Promise.all([creator, opponent, bystander].map((a) => a.dispose()));
});
