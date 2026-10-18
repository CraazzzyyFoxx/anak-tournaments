import { beforeEach, describe, expect, it, vi } from "vitest";
import adminService from "@/services/admin.service";

type Call = { path: string; options?: { method?: string; body?: unknown; query?: unknown; signal?: AbortSignal } };
const calls: Call[] = [];
vi.mock("@/lib/api/fetch", () => ({ apiFetch: (path: string, options?: Call["options"]) => {
  calls.push({ path, options }); return Promise.resolve({ json: async () => ({ id: 7 }) });
} }));
const format = { name: "Native", preset_code: null, starter_min: 4, starter_max: 6, substitute_min: 0, substitute_max: 2,
  dimensions: [{ dimension: "position", mode: "preference" as const, player_min_assignments: 0, player_max_assignments: null }],
  rules: [{ role: { dimension: "position", role: "support_child", parent: "support" }, hard_max: 0, recommended_min: null, include_descendants: false }] };

describe("native tournament team format service", () => {
  beforeEach(() => { calls.length = 0; });
  it("PATCHes only tournament fields, with no slot-map GET/adapt/PUT", async () => {
    await adminService.updateTournament(7, { name: "Cup" });
    expect(calls).toEqual([{ path: "/api/v1/admin/tournaments/7", options: { method: "PATCH", body: { name: "Cup" } } }]);
  });
  it("PUTs the full native format directly, preserving zero/null and stripping read-only parent", async () => {
    await adminService.updateTournamentTeamFormat(7, 9, format);
    expect(calls).toHaveLength(1);
    expect(calls[0].options?.query).toEqual({ workspace_id: 9 });
    expect(calls[0].options?.body).toEqual({ ...format, rules: [{ ...format.rules[0], role: { dimension: "position", role: "support_child" } }] });
  });
  it("passes the captured owner workspace and query cancellation signal to the native read", async () => {
    const signal = new AbortController().signal;
    await adminService.getTournamentTeamFormat(7, 9, signal);
    expect(calls[0].options).toMatchObject({ query: { workspace_id: 9 }, signal, skipWorkspace: true });
  });
});
