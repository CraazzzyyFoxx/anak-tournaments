import { beforeEach, describe, expect, it, vi } from "vitest";

import statisticsService from "@/services/statistics.service";

type Call = { path: string; options?: { skipAuth?: boolean; query?: Record<string, unknown> } };

const calls: Call[] = [];

vi.mock("@/lib/api/fetch", () => ({
  apiFetch: (path: string, options?: Call["options"]) => {
    calls.push({ path, options });
    return Promise.resolve({ json: async () => ({ results: [], total: 0, page: 1, per_page: 10 }) });
  }
}));

describe("statisticsService.getCharacterPlaytime", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("carries the viewer's identity on a tournament-scoped read (hidden tournaments are gated on it)", async () => {
    await statisticsService.getCharacterPlaytime("overwatch", { axis: 7, tournamentId: 42, perPage: -1 });
    expect(calls[0].path).toBe("/api/v1/statistics/overwatch/characters/playtime");
    expect(calls[0].options?.skipAuth).toBe(false);
    expect(calls[0].options?.query).toMatchObject({ tournament_id: 42, workspace_id: 7 });
  });

  it("stays anonymous on the community read with no tournament", async () => {
    await statisticsService.getCharacterPlaytime("lol", { axis: 7 });
    expect(calls[0].options?.skipAuth).toBe(true);
    expect(calls[0].options?.query).toMatchObject({ workspace_id: 7, tournament_id: undefined });
  });
});

describe("statisticsService leaderboards", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("reads the cross-game board with no game and one game's board with its code", async () => {
    await statisticsService.getChampions(null, { skipWorkspace: true });
    await statisticsService.getTopWinratePlayers("lol", { workspaceId: 7 });

    expect(calls[0]).toMatchObject({
      path: "/api/v1/statistics/champion",
      options: { query: { discipline: null, sort: "value", order: "desc" } }
    });
    expect(calls[1]).toMatchObject({
      path: "/api/v1/statistics/winrate",
      options: { query: { discipline: "lol", workspace_id: 7 } }
    });
  });
});
