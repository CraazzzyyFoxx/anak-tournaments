import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { path: string; options?: { method?: string; query?: Record<string, unknown>; body?: unknown; signal?: AbortSignal } };

const calls: Call[] = [];
let reply: unknown = {};

vi.mock("@/lib/api/fetch", () => ({
  apiFetch: (path: string, options?: Call["options"]) => {
    calls.push({ path, options });
    return Promise.resolve({ json: async () => reply });
  }
}));

const { default: adminService } = await import("@/services/admin.service");

describe("adminService on the generic catalog", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("starts a whole discipline's background sync and reads its snapshot back", async () => {
    reply = { discipline: "lol", status: "running", stages: [] };
    expect(await adminService.startCatalogSync("lol")).toBe(reply);
    reply = null;
    expect(await adminService.getCatalogSync("lol")).toBeNull();
    expect(calls).toEqual([
      { path: "/api/v1/admin/catalog-sync/lol", options: { method: "POST" } },
      { path: "/api/v1/admin/catalog-sync/lol", options: undefined }
    ]);
  });

  it("lists one discipline's kind and sends attrs filters as a JSON object", async () => {
    reply = { results: [], total: 0, page: 1, per_page: 25 };
    const signal = new AbortController().signal;
    await adminService.listCatalogEntities(
      "lol",
      "character",
      { page: 2, per_page: 25, search: "ah", attrs: { class: "mage" } },
      { signal }
    );
    expect(calls[0].path).toBe("/api/v1/admin/catalog/lol/character");
    expect(calls[0].options?.query).toEqual({ page: 2, per_page: 25, search: "ah", attrs: JSON.stringify({ class: "mage" }) });
    expect(calls[0].options?.signal).toBe(signal);
  });

  it("creates, updates and deletes by discipline, kind and id with the body untouched", async () => {
    reply = { id: 7 };
    await adminService.createCatalogEntity("overwatch", "map", { name: "Ilios", parent_id: 3, attrs: { in_competitive: false } });
    await adminService.updateCatalogEntity("lol", "character", 901, { attrs: { color: "#fff" } });
    await adminService.deleteCatalogEntity("overwatch", "mode", 4);
    expect(calls).toEqual([
      {
        path: "/api/v1/admin/catalog/overwatch/map",
        options: { method: "POST", body: { name: "Ilios", parent_id: 3, attrs: { in_competitive: false } } }
      },
      { path: "/api/v1/admin/catalog/lol/character/901", options: { method: "PATCH", body: { attrs: { color: "#fff" } } } },
      { path: "/api/v1/admin/catalog/overwatch/mode/4", options: { method: "DELETE" } }
    ]);
  });

  it("returns the queue exactly as the API sends it, whatever the discipline or kind", async () => {
    reply = {
      results: [
        { id: 3, discipline: "overwatch", kind: "mode", raw_name: "Захват", occurrences: 2, first_seen_at: "x", last_seen_at: "y", last_ingest_job_id: 11, last_log_tournament_id: 5, resolved_at: null },
        { id: 4, discipline: "lol", kind: "role", raw_name: "position:ghost", occurrences: 1, first_seen_at: "x", last_seen_at: "y", last_ingest_job_id: null, last_log_tournament_id: null, resolved_at: null }
      ],
      total: 2, page: 1, per_page: 50
    };
    const page = await adminService.getCatalogAliasMisses();
    expect(calls[0].options?.query).toEqual({});
    expect(page).toBe(reply);
  });

  it.each(["character", "map", "mode", "stat", "event", "role"] as const)("filters the queue by %s and discipline without converting", async (kind) => {
    reply = { results: [], total: 0, page: 1, per_page: 50 };
    await adminService.getCatalogAliasMisses({ kind, discipline: "lol", page: 2, per_page: 25, include_resolved: true });
    expect(calls[0].options?.query).toEqual({ discipline: "lol", kind, page: 2, per_page: 25, include_resolved: true });
  });

  it("attaches an alias by entity id only", async () => {
    reply = {};
    await adminService.attachCatalogAlias({ entity_id: 901, alias: "Ана" });
    expect(calls[0]).toEqual({
      path: "/api/v1/admin/catalog-aliases/attach",
      options: { method: "POST", body: { entity_id: 901, alias: "Ана" } }
    });
  });
});
