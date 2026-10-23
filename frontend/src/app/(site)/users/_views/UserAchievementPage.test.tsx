import { describe, expect, it, vi } from "vitest";

import type { User } from "@/types/user.types";

import UserAchievementPage from "./UserAchievementPage";

const service = vi.hoisted(() => ({ getUserAchievements: vi.fn() }));
vi.mock("@/services/user.service", () => ({ default: service }));

const USER = { id: 7, name: "Player" } as User;

describe("profile achievements tab", () => {
  it("reads only the profile game's rules — a League profile never asks for Overwatch's", async () => {
    service.getUserAchievements.mockResolvedValue([]);

    await UserAchievementPage({ user: USER, tournaments: [], scope: "workspace", discipline: "lol" });
    await UserAchievementPage({ user: USER, tournaments: [], selectedTournamentId: "t-12", scope: "all", discipline: "lol" });

    expect(service.getUserAchievements.mock.calls).toEqual([
      [7, { tournamentId: undefined, withoutTournament: undefined, includeLocked: true, scope: "workspace", discipline: "lol" }],
      [7, { tournamentId: 12, withoutTournament: undefined, includeLocked: false, scope: "all", discipline: "lol" }]
    ]);
  });
});
