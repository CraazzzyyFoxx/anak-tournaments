// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";

import RankHistory from "./RankHistory";

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
// The chart is recharts; its rows are pinned by lol-rank.test.ts.
vi.mock("./LolRankChart", () => ({ default: () => <div data-lol-chart /> }));

describe("LoL rank history", () => {
  it("shows Solo/Duo and Flex with tier, LP and record, asking for League explicitly", async () => {
    getUserCurrentRanks.mockResolvedValue({
      user_id: 7,
      generated_at: "2026-10-21T00:00:00Z",
      ranks: [
        { social_account_id: 1, handle: "A#EUW", role: null, platform: null, queue: "solo", rank_value: 2775,
          division: "DIAMOND", tier: 1, is_ranked: true, season: null, lp: 75, wins: 120, losses: 98,
          captured_at: "2026-10-21T00:00:00Z" }
      ]
    });
    getUserRankHistory.mockResolvedValue({ user_id: 7, series: [], generated_at: "2026-10-21T00:00:00Z" });
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <NextIntlClientProvider locale="en" messages={en}>
            <RankHistory userId={7} axis="all" />
          </NextIntlClientProvider>
        </QueryClientProvider>
      );
    });
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
    const text = container.textContent ?? "";
    expect(text).toContain("Solo/Duo");
    expect(text).toContain("Diamond I");
    expect(text).toContain("75 LP");
    expect(text).toContain("120 W / 98 L");
    expect(text).toContain("Flex");
    expect(text).toContain("Unranked");
    expect(getUserCurrentRanks).toHaveBeenCalledWith(7, "lol");
    expect(getUserRankHistory.mock.calls[0][1]).toMatchObject({ discipline: "lol" });
    await act(async () => root.unmount());
    container.remove();
  });
});
