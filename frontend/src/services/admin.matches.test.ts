import { beforeEach, describe, expect, it, vi } from "vitest";

import adminService from "@/services/admin.service";

const calls: string[] = [];

vi.mock("@/lib/api/fetch", () => ({
  apiFetch: (path: string) => {
    calls.push(path);
    return Promise.resolve({ json: async () => ({ results: [], total: 0, page: 1, per_page: 25 }) });
  }
}));

describe("adminService.listAdminMatches", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("narrows the parsed maps to the game in scope", async () => {
    await adminService.listAdminMatches({ workspace_id: 4, map_id: 3, discipline: "lol" });

    expect(calls[0]).toBe("/api/v1/admin/matches?workspace_id=4&map_id=3&discipline=lol");
  });

  it("names no game for every game's maps", async () => {
    await adminService.listAdminMatches({ workspace_id: 4, discipline: null });

    expect(calls[0]).toBe("/api/v1/admin/matches?workspace_id=4");
  });
});
