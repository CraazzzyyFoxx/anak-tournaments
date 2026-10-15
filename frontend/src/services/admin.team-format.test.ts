import { beforeEach, describe, expect, it, vi } from "vitest";
import adminService from "@/services/admin.service";

type Call = { path: string; options?: { method?: string; body?: unknown } };

const calls: Call[] = [];

vi.mock("@/lib/api/fetch", () => ({
  apiFetch: (path: string, options?: Call["options"]) => {
    calls.push({ path, options });
    return Promise.resolve({ json: async () => ({ id: 7 }) });
  }
}));


describe("adminService.updateTournament with a roster", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("sends the slot map as the tournament's team format and the rest as a patch", async () => {
    await adminService.updateTournament(7, { name: "Cup", roster_slots_json: { flex: 6 } });
    expect(calls.map((call) => [call.options?.method ?? "GET", call.path])).toEqual([
      ["PUT", "/api/v1/admin/tournaments/7/team-format"],
      ["PATCH", "/api/v1/admin/tournaments/7"]
    ]);
    expect(calls[1].options?.body).toEqual({ name: "Cup" });
  });

  it("re-reads the tournament when only the roster changed", async () => {
    await adminService.updateTournament(7, { roster_slots_json: { tank: 1, flex: 5 } });
    expect(calls.map((call) => call.options?.method ?? "GET")).toEqual(["PUT", "GET"]);
  });
});
