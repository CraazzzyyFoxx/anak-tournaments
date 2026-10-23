import { sql } from "../support/env";
import { expect, test } from "../support/fixtures";
import { createTournament, createWorkspace, uniq } from "../support/seed";
import { type CatalogEntity, seedModeAndMap, setMapPool } from "../support/workspace";

type Page<T> = { results: T[]; total: number };

test("disciplines and their metadata describe four games with their own roles", async ({ anonApi }) => {
  const games = await anonApi.get<{ code: string; kinds: Record<string, string>; enabled: boolean }[]>("/api/v1/disciplines");
  const byCode = Object.fromEntries(games.map((g) => [g.code, g]));
  expect(Object.keys(byCode).sort()).toEqual(["deadlock", "lol", "overwatch", "valorant"]);
  expect(Object.keys(byCode.overwatch.kinds).sort()).toEqual(["character", "map", "mode"]);
  // LoL declares no game modes.
  expect(Object.keys(byCode.lol.kinds).sort()).toEqual(["character", "map"]);

  const roles = async (d: string) =>
    (await anonApi.get<{ roles: { code: string }[] }>(`/api/v1/disciplines/${d}/metadata`)).roles.map((r) => r.code);
  expect(await roles("overwatch")).toEqual(["tank", "damage", "support"]);
  expect(await roles("lol")).toEqual(["top", "jungle", "mid", "bot", "support"]);
  expect(await roles("deadlock")).toEqual(["agent"]);
  expect(await roles("valorant")).toEqual(["agent"]);
});

test("public catalog reads per game: declared kinds answer, undeclared kinds and unknown games are 404", async ({ anonApi }) => {
  for (const [d, kinds] of [
    ["overwatch", ["character", "map", "mode"]],
    ["lol", ["character", "map"]],
    ["deadlock", ["character", "map", "mode"]],
    ["valorant", ["character", "map"]],
  ] as const) {
    for (const kind of kinds) {
      const page = await anonApi.get<Page<CatalogEntity>>(`/api/v1/catalog/${d}/${kind}`);
      expect(Array.isArray(page.results), `${d}/${kind}`).toBe(true);
      for (const e of page.results) expect(e).toMatchObject({ discipline: d, kind });
    }
  }
  expect((await anonApi.raw("GET", "/api/v1/catalog/lol/mode")).status()).toBe(404);
  expect((await anonApi.raw("GET", "/api/v1/catalog/valorant/mode")).status()).toBe(404);
  expect((await anonApi.raw("GET", "/api/v1/catalog/dota/map")).status()).toBe(404);
});

test("admin CRUD across games; validation, duplicates and in-use guards", async ({ adminApi, anonApi }) => {
  const tag = uniq("c").slice(2);
  const missingClass = await adminApi.raw("POST", "/api/v1/admin/catalog/lol/character", { body: { name: `Ahri ${tag}` } });
  expect(missingClass.status(), "a LoL champion needs a class from the game's list").toBe(422);
  const champ = await adminApi.post<CatalogEntity>("/api/v1/admin/catalog/lol/character", { name: `Ahri ${tag}`, attrs: { class: "Mage" }, aliases: [`fox-${tag}`] });
  expect(champ).toMatchObject({ discipline: "lol", kind: "character", slug: `ahri-${tag}`, active: true, aliases: [`fox-${tag}`] });
  const dup = await adminApi.raw("POST", "/api/v1/admin/catalog/lol/character", { body: { name: `Ahri ${tag}`, attrs: { class: "Mage" } } });
  expect(dup.status(), "duplicate slug").toBe(400);
  expect((await adminApi.raw("POST", "/api/v1/admin/catalog/lol/mode", { body: { name: "x" } })).status(), "LoL has no modes").toBe(404);

  const renamed = await adminApi.patch<CatalogEntity>(`/api/v1/admin/catalog/lol/character/${champ.id}`, { name: `Ahri ${tag} (KDA)` });
  expect(renamed.name).toBe(`Ahri ${tag} (KDA)`);
  expect((await anonApi.get(`/api/v1/catalog/lol/character/${champ.id}`)).name).toBe(`Ahri ${tag} (KDA)`);

  const { mode, map } = await seedModeAndMap(adminApi, "deadlock", tag);
  const maps = await anonApi.get<Page<CatalogEntity & { parent: { name: string } }>>("/api/v1/catalog/deadlock/map", { parent_id: mode.id });
  expect(maps.results.map((m) => [m.id, m.parent.name])).toEqual([[map.id, mode.name]]);
  const inUse = await adminApi.raw("DELETE", `/api/v1/admin/catalog/deadlock/mode/${mode.id}`);
  expect(inUse.status(), "deleting a mode that still has maps").toBe(409);

  await adminApi.delete(`/api/v1/admin/catalog/deadlock/map/${map.id}`, 204);
  await adminApi.delete(`/api/v1/admin/catalog/deadlock/mode/${mode.id}`, 204);
  await adminApi.delete(`/api/v1/admin/catalog/lol/character/${champ.id}`, 204);
  expect((await anonApi.raw("GET", `/api/v1/catalog/lol/character/${champ.id}`)).status()).toBe(404);
});

test("deactivating an entity hides it from the public list; the admin filter finds it", async ({ adminApi, anonApi }) => {
  const tag = uniq("act").slice(4);
  const hero = await adminApi.post<CatalogEntity>("/api/v1/admin/catalog/deadlock/character", { name: `Haze ${tag}`, attrs: { class: "assassin" } });
  await adminApi.patch(`/api/v1/admin/catalog/deadlock/character/${hero.id}`, { active: false });
  const pub = await anonApi.get<Page<CatalogEntity>>("/api/v1/catalog/deadlock/character", { search: tag });
  expect(pub.results.map((e) => e.id), "inactive entity in the default public list").not.toContain(hero.id);
  expect((await adminApi.get<Page<CatalogEntity>>("/api/v1/admin/catalog/deadlock/character", { search: tag, active: false })).results.map((e) => e.id)).toEqual([hero.id]);
  expect((await adminApi.get<Page<CatalogEntity>>("/api/v1/admin/catalog/deadlock/character", { search: tag, active: true })).total).toBe(0);
  await adminApi.patch(`/api/v1/admin/catalog/deadlock/character/${hero.id}`, { active: true });
  expect((await anonApi.get<Page<CatalogEntity>>("/api/v1/catalog/deadlock/character", { search: tag })).results.map((e) => e.id)).toEqual([hero.id]);
});

test("catalog writes are superuser-only", async ({ makeUser }) => {
  const user = await makeUser("cat");
  const res = await user.api.raw("POST", "/api/v1/admin/catalog/overwatch/map", { body: { name: "Nope" } });
  expect(res.status()).toBe(403);
  expect((await user.api.raw("GET", "/api/v1/admin/catalog-aliases/misses")).status()).toBe(403);
});

test("alias misses: attach adds the alias and closes the miss, dismiss closes it", async ({ adminApi, anonApi }) => {
  const tag = uniq("al").slice(3);
  const hero = await adminApi.post<CatalogEntity>("/api/v1/admin/catalog/overwatch/character", { name: `Ana ${tag}`, attrs: { class: "support" } });
  // Misses are written by match-log ingestion (out of scope here); seed two rows directly.
  sql(
    `INSERT INTO catalog.alias_miss (discipline, kind, raw_name, occurrences) VALUES ('overwatch','character','Анна ${tag}',3), ('overwatch','map','Kart ${tag}',1)`
  );
  const open = await adminApi.get<Page<{ id: number; raw_name: string; occurrences: number }>>("/api/v1/admin/catalog-aliases/misses", { per_page: 500 });
  const attachMiss = open.results.find((m) => m.raw_name === `Анна ${tag}`);
  const dismissMiss = open.results.find((m) => m.raw_name === `Kart ${tag}`);
  expect(attachMiss?.occurrences).toBe(3);
  expect(dismissMiss).toBeTruthy();

  await adminApi.post("/api/v1/admin/catalog-aliases/attach", { entity_id: hero.id, alias: `Анна ${tag}` });
  expect((await anonApi.get<CatalogEntity>(`/api/v1/catalog/overwatch/character/${hero.id}`)).aliases).toContain(`Анна ${tag}`);
  await adminApi.post(`/api/v1/admin/catalog-aliases/misses/${dismissMiss!.id}/dismiss`);

  const still = await adminApi.get<Page<{ raw_name: string }>>("/api/v1/admin/catalog-aliases/misses", { per_page: 500 });
  expect(still.results.map((m) => m.raw_name)).not.toContain(`Анна ${tag}`);
  expect(still.results.map((m) => m.raw_name)).not.toContain(`Kart ${tag}`);
  expect((await adminApi.raw("POST", "/api/v1/admin/catalog-aliases/misses/999999999/dismiss")).status()).toBe(404);
});

test("a map pool names its maps, and each map names its mode", async ({ adminApi, anonApi }) => {
  const ws = await createWorkspace(adminApi);
  const t = await createTournament(adminApi, ws.id);
  expect((await anonApi.get(`/api/v1/tournaments/${t.id}/pick-ban-configs`)).configs).toEqual([]);
  const { mode, map } = await seedModeAndMap(adminApi, "overwatch", uniq("pool").slice(5));
  await setMapPool(adminApi, t.id, [map.id]);
  const { configs } = await anonApi.get<{ configs: { kind: string; item_ids: number[] }[] }>(`/api/v1/tournaments/${t.id}/pick-ban-configs`);
  expect(configs.map((c) => [c.kind, c.item_ids])).toEqual([["map", [map.id]]]);
  const entity = await anonApi.get<CatalogEntity & { parent: { name: string } }>(`/api/v1/catalog/overwatch/map/${map.id}`);
  expect(entity.parent.name).toBe(mode.name);
});

test("an image upload against the unavailable object store fails fast with a structured error", async ({ admin }) => {
  // S3 is deliberately unreachable in this stack: the contract is a clean error, not a hang.
  const started = Date.now();
  const res = await fetch(`${process.env.E2E_BASE_URL ?? "http://localhost:8090"}/api/v1/assets/catalog/overwatch-map-${uniq("img").slice(4)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${admin.accessToken}` },
    body: (() => {
      const form = new FormData();
      form.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64")], { type: "image/png" }), "x.png");
      return form;
    })(),
  });
  expect(res.ok).toBe(false);
  expect(await res.json()).toHaveProperty("detail");
  expect(Date.now() - started, "upload error returned within the gateway timeout").toBeLessThan(30_000);
});
