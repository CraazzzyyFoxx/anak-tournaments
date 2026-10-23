import { openRegistration, type FormSchema } from "../support/flows";
import { expect, test } from "../support/fixtures";
import { createTournament, createWorkspace, type Discipline } from "../support/seed";
import { enableGames, type WorkspaceRead } from "../support/workspace";

// The roles registration form, without a game handle: the identity question differs per game.
const ROLES_FORM: FormSchema = { schema_version: 1, sections: [{ key: "main", fields: [{ key: "roles", kind: "builtin", required: true, editable: true }] }] };

const GAMES: { game: Discipline; role: string; foreignRole: string }[] = [
  { game: "lol", role: "jungle", foreignRole: "tank" },
  { game: "deadlock", role: "agent", foreignRole: "support" },
];

for (const { game, role, foreignRole } of GAMES) {
  test(`${game}: enable, create a tournament on the game's grid, register with the game's roles, filter by game`, async ({ adminApi, anonApi, makeUser }) => {
    const ws = await createWorkspace(adminApi);
    const refused = await adminApi.raw("POST", "/api/v1/admin/tournaments", {
      body: { workspace_id: ws.id, discipline: game, name: "x", start_date: "2030-01-01", end_date: "2030-01-02" },
    });
    expect(refused.status(), `${game} tournament before the game is enabled`).toBe(422);

    const enabled = await enableGames(adminApi, ws.id, ["overwatch", game]);
    expect(enabled.disciplines_enabled).toEqual(["overwatch", game]);
    const t = await createTournament(adminApi, ws.id, { discipline: game });
    expect(t.discipline).toBe(game);
    const detail = await anonApi.get(`/api/v1/tournaments/${t.id}`);
    expect(detail.division_grid_version_id, "pinned to the game's default grid").toBe(enabled.default_division_grid_versions[game]);

    const version = await openRegistration(adminApi, t.id, { form: ROLES_FORM });
    const form = await anonApi.get(`/api/v1/tournaments/${t.id}/registration/form`);
    expect(Object.keys(form.subrole_catalog ?? {}), "the form's role vocabulary is the game's").toContain(role);
    const player = await makeUser(game);
    const wrong = await player.api.raw("POST", `/api/v1/tournaments/${t.id}/registration`, {
      body: { form_version_id: version, answers: { roles: [{ role: foreignRole, is_primary: true }] } },
    });
    expect(wrong.status(), `${foreignRole} is not a ${game} role`).toBe(422);
    const reg = await player.api.post(`/api/v1/tournaments/${t.id}/registration`, { form_version_id: version, answers: { roles: [{ role, is_primary: true }] } }, 201);
    expect(reg.roles.map((r: { role: { role: string } }) => r.role.role)).toEqual([role]);

    const ow = await createTournament(adminApi, ws.id);
    const filtered = await anonApi.get<{ results: { id: number; discipline: string }[] }>("/api/v1/tournaments", { workspace_id: ws.id, discipline: game, per_page: 50 });
    expect(filtered.results.map((r) => r.id)).toEqual([t.id]);
    const owOnly = await anonApi.get<{ results: { id: number }[] }>("/api/v1/tournaments", { workspace_id: ws.id, discipline: "overwatch", per_page: 50 });
    expect(owOnly.results.map((r) => r.id)).toEqual([ow.id]);

    // Statistics endpoints accept every installed game.
    for (const url of [`/api/v1/statistics/${game}/maps`, `/api/v1/statistics/${game}/characters/playtime`]) {
      expect((await anonApi.raw("GET", url, { query: { workspace_id: ws.id } })).status(), url).toBe(200);
    }
    for (const url of ["/api/v1/statistics/players", "/api/v1/statistics/records"]) {
      expect((await anonApi.raw("GET", url, { query: { discipline: game, workspace_id: ws.id } })).status(), `${url}?discipline=${game}`).toBe(200);
    }
  });
}

test("an unknown game is a 422 on the filters, not an empty page", async ({ anonApi }) => {
  expect((await anonApi.raw("GET", "/api/v1/tournaments", { query: { discipline: "dota" } })).status()).toBe(422);
});

test("the admin dashboard lists every game's tournaments", async ({ adminApi }) => {
  const ws = await createWorkspace(adminApi);
  await enableGames(adminApi, ws.id);
  const made = await Promise.all((["overwatch", "lol", "deadlock"] as const).map((discipline) => createTournament(adminApi, ws.id, { discipline })));
  const board = await adminApi.get<{ tournaments: { id: number; discipline: string }[] }>("/api/v1/admin/dashboard", { workspace_id: ws.id });
  expect(board.tournaments.map((t) => t.discipline).sort()).toEqual(["deadlock", "lol", "overwatch"]);
  expect(board.tournaments.map((t) => t.id).sort()).toEqual(made.map((t) => t.id).sort());
  // Disabling a game hides nothing already run in it.
  const reduced = await adminApi.patch<WorkspaceRead>(`/api/v1/workspaces/${ws.id}`, { disciplines_enabled: ["overwatch"] });
  expect(reduced.disciplines_enabled).toEqual(["overwatch"]);
  expect((await adminApi.get<{ tournaments: unknown[] }>("/api/v1/admin/dashboard", { workspace_id: ws.id })).tournaments).toHaveLength(3);
});
