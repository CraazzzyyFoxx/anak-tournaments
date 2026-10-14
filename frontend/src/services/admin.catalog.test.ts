import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { path: string; options?: { method?: string; query?: Record<string, unknown>; body?: unknown } };

const calls: Call[] = [];
let reply: unknown = {};

vi.mock("@/lib/api/fetch", () => ({
  apiFetch: (path: string, options?: Call["options"]) => {
    calls.push({ path, options });
    return Promise.resolve({ json: async () => reply });
  }
}));

const { default: adminService } = await import("@/services/admin.service");

const ENTITY = {
  id: 901,
  created_at: "2026-10-14T00:00:00Z",
  updated_at: null,
  discipline: "overwatch",
  slug: "ana",
  name: "Ana",
  image_path: "https://s3/ana.png",
  parent_id: null,
  aliases: ["Ана"],
  active: true,
  parent: null
};

describe("adminService on the generic catalog", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("syncs a whole discipline at once", async () => {
    reply = { success: true };
    const result = await adminService.syncCatalog("overwatch");
    expect(calls[0]).toEqual({ path: "/api/v1/admin/catalog-sync/overwatch", options: { method: "POST" } });
    expect(result).toEqual({ success: true });
  });

  it("lists heroes as overwatch characters and filters the role through attrs", async () => {
    reply = { results: [{ ...ENTITY, kind: "character", attrs: { class: "support", color: "#718ab3" } }], total: 1, page: 1, per_page: 50 };
    const page = await adminService.getHeroes({ role: "Support", sort: "role" });
    expect(calls[0].path).toBe("/api/v1/admin/catalog/overwatch/character");
    expect(calls[0].options?.query).toEqual({ attrs: JSON.stringify({ class: "support" }) });
    expect(page.results[0]).toMatchObject({ id: 901, type: "Support", role: "Support", color: "#718ab3", aliases: ["Ана"] });
  });

  it("creates a map under its mode with the competitive flag in attrs", async () => {
    reply = { ...ENTITY, kind: "map", parent_id: 7, attrs: { in_competitive: false }, parent: { id: 7, slug: "push", name: "Push" } };
    const created = await adminService.createMap({ name: "Ilios", gamemode_id: 7, in_competitive: false, aliases: [] });
    expect(calls[0]).toEqual({
      path: "/api/v1/admin/catalog/overwatch/map",
      options: { method: "POST", body: { name: "Ilios", parent_id: 7, aliases: [], attrs: { in_competitive: false } } }
    });
    expect(created).toMatchObject({ gamemode_id: 7, in_competitive: false, gamemode: { id: 7, name: "Push" } });
  });

  it("reads the alias queue by kind and keeps the page's entity vocabulary", async () => {
    reply = {
      results: [{ id: 3, discipline: "overwatch", kind: "mode", raw_name: "Захват", occurrences: 2, first_seen_at: "x", last_seen_at: "y", last_ingest_job_id: 11, last_log_tournament_id: 5, resolved_at: null }],
      total: 1, page: 1, per_page: 50
    };
    const page = await adminService.getCatalogAliasMisses({ entity_type: "gamemode" });
    expect(calls[0].options?.query).toEqual({ discipline: "overwatch", kind: "mode" });
    expect(page.results[0]).toMatchObject({ entity_type: "gamemode", last_log_record_id: 11, last_log_tournament_id: 5 });
  });

  it("attaches an alias by entity id only", async () => {
    reply = {};
    await adminService.attachCatalogAlias({ entity_type: "hero", entity_id: 901, alias: "Ана" });
    expect(calls[0]).toEqual({
      path: "/api/v1/admin/catalog-aliases/attach",
      options: { method: "POST", body: { entity_id: 901, alias: "Ана" } }
    });
  });

  it.each([
    [{ color: "#ffffff" }, { color: "#ffffff" }],
    [{ role: "Tank" }, { class: "tank" }],
    [{ role: "Support", color: "#718ab3" }, { class: "support", color: "#718ab3" }]
  ])("sends partial hero attrs independently for %j", async (input, attrs) => {
    reply = { ...ENTITY, kind: "character", attrs: { class: "support", color: "#718ab3" } };
    await adminService.updateHero(901, input);
    expect(calls[0]).toEqual({
      path: "/api/v1/admin/catalog/overwatch/character/901",
      options: { method: "PATCH", body: { attrs } }
    });
  });
});
