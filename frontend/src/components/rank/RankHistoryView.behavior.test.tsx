// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";

import RankHistoryView from "./RankHistoryView";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getUserCurrentRanks = vi.fn();
const getUserRankHistory = vi.fn();
vi.mock("@/services/rank.service", () => ({
  default: {
    getUserCurrentRanks: (...args: unknown[]) => getUserCurrentRanks(...args),
    getUserRankHistory: (...args: unknown[]) => getUserRankHistory(...args)
  }
}));
vi.mock("@/services/discipline.service", () => ({
  default: {
    metadata: async () => ({
      roles: [],
      native_ladder: [
        { number: 1, slug: "diamond-1", name: "Diamond I", rank_min: 2700, rank_max: 2799, icon_url: "/d.png" }
      ]
    })
  }
}));

const at = "2026-10-21T00:00:00Z";
const unranked = { rank_value: null, division: null, tier: null, is_ranked: false, season: null, captured_at: at };

describe("RankHistoryView", () => {
  it("shows a tile per queue: the ranked one's ladder name, LP and record, the other unranked", async () => {
    getUserCurrentRanks.mockResolvedValue({
      user_id: 7,
      generated_at: at,
      ranks: [
        { social_account_id: 1, handle: "A#EUW", role: null, platform: null, queue: "solo", rank_value: 2775,
          division: "DIAMOND", tier: 1, is_ranked: true, season: null, lp: 75, wins: 120, losses: 98, captured_at: at },
        { social_account_id: 1, handle: "A#EUW", role: null, platform: null, queue: "flex", ...unranked }
      ]
    });
    getUserRankHistory.mockResolvedValue({ user_id: 7, series: [], generated_at: at });
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <NextIntlClientProvider locale="en" messages={en}>
            <RankHistoryView userId={7} axis="all" discipline="lol" />
          </NextIntlClientProvider>
        </QueryClientProvider>
      );
    });
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
    const tiles = [...container.querySelectorAll("dl > *")].map((tile) => tile.textContent);
    expect(tiles).toEqual(["Solo/DuoDiamond I75 LP · 120 W / 98 L", "FlexUnranked"]);
    expect(getUserCurrentRanks).toHaveBeenCalledWith(7, "lol");
    expect(getUserRankHistory.mock.calls[0][1]).toMatchObject({ discipline: "lol", granularity: "daily" });
    await act(async () => root.unmount());
    container.remove();
  });
});
