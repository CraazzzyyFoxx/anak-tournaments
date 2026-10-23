import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { path: string; options?: { skipWorkspace?: boolean; signal?: AbortSignal; query?: Record<string, unknown> } };

const calls: Call[] = [];
let reply: unknown = {};

vi.mock("@/lib/api/fetch", () => ({
  apiFetch: (path: string, options?: Call["options"]) => {
    calls.push({ path, options });
    return Promise.resolve({ json: async () => reply });
  }
}));

const { default: catalogService } = await import("@/services/catalog.service");

describe("catalogService", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("reads one discipline's kind with no workspace and the caller's abort signal", async () => {
    reply = { results: [], total: 0, page: 1, per_page: 50 };
    const signal = new AbortController().signal;
    await catalogService.list("lol", "character", { per_page: -1, sort: "name", order: "asc" }, { signal });
    expect(calls[0].path).toBe("/api/v1/catalog/lol/character");
    expect(calls[0].options).toMatchObject({
      skipWorkspace: true,
      signal,
      query: { per_page: -1, sort: "name", order: "asc" }
    });
  });

  it("serializes attrs and the active flag, and omits attrs when absent", async () => {
    reply = { results: [] };
    await catalogService.list("overwatch", "map", { parent_id: 3, attrs: { in_competitive: true }, active: false });
    expect(calls[0].options?.query).toEqual({
      parent_id: 3,
      active: false,
      attrs: JSON.stringify({ in_competitive: true })
    });
    await catalogService.list("overwatch", "map");
    expect(calls[1].options?.query).toEqual({});
  });

  it("reads one entity by discipline, kind and id", async () => {
    reply = { id: 12 };
    const entity = await catalogService.get("lol", "map", 12);
    expect(calls[0].path).toBe("/api/v1/catalog/lol/map/12");
    expect(calls[0].options).toMatchObject({ skipWorkspace: true });
    expect(entity).toEqual({ id: 12 });
  });
});
