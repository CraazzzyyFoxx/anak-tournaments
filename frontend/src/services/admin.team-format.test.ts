import { beforeEach, describe, expect, it, vi } from "vitest";
import adminService from "@/services/admin.service";

type Call = { path: string; options?: { method?: string; body?: unknown } };

const calls: Call[] = [];
const currentFormat = {
  name: "Cup format",
  preset_code: "role_queue_5v5",
  starter_min: 5,
  starter_max: 5,
  substitute_min: 1,
  substitute_max: 3,
  roster_shape: { dimension: "player_role" },
  dimensions: [
    { dimension: "player_role", mode: "enforced", player_max_assignments: 1 },
    { dimension: "communication", mode: "informational" }
  ],
  rules: [
    {
      role: { dimension: "player_role", role: "tank" },
      hard_min: 1,
      hard_max: 1,
      recommended_max: 2
    },
    { role: { dimension: "player_role", role: "damage" }, hard_min: 2, hard_max: 2 },
    { role: { dimension: "player_role", role: "support_main" }, hard_max: 2, recommended_max: 1 },
    { role: { dimension: "communication", role: "caller" }, hard_min: 1, recommended_min: 1 }
  ]
};

vi.mock("@/lib/api/fetch", () => ({
  apiFetch: (path: string, options?: Call["options"]) => {
    calls.push({ path, options });
    return Promise.resolve({
      json: async () => (path.endsWith("/team-format") ? currentFormat : { id: 7 })
    });
  }
}));

describe("adminService.updateTournament with a roster", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("sends the slot map as the tournament's team format and the rest as a patch", async () => {
    await adminService.updateTournament(7, { name: "Cup", roster_slots_json: { flex: 6 } });
    expect(calls.map((call) => [call.options?.method ?? "GET", call.path])).toEqual([
      ["GET", "/api/v1/admin/tournaments/7/team-format"],
      ["PUT", "/api/v1/admin/tournaments/7/team-format"],
      ["PATCH", "/api/v1/admin/tournaments/7"]
    ]);
    expect(calls[2].options?.body).toEqual({ name: "Cup" });
  });

  it("re-reads the tournament when only the roster changed", async () => {
    await adminService.updateTournament(7, { roster_slots_json: { tank: 1, flex: 5 } });
    expect(calls.map((call) => call.options?.method ?? "GET")).toEqual(["GET", "PUT", "GET"]);
    expect(calls[1].options?.body).toEqual({
      name: currentFormat.name,
      preset_code: currentFormat.preset_code,
      starter_min: 6,
      starter_max: 6,
      substitute_min: 1,
      substitute_max: 3,
      dimensions: currentFormat.dimensions,
      rules: [
        {
          role: { dimension: "player_role", role: "tank" },
          hard_min: 1,
          hard_max: 1,
          recommended_max: 2
        },
        { role: { dimension: "player_role", role: "support_main" }, recommended_max: 1 },
        currentFormat.rules[3]
      ]
    });
  });
});
