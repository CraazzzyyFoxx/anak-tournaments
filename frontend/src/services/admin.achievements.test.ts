import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { path: string; options?: { method?: string; query?: Record<string, unknown>; body?: unknown } };

const calls: Call[] = [];
let reply: unknown = {};
let headers = new Headers();

vi.mock("@/lib/api/fetch", () => ({
  apiFetch: (path: string, options?: Call["options"]) => {
    calls.push({ path, options });
    return Promise.resolve({
      json: async () => reply,
      blob: async () => new Blob([JSON.stringify(reply)]),
      headers,
    });
  },
}));

const { default: adminService } = await import("@/services/admin.service");

const WS = "/api/v1/admin/ws/7/achievements";

describe("achievement admin calls name the game", () => {
  beforeEach(() => {
    calls.length = 0;
    reply = {};
    headers = new Headers();
  });

  it.each([
    ["rule list", () => adminService.getAchievementRules(7, "lol", { per_page: -1 }), `${WS}/rules`],
    ["metadata", () => adminService.getConditionTypes(7, "lol"), `${WS}/rules/condition-types`],
    ["seed", () => adminService.seedAchievementRules(7, "lol"), `${WS}/rules/seed`],
    ["reset", () => adminService.hardResetAchievementRules(7, "lol"), `${WS}/rules/reset`],
    ["library workspaces", () => adminService.getAchievementLibraryWorkspaces(7, "lol"), `${WS}/library/workspaces`],
    ["library rules", () => adminService.getAchievementLibraryRules(7, 9, "lol"), `${WS}/library`],
    ["overrides", () => adminService.getAchievementOverrides(7, "lol"), `${WS}/overrides`],
  ])("sends discipline as a query on the %s call", async (_name, call, path) => {
    reply = { results: [] };
    await call();
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe(path);
    expect(calls[0].options?.query).toMatchObject({ discipline: "lol" });
  });

  it("sends discipline in the body of validate, evaluate and library import", async () => {
    await adminService.validateConditionTree(7, "lol", { type: "x" });
    await adminService.evaluateAchievements(7, "lol", { tournament_id: 3, rule_ids: [1] });
    await adminService.importAchievementLibraryRules(7, { source_workspace_id: 9, discipline: "lol", slugs: ["a"] });
    expect(calls.map((call) => call.options?.body)).toEqual([
      { discipline: "lol", condition_tree: { type: "x" } },
      { discipline: "lol", tournament_id: 3, rule_ids: [1] },
      { source_workspace_id: 9, discipline: "lol", slugs: ["a"] },
    ]);
  });

  it("exports one game's rules and names the file after it", async () => {
    reply = { schema_version: 2, exported_at: "now", source_workspace: null, rules: [] };
    const { filename, data } = await adminService.exportAchievementRules(7, "lol");
    expect(calls[0].options?.query).toEqual({ discipline: "lol" });
    expect(filename).toBe("achievements-workspace-7-lol.json");
    expect(data.schema_version).toBe(2);
  });

  it("imports a portable v2 file exactly as read: each rule carries its own game", async () => {
    const envelope = {
      schema_version: 2 as const,
      exported_at: "now",
      source_workspace: null,
      rules: [{ slug: "a", discipline: "lol", entity_id: 4 }] as never,
    };
    await adminService.importAchievementRules(7, envelope);
    expect(calls[0].path).toBe(`${WS}/rules/import`);
    expect(calls[0].options?.body).toBe(envelope);
  });

  it("creates a rule in its own game with its entity, and updates without either discipline or hero_id", async () => {
    await adminService.createAchievementRule(7, {
      slug: "s",
      name: "n",
      description_ru: "r",
      description_en: "e",
      discipline: "lol",
      entity_id: 12,
      category: "overall",
      scope: "global",
      grain: "user",
      condition_tree: {},
    });
    await adminService.updateAchievementRule(7, 5, { entity_id: 12 });
    expect(calls[0].options?.body).toMatchObject({ discipline: "lol", entity_id: 12 });
    expect(calls[1].options?.body).toEqual({ entity_id: 12 });
    expect(JSON.stringify(calls)).not.toContain("hero_id");
  });

  it("reads one game's character catalog for the entity picker", async () => {
    reply = { results: [{ id: 1, name: "Ahri" }] };
    const characters = await adminService.getCatalogCharacters("lol");
    expect(calls[0].path).toBe("/api/v1/admin/catalog/lol/character");
    expect(characters).toEqual([{ id: 1, name: "Ahri" }]);
  });
});
