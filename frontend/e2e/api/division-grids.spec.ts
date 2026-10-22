import { poll } from "../support/api";
import { seedTeams } from "../support/flows";
import { expect, test } from "../support/fixtures";
import { createTournament, createWorkspace } from "../support/seed";
import { enableGames, listGrids, THREE_TIERS, type Grid, type GridVersion, type WorkspaceRead } from "../support/workspace";

const base = (wsId: number) => `/api/v1/division-grids/by-workspace/${wsId}`;

test("every enabled game gets its own default grid with the game's native ladder", async ({ adminApi }) => {
  const ws = await createWorkspace(adminApi);
  const initial = await listGrids(adminApi, ws.id);
  expect(initial.map((g) => [g.discipline, g.slug])).toEqual([["overwatch", "overwatch-default"]]);

  const updated = await enableGames(adminApi, ws.id);
  expect(Object.keys(updated.default_division_grid_versions).sort()).toEqual(["deadlock", "lol", "overwatch"]);

  const grids = await listGrids(adminApi, ws.id);
  const ladder = (d: string) => {
    const tiers = grids.find((g) => g.discipline === d)!.versions[0].tiers;
    return [tiers.length, tiers[0].name, tiers.at(-1)!.name];
  };
  expect(ladder("overwatch")).toEqual([45, "Champion 1", "Bronze 5"]);
  expect(ladder("lol")).toEqual([31, "Challenger", "Iron IV"]);
  expect(ladder("deadlock")[0]).toBeGreaterThan(10);
  for (const g of grids) {
    expect(g.versions.map((v) => v.status), `${g.discipline} default grid is published`).toEqual(["published"]);
    expect(updated.default_division_grid_versions[g.discipline]).toBe(g.versions[0].id);
  }
});

test("create a grid blank (native ladder) and as a copy of another grid's version", async ({ adminApi }) => {
  const ws = await createWorkspace(adminApi);
  await enableGames(adminApi, ws.id);
  const blank = await adminApi.post<Grid>(base(ws.id), { discipline: "lol", name: "LoL ladder" }, 201);
  expect(blank).toMatchObject({ discipline: "lol", name: "LoL ladder", slug: "lol-grid" });
  expect(blank.versions[0]).toMatchObject({ version: 1, status: "published" });
  expect(blank.versions[0].tiers).toHaveLength(31);

  // Give the source a custom shape so a copy is distinguishable from the native ladder.
  const draft = await adminApi.post<GridVersion>(`/api/v1/division-grids/versions/${blank.versions[0].id}/clone`, undefined, 201);
  const saved = await adminApi.put(`${base(ws.id)}/grid`, { grid_id: blank.id, tiers: THREE_TIERS });
  expect(saved.saved_version_id).toBeGreaterThan(draft.id);

  const copy = await adminApi.post<Grid>(base(ws.id), { discipline: "lol", name: "LoL copy", from_version_id: saved.saved_version_id }, 201);
  expect(copy.slug).toBe("lol-grid-2");
  expect(copy.versions[0].tiers.map((t) => t.name)).toEqual(["Top", "Mid", "Low"]);

  const crossGame = await adminApi.raw("POST", base(ws.id), { body: { discipline: "deadlock", name: "x", from_version_id: saved.saved_version_id } });
  expect(crossGame.status(), "copying a LoL version into a Deadlock grid").toBe(422);
  const other = await createWorkspace(adminApi);
  const disabled = await adminApi.raw("POST", base(other.id), { body: { discipline: "lol", name: "x" } });
  expect(disabled.status(), "a grid for a game the workspace has not enabled").toBe(422);
});

test("version lifecycle: clone → draft edit → readiness → publish (immutable) → activate", async ({ adminApi }) => {
  const ws = await createWorkspace(adminApi);
  await enableGames(adminApi, ws.id);
  const grid = await adminApi.post<Grid>(base(ws.id), { discipline: "lol", name: "Seasonal" }, 201);
  const draft = await adminApi.post<GridVersion>(`/api/v1/division-grids/versions/${grid.versions[0].id}/clone`, undefined, 201);
  expect(draft).toMatchObject({ grid_id: grid.id, version: 2, status: "draft" });

  const relabeled = await adminApi.patch<GridVersion>(`/api/v1/division-grids/versions/${draft.id}`, { label: "Season 2" });
  expect(relabeled.label).toBe("Season 2");

  const readiness = await adminApi.get(`${base(ws.id)}/versions/${draft.id}/readiness`);
  expect(readiness).toMatchObject({ target_version_id: draft.id, is_ready: true });

  const published = await adminApi.post<GridVersion>(`/api/v1/division-grids/versions/${draft.id}/publish`);
  expect(published.status).toBe("published");
  const immutable = await adminApi.raw("PATCH", `/api/v1/division-grids/versions/${draft.id}`, { body: { label: "edit" } });
  expect(immutable.status(), "published versions are immutable").toBe(409);

  await adminApi.post(`${base(ws.id)}/versions/${draft.id}/activate`);
  const after = await adminApi.get<WorkspaceRead>(`/api/v1/workspaces/${ws.id}`);
  expect(after.default_division_grid_versions.lol).toBe(draft.id);
  // A new lol tournament is pinned to the newly active version; overwatch is untouched.
  const t = await createTournament(adminApi, ws.id, { discipline: "lol" });
  expect((await adminApi.get(`/api/v1/admin/tournaments/${t.id}`)).division_grid_version_id).toBe(draft.id);
  expect(after.default_division_grid_versions.overwatch).toBeTruthy();

  const versions = await adminApi.get<GridVersion[]>(`/api/v1/division-grids/${grid.id}/versions`);
  expect(versions.map((v) => [v.version, v.status])).toEqual([
    [1, "published"],
    [2, "published"],
  ]);
});

test("a draft's tiers can be replaced with new ones", async ({ adminApi }) => {
  // The draft editor sends new rows without ids; the old rows still hold sort_order 0..n
  // when the new ones are inserted (services/division_grid/service.py update_version).
  const ws = await createWorkspace(adminApi);
  const [ow] = await listGrids(adminApi, ws.id);
  const draft = await adminApi.post<GridVersion>(`/api/v1/division-grids/versions/${ow.versions[0].id}/clone`, undefined, 201);
  const res = await adminApi.raw("PATCH", `/api/v1/division-grids/versions/${draft.id}`, { body: { tiers: THREE_TIERS } });
  expect(res.status(), `PATCH draft tiers -> ${res.status()} ${(await res.text()).slice(0, 300)}`).toBe(200);
  const stored = await adminApi.get<GridVersion>(`/api/v1/division-grids/versions/${draft.id}`);
  expect(stored.tiers.map((t) => t.slug)).toEqual(["top", "mid", "low"]);
});

test("removing the last tier and adding a replacement in its place saves", async ({ adminApi }) => {
  const ws = await createWorkspace(adminApi);
  const [ow] = await listGrids(adminApi, ws.id);
  const draft = await adminApi.post<GridVersion>(`/api/v1/division-grids/versions/${ow.versions[0].id}/clone`, undefined, 201);
  const kept = draft.tiers.slice(0, -1).map(({ id, slug, number, name, sort_order, rank_min, rank_max, icon_url }) => ({ id, slug, number, name, sort_order, rank_min, rank_max, icon_url }));
  const last = draft.tiers.at(-1)!;
  const replacement = { slug: "rookie", number: last.number, name: "Rookie", sort_order: last.sort_order, rank_min: last.rank_min, rank_max: last.rank_max, icon_url: last.icon_url };
  const res = await adminApi.raw("PATCH", `/api/v1/division-grids/versions/${draft.id}`, { body: { tiers: [...kept, replacement] } });
  expect(res.status(), `PATCH draft (swap last tier) -> ${res.status()} ${(await res.text()).slice(0, 300)}`).toBe(200);
});

test("a draft edit answers with the tiers it stored", async ({ adminApi }) => {
  const ws = await createWorkspace(adminApi);
  const [ow] = await listGrids(adminApi, ws.id);
  const draft = await adminApi.post<GridVersion>(`/api/v1/division-grids/versions/${ow.versions[0].id}/clone`, undefined, 201);
  const tiers = draft.tiers.map(({ id, slug, number, name, sort_order, rank_min, rank_max, icon_url }) => ({ id, slug, number, name, sort_order, rank_min, rank_max, icon_url }));
  tiers.push({ id: undefined as unknown as number, slug: "unranked", number: 99, name: "Unranked", sort_order: tiers.length, rank_min: -500, rank_max: -1, icon_url: "/divisions/bronze-5.png" });
  const answered = await adminApi.patch<GridVersion>(`/api/v1/division-grids/versions/${draft.id}`, { tiers });
  const stored = await adminApi.get<GridVersion>(`/api/v1/division-grids/versions/${draft.id}`);
  expect(stored.tiers).toHaveLength(46);
  expect(answered.tiers.map((t) => t.slug), "PATCH response tiers match what was stored").toEqual(stored.tiers.map((t) => t.slug));
});

test("library: rename, archive, delete guards and force delete", async ({ adminApi }) => {
  const ws = await createWorkspace(adminApi);
  await enableGames(adminApi, ws.id);
  const grid = await adminApi.post<Grid>(base(ws.id), { discipline: "deadlock", name: "Scratch" }, 201);
  expect((await adminApi.patch<Grid>(`/api/v1/division-grids/library/${grid.id}`, { name: "Renamed" })).name).toBe("Renamed");
  const archived = await adminApi.patch<Grid>(`/api/v1/division-grids/library/${grid.id}`, { archived: true });
  expect(archived.archived_at).toBeTruthy();
  expect((await adminApi.patch<Grid>(`/api/v1/division-grids/library/${grid.id}`, { archived: false })).archived_at).toBeNull();
  await adminApi.delete(`/api/v1/division-grids/library/${grid.id}`, 204);
  expect((await listGrids(adminApi, ws.id)).map((g) => g.id)).not.toContain(grid.id);

  // The active default is guarded; force clears the default and detaches pinned tournaments.
  const defaults = (await adminApi.get<WorkspaceRead>(`/api/v1/workspaces/${ws.id}`)).default_division_grid_versions;
  const dlDefault = (await listGrids(adminApi, ws.id)).find((g) => g.discipline === "deadlock" && g.versions.some((v) => v.id === defaults.deadlock))!;
  const pinned = await createTournament(adminApi, ws.id, { discipline: "deadlock" });
  const guarded = await adminApi.raw("DELETE", `/api/v1/division-grids/library/${dlDefault.id}`);
  expect(guarded.status(), "deleting the workspace default without force").toBe(409);
  await adminApi.call("DELETE", `/api/v1/division-grids/library/${dlDefault.id}`, { query: { force: true }, expectStatus: 204 });
  const after = await adminApi.get<WorkspaceRead>(`/api/v1/workspaces/${ws.id}`);
  expect(after.default_division_grid_versions.deadlock).toBeUndefined();
  expect((await adminApi.get(`/api/v1/admin/tournaments/${pinned.id}`)).division_grid_version_id).toBeNull();
  // Other games keep their defaults.
  expect(after.default_division_grid_versions.overwatch).toBe(defaults.overwatch);
});

test("portable export → import into another workspace", async ({ adminApi }) => {
  const src = await createWorkspace(adminApi);
  await enableGames(adminApi, src.id);
  const grid = await adminApi.post<Grid>(base(src.id), { discipline: "lol", name: "Exported" }, 201);
  await adminApi.put(`${base(src.id)}/grid`, { grid_id: grid.id, tiers: THREE_TIERS });
  const doc = await adminApi.get(`/api/v1/division-grids/library/${grid.id}/export`);
  expect(doc).toMatchObject({ schema_version: "division-grid/v2", discipline: "lol", name: "Exported" });
  expect(doc.versions.at(-1).tiers.map((t: { slug: string }) => t.slug)).toEqual(["top", "mid", "low"]);

  const owOnly = await createWorkspace(adminApi);
  const refused = await adminApi.raw("POST", `${base(owOnly.id)}/portable/import`, { body: { document: doc } });
  expect(refused.status(), "importing a LoL grid where LoL is not enabled").toBe(422);

  const dst = await createWorkspace(adminApi);
  await enableGames(adminApi, dst.id);
  const imported = await adminApi.post<Grid & { source_fingerprint: string; imported_at: string }>(`${base(dst.id)}/portable/import`, { document: doc }, 201);
  expect(imported).toMatchObject({ workspace_id: dst.id, discipline: "lol", name: "Exported" });
  expect(imported.imported_at).toBeTruthy();
  expect(imported.versions.at(-1)!.tiers.map((t) => t.name)).toEqual(["Top", "Mid", "Low"]);
});

test("marketplace: browse another workspace's grids, preflight, import job", async ({ adminApi }) => {
  const src = await createWorkspace(adminApi);
  const [srcOw] = await listGrids(adminApi, src.id);
  const dst = await createWorkspace(adminApi);

  const sources = await adminApi.get<{ id: number; grids_count: number }[]>(`${base(dst.id)}/marketplace/workspaces`);
  expect(sources.find((s) => s.id === src.id)?.grids_count).toBeGreaterThanOrEqual(1);
  const grids = await adminApi.get<{ id: number; versions: { id: number }[] }[]>(`${base(dst.id)}/marketplace`, { source_workspace_id: src.id });
  expect(grids.map((g) => g.id)).toContain(srcOw.id);

  const body = { source_workspace_id: src.id, source_grid_id: srcOw.id, source_version_id: srcOw.versions[0].id };
  const preflight = await adminApi.post(`${base(dst.id)}/marketplace/preflight`, body);
  expect(preflight).toMatchObject({ source_workspace_id: src.id, grids_count: 1, versions_count: 1, tiers_count: 45 });
  expect(preflight.conflicts, "same slug as the destination's own default").toContain("overwatch-default");

  const job = await adminApi.post<{ id: number; status: string }>(`${base(dst.id)}/marketplace/import`, body, 202);
  const done = await poll(async () => {
    const j = await adminApi.get(`${base(dst.id)}/import-jobs/${job.id}`);
    return ["completed", "failed"].includes(j.status) ? j : undefined;
  }, "grid import job");
  expect(done.status, `import job error: ${done.error}`).toBe("completed");
  expect(done.result).toMatchObject({ created_grids: 1, created_tiers: 45 });
  expect((await adminApi.get<{ id: number }[]>(`${base(dst.id)}/import-jobs`)).map((j) => j.id)).toContain(job.id);
  const imported = (await listGrids(adminApi, dst.id)).find((g) => g.source_workspace_id === src.id);
  expect(imported?.slug).toBe("overwatch-default-copy");
});

test("players carry the division of the tournament's grid version", async ({ adminApi, anonApi }) => {
  const ws = await createWorkspace(adminApi);
  const [ow] = await listGrids(adminApi, ws.id);
  const t = await createTournament(adminApi, ws.id);
  expect((await adminApi.get(`/api/v1/admin/tournaments/${t.id}`)).division_grid_version_id).toBe(ow.versions[0].id);
  const [team] = await seedTeams(adminApi, t.id, 1);
  const pub = await anonApi.get<{ results: { players: { rank: number; division: number }[] }[] }>("/api/v1/teams", {
    tournament_id: t.id,
    entities: "players",
  });
  for (const p of pub.results[0].players) {
    const tier = ow.versions[0].tiers.find((x) => p.rank >= x.rank_min && (x.rank_max === null || p.rank <= x.rank_max));
    expect(p.division, `rank ${p.rank}`).toBe(tier?.number);
  }
  expect(team.players.length).toBeGreaterThan(0);
});
