import { describe, expect, it, vi } from "vitest";

import { LogStatsName } from "@/types/stats.types";

import {
  buildHeroCompareQueryOptions,
  buildOverallCompareQueryOptions,
  getCompareActivity,
  keepPreviousCompareData,
  shouldLoadHeroCatalogs
} from "./compare-query-options";

describe("compare query options", () => {
  it("forwards TanStack Query's abort signal and the browsed game to the overall request", async () => {
    const fetchCompare = vi.fn().mockResolvedValue({ metrics: [] });
    const options = buildOverallCompareQueryOptions({
      isHeroScope: false,
      subjectUserId: 42,
      discipline: "overwatch",
      baseline: "global",
      fetchCompare
    });
    const controller = new AbortController();

    await options.queryFn({ signal: controller.signal });

    expect(options.queryKey[3]).toBe("overwatch");
    expect(fetchCompare).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ discipline: "overwatch", baseline: "global", signal: controller.signal })
    );
  });

  it("forwards the abort signal and stable stat set to a character request", async () => {
    const fetchCompare = vi.fn().mockResolvedValue({ metrics: [] });
    const options = buildHeroCompareQueryOptions({
      isHeroScope: true,
      subjectUserId: 42,
      discipline: "overwatch",
      baseline: "cohort",
      stats: [LogStatsName.Eliminations, LogStatsName.Deaths],
      fetchCompare
    });
    const controller = new AbortController();

    await options.queryFn({ signal: controller.signal });

    expect(fetchCompare).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        discipline: "overwatch",
        baseline: "cohort",
        stats: [LogStatsName.Eliminations, LogStatsName.Deaths],
        signal: controller.signal
      })
    );
  });

  it("reads nothing while no game is resolved", () => {
    const options = buildOverallCompareQueryOptions({
      isHeroScope: false,
      subjectUserId: 42,
      discipline: null,
      baseline: "global",
      fetchCompare: vi.fn()
    });

    expect(options.enabled).toBe(false);
  });

  it("keeps previous compare data of the same game only while a new filter combination is fetched", () => {
    const previous = { metrics: [{ key: "maps_total" }] };
    const keep = keepPreviousCompareData<typeof previous>("overwatch");

    expect(keep(previous, { queryKey: ["user-stats", 42, "all", "overwatch", "compare", {}] })).toBe(previous);
    expect(keep(previous, { queryKey: ["user-stats", 42, "all", "lol", "compare", {}] })).toBeUndefined();
  });

  it("loads hero and map catalogs only in Hero / Map scope", () => {
    expect(shouldLoadHeroCatalogs(true)).toBe(true);
    expect(shouldLoadHeroCatalogs(false)).toBe(false);
  });

  it("distinguishes the first load from a background refresh", () => {
    expect(getCompareActivity({ isLoading: true, isFetching: true })).toEqual({
      isInitialLoading: true,
      isRefreshing: false
    });
    expect(getCompareActivity({ isLoading: false, isFetching: true })).toEqual({
      isInitialLoading: false,
      isRefreshing: true
    });
  });
});
