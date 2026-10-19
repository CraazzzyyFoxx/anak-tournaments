import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ scope: vi.fn(), list: vi.fn() }));

vi.mock("@/lib/site/tenant-host", () => ({ resolveServerDisciplineScope: mocks.scope }));
vi.mock("@/services/discipline.service", () => ({ default: { list: mocks.list } }));

const { loadGameScopeInit, resolveServerPageGame } = await import("./discipline-server");

const OW = { code: "overwatch", enabled: true };
const LOL = { code: "lol", enabled: true };

beforeEach(() => {
  mocks.scope.mockReset().mockResolvedValue({ stored: "lol", lastGame: "overwatch", axis: "all", hostLockedWorkspaceId: null });
  mocks.list.mockReset().mockImplementation(async (axis: number | "all") => (axis === 5 ? [OW, { ...LOL, enabled: false }] : [OW, LOL]));
});

describe("loadGameScopeInit", () => {
  it("hands the client the saved scope, the last game and the games read for the same axis; a failed read is null", async () => {
    expect(await loadGameScopeInit()).toEqual({
      stored: "lol",
      lastGame: "overwatch",
      axis: "all",
      hostLockedWorkspaceId: null,
      disciplines: [OW, LOL]
    });
    expect(mocks.list).toHaveBeenCalledWith("all");

    mocks.list.mockRejectedValue(new Error("down"));
    expect((await loadGameScopeInit()).disciplines).toBeNull();
  });
});

describe("resolveServerPageGame", () => {
  it("resolves with the client's resolver and reads a community's own games when the page names one", async () => {
    const page = await resolveServerPageGame("multi", ["overwatch", "lol"]);
    expect(page.init.axis).toBe("all");
    expect(page.resolution?.game).toEqual({ kind: "game", code: "overwatch", source: "url" });

    const community = await resolveServerPageGame("multi", undefined, 5);
    expect(community.init.axis).toBe(5);
    expect(mocks.list).toHaveBeenLastCalledWith(5);
    // LoL is off in that community: one game, read by default; the saved LoL is not written away.
    expect(community.resolution?.game).toEqual({ kind: "game", code: "overwatch", source: "default" });
    expect(community.init.stored).toBe("lol");
  });

  it("keeps a tenant host's own workspace and resolves nothing when the games could not be read", async () => {
    mocks.scope.mockResolvedValue({ stored: "all", lastGame: null, axis: 9, hostLockedWorkspaceId: 9 });
    mocks.list.mockRejectedValue(new Error("down"));

    const page = await resolveServerPageGame("single", undefined, 5);
    expect(page.init.axis).toBe(9);
    expect(mocks.list).not.toHaveBeenCalledWith(5);
    expect(page.resolution).toBeNull();
  });
});
