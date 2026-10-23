import { describe, expect, it, vi } from "vitest";

import AchievementConditionsCard from "@/app/(site)/achievements/[id]/components/AchievementConditionsCard";
import { EntityWorkspace } from "@/components/workspace/EntityWorkspace";

import AchievementPage from "./page";

const host = vi.hoisted(() => ({ resolveStatsScope: vi.fn(), resolveServerDisciplineScope: vi.fn() }));
vi.mock("@/lib/site/tenant-host", () => host);
vi.mock("@/services/achievements.service", () => ({
  default: { getOne: vi.fn(async (id: number) => ({ id, discipline: "overwatch", count: 0, rarity: 0 })) }
}));
// The page's children are client components; only the props it hands them are under test.
vi.mock("@/app/(site)/achievements/[id]/components/AchievementConditionsCard", () => ({ default: () => null }));
vi.mock("@/app/(site)/achievements/[id]/components/AchievementUsers", () => ({ default: () => null }));
vi.mock("@/app/(site)/achievements/[id]/components/AchievementDetailHeader", () => ({ default: () => null }));

describe("achievement detail page", () => {
  it("names condition roles on the tenant host's own workspace axis, never `all`", async () => {
    host.resolveStatsScope.mockResolvedValue("all");
    host.resolveServerDisciplineScope.mockResolvedValue({ axis: 9, hostLockedWorkspaceId: 9, stored: "all", lastGame: null });

    const page = await AchievementPage({ params: Promise.resolve({ id: "3" }) });
    const card = (page.props.children as { type: unknown; props: { axis: unknown } }[]).find(
      (child) => child.type === AchievementConditionsCard
    );

    expect(card?.props.axis).toBe(9);
  });

  it("locks the scope pill to the achievement's own game", async () => {
    host.resolveStatsScope.mockResolvedValue("all");
    host.resolveServerDisciplineScope.mockResolvedValue({ axis: "all", hostLockedWorkspaceId: null, stored: "all", lastGame: null });

    const page = await AchievementPage({ params: Promise.resolve({ id: "3" }) });
    const owner = (page.props.children as { type: unknown; props: { discipline?: unknown } }[]).find(
      (child) => child.type === EntityWorkspace
    );

    expect(owner?.props.discipline).toBe("overwatch");
  });
});
