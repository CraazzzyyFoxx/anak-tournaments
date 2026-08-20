// Pins the one thing the "Make primary" row action can get wrong in a way
// nobody notices: sending a `sort_order` that loses the `(sort_order, id)` tie
// the backend orders by, so the button appears to do nothing. The show/hide
// answer is tested through the same function because it IS the same answer —
// the row renders the action iff a number comes back.
import { describe, expect, it } from "vitest";

import type { TournamentLink, TournamentLinkKind } from "@/types/stream.types";

import { primaryStreamLinkSortOrder } from "./tournamentLinks.helpers";

function link(
  id: number,
  sort_order: number,
  overrides: { kind?: TournamentLinkKind; is_active?: boolean } = {}
): TournamentLink {
  return {
    id,
    tournament_id: 7,
    kind: "stream",
    label: `Link ${id}`,
    url: `https://twitch.tv/channel-${id}`,
    sort_order,
    is_active: true,
    ...overrides
  };
}

describe("the sort_order the action sends", () => {
  it("goes one below a zero minimum instead of matching it", () => {
    const leader = link(1, 0);
    const target = link(2, 5);

    // `0` would tie with the leader and lose on the larger id, which is exactly
    // the silent no-op this offset exists to avoid.
    expect(primaryStreamLinkSortOrder(target, [leader, target])).toBe(-1);
  });

  it("goes one below an already negative minimum", () => {
    const leader = link(1, -3);
    const target = link(2, 0);

    expect(primaryStreamLinkSortOrder(target, [leader, target])).toBe(-4);
  });

  it("still moves a link tied with the leader, since it loses the tie on id", () => {
    const leader = link(1, 2);
    const target = link(9, 2);

    expect(primaryStreamLinkSortOrder(target, [leader, target])).toBe(1);
  });
});

describe("rows that must not offer the action", () => {
  it("hides it on the link that already leads the active stream links", () => {
    const leader = link(1, 0);
    const other = link(2, 4);

    expect(primaryStreamLinkSortOrder(leader, [leader, other])).toBeNull();
  });

  it("hides it on links that are not broadcasts", () => {
    const discord = link(1, 0, { kind: "discord" });
    const stream = link(2, 4);

    expect(primaryStreamLinkSortOrder(discord, [discord, stream])).toBeNull();
  });
});

describe("archived stream links", () => {
  it("neither offer the action nor drag the minimum down", () => {
    const archived = link(1, -10, { is_active: false });
    const leader = link(2, 0);
    const target = link(3, 6);

    expect(primaryStreamLinkSortOrder(archived, [archived, leader, target])).toBeNull();
    // -9 here would mean the archived row — invisible on the public page — had
    // been allowed to set the floor.
    expect(primaryStreamLinkSortOrder(target, [archived, leader, target])).toBe(-1);
  });
});
