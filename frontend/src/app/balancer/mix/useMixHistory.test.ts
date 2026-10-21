import { describe, expect, it } from "vitest";

import type { CustomGameListItem, MixListPage } from "@/services/custom-game.service";

import { mergeHistoryPage } from "./useMixHistory";

function page(ids: number[], next: number | null): MixListPage {
  return { items: ids.map((id) => ({ id }) as CustomGameListItem), next_before_id: next };
}

const ids = (items: CustomGameListItem[]) => items.map((item) => item.id);

describe("mergeHistoryPage", () => {
  it("holds back rows below the highest point a community with more stopped at", () => {
    // Community 1 stopped at 40 and has more: anything of community 2 under 40 could have a newer row of 1 above it.
    const merged = mergeHistoryPage(
      [
        { workspaceId: 1, page: page([90, 60, 40], 40) },
        { workspaceId: 2, page: page([80, 50, 30, 20], 20) },
      ],
      []
    );

    expect(ids(merged.items)).toEqual([90, 80, 60, 50, 40]);
    expect(merged.next).toEqual({ before: 40, done: [] });
  });

  it("stops asking a community once it answered everything above the frontier", () => {
    const merged = mergeHistoryPage(
      [
        { workspaceId: 1, page: page([90, 60, 40], 40) },
        { workspaceId: 2, page: page([80, 50], null) },
        { workspaceId: 3, page: page([70, 10], null) },
      ],
      [4]
    );

    expect(ids(merged.items)).toEqual([90, 80, 70, 60, 50, 40]);
    // Community 3 still owes row 10 below the frontier, so it is asked again; 2 is finished.
    expect(merged.next).toEqual({ before: 40, done: [4, 2] });
  });

  it("shows everything and ends when no community has more", () => {
    const merged = mergeHistoryPage(
      [
        { workspaceId: 1, page: page([30, 10], null) },
        { workspaceId: 2, page: page([20], null) },
      ],
      []
    );

    expect(ids(merged.items)).toEqual([30, 20, 10]);
    expect(merged.next).toBeNull();
  });
});
