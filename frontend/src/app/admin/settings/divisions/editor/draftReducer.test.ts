// A division has two coordinates — its range on the workspace's rank scale and
// the native ranks that land in it — and the editor's safety argument is that each
// scale keeps its invariant by construction:
//  - ladder: the bands partition every native rank and every floor is the ladder's;
//  - custom: floors strictly descend and native runs stay ordered and disjoint.
// Both are re-asserted after EVERY action of a long mixed sequence, instead of
// testing each action alone and hoping they compose.
//
// The second claim is the bridge to stored tiers: a version has to come back
// bit-identical, and a grid on its own scale ("New Era x5", twenty divisions of
// 100) must open as itself. Reading it through the native ladder is what used to
// drop four divisions and rewrite every range on save.
//
// A discipline without a native ladder runs the same reducer with `ladder === null`:
// plain custom grids, no native runs, nothing invented.
import { describe, expect, it } from "vitest";

import type { DivisionTier } from "@/types/workspace.types";
import {
  bandsCoverLadder as coversLadder,
  bandsFromTiers as tiersToBands,
  bandsMissingCrest,
  bandVerdict,
  createLadder,
  describeEdits,
  diffBands,
  draftReducer,
  floorError,
  floorsDescend,
  initDraftState as initState,
  ladderOwners as ownersOf,
  scaleOf as scaleOfTiers,
  standardTiers,
  tiersFromBands as bandsToTiers,
  type Action,
  type Band,
  type DraftState
} from "./draftReducer";
import { TEST_LADDER, TEST_LADDER_TIERS } from "./__fixtures__/test-ladder";

const LADDER = TEST_LADDER.ranks;
const RANK_COUNT = TEST_LADDER.count;
const LAST = RANK_COUNT - 1;
const bandsCoverLadder = (bands: Band[]) => coversLadder(TEST_LADDER, bands);
const bandsFromTiers = (tiers: DivisionTier[]) => tiersToBands(TEST_LADDER, tiers);
const initDraftState = (bands: Band[], scale: "ladder" | "custom", base: Band[]) =>
  initState(TEST_LADDER, bands, scale, base);
const ladderOwners = (bands: Band[]) => ownersOf(TEST_LADDER, bands);
const scaleOf = (tiers: DivisionTier[]) => scaleOfTiers(TEST_LADDER, tiers);
const tiersFromBands = (bands: Band[]) => bandsToTiers(TEST_LADDER, bands);

function ladderBand(slug: string, name: string, from: number, to: number): Band {
  return {
    slug,
    name,
    number: 0,
    icon_url: null,
    rankMin: LADDER[to].rank_min,
    rankMax: null,
    native: { from, to }
  };
}

/** Three ladder bands, so `merge up`, `merge down` and both boundary directions all exist. */
function threeBandDraft(): DraftState {
  const bands = [
    ladderBand("champion", "Champion", 0, 2),
    ladderBand("elite", "Elite", 3, 20),
    ladderBand("open", "Open", 21, LAST)
  ];
  return initDraftState(bands, "ladder", initDraftState(bands, "ladder", []).bands);
}

/** "New Era x5" as the API returns it: twenty divisions of 100 on 100 … 2099, no OW links. */
const NEW_ERA: DivisionTier[] = Array.from({ length: 20 }, (_, index) => {
  const number = index + 1;
  const rankMin = 2100 - 100 * number;
  return {
    id: 700 + number,
    slug: `division-${number}`,
    number,
    name: `Division ${number}`,
    rank_min: rankMin,
    rank_max: number === 1 ? null : rankMin + 99,
    sort_order: index,
    icon_url: `https://cdn/division-${number}.png`
  };
});

function newEraDraft(): DraftState {
  const bands = bandsFromTiers(NEW_ERA);
  return initDraftState(bands, scaleOf(NEW_ERA), bands);
}

function expectDerived(bands: Band[], why: string) {
  expect(
    bands.map((band) => band.number),
    why
  ).toEqual(bands.map((_, index) => index + 1));
  expect(
    bands.map((band) => band.rankMax),
    why
  ).toEqual(bands.map((_, index) => (index === 0 ? null : bands[index - 1].rankMin - 1)));
}

function expectLadderInvariant(bands: Band[], why: string) {
  expect(bandsCoverLadder(bands), why).toBe(true);
  for (const band of bands) {
    if (band.native!.to !== LAST) expect(band.rankMin, why).toBe(LADDER[band.native!.to].rank_min);
  }
  expectDerived(bands, why);
}

function expectCustomInvariant(bands: Band[], why: string) {
  expect(floorsDescend(bands), why).toBe(true);
  const owners = ladderOwners(bands);
  // Walking down the ladder never climbs back to a higher division…
  const linked = owners.filter((owner): owner is number => owner !== null);
  expect(linked, why).toEqual([...linked].sort((left, right) => left - right));
  // …and no run was overwritten by a neighbour's, i.e. no two runs overlap.
  bands.forEach((band, index) => {
    if (!band.native) return;
    for (let rank = band.native.from; rank <= band.native.to; rank += 1) {
      expect(owners[rank], why).toBe(index);
    }
  });
  expectDerived(bands, why);
}

function apply(state: DraftState, actions: Action[]): DraftState {
  return actions.reduce((current, action) => {
    const next = draftReducer(current, action);
    const why = `after ${JSON.stringify(action)}`;
    if (next.scale === "ladder") expectLadderInvariant(next.bands, why);
    else expectCustomInvariant(next.bands, why);
    return next;
  }, state);
}

describe("ladder scale", () => {
  it("keeps the ladder partitioned through every kind of action", () => {
    const final = apply(threeBandDraft(), [
      { type: "splitAt", rank: 10 },
      { type: "splitAt", rank: 30 },
      { type: "split", bandIndex: 4 },
      { type: "nudge", rank: 10, delta: -1 },
      { type: "nudge", rank: 9, delta: 1 },
      { type: "nudge", rank: 21, delta: 1 },
      { type: "rename", bandIndex: 2, name: "Contender" },
      { type: "setIcon", bandIndex: 2, iconUrl: "https://cdn/contender.png" },
      { type: "merge", bandIndex: 2, into: "up" },
      { type: "merge", bandIndex: 1, into: "down" },
      { type: "undo" },
      { type: "undo" }
    ]);

    expect(final.bands.length).toBeGreaterThan(1);
  });

  it("never lets a nudge empty a band, and a one-rank band can always join", () => {
    // The reported dead end: 45 one-rank divisions, where no boundary can move.
    const atomic = initDraftState(
      LADDER.map((tier, index) => ladderBand(tier.slug!, tier.name, index, index)),
      "ladder",
      []
    );
    for (const rank of [1, 20, LAST]) {
      expect(draftReducer(atomic, { type: "nudge", rank, delta: -1 })).toBe(atomic);
      expect(draftReducer(atomic, { type: "nudge", rank, delta: 1 })).toBe(atomic);
    }

    // Joining frees the boundary: Champion 1–2 can now hand a rank down.
    const joined = apply(atomic, [{ type: "merge", bandIndex: 1, into: "up" }]);
    expect(joined.bands[0]).toMatchObject({ slug: "champion-1", native: { from: 0, to: 1 } });
    const moved = apply(joined, [{ type: "nudge", rank: 2, delta: -1 }]);
    expect(moved.bands[0].native).toEqual({ from: 0, to: 0 });
    expect(moved.bands[1].native).toEqual({ from: 1, to: 2 });
  });

  it("refuses to split at a rank that is already a boundary, and outside the ladder", () => {
    const state = threeBandDraft();
    for (const rank of [0, 3, 21, -1, RANK_COUNT]) {
      expect(draftReducer(state, { type: "splitAt", rank })).toBe(state);
    }
  });

  it("splits so the upper half keeps the division and the lower half is the new one", () => {
    const state = apply(threeBandDraft(), [{ type: "splitAt", rank: 10 }]);

    expect(state.bands.map((band) => band.native)).toEqual([
      { from: 0, to: 2 },
      { from: 3, to: 9 },
      { from: 10, to: 20 },
      { from: 21, to: LAST }
    ]);
    expect(state.bands[1]).toMatchObject({ slug: "elite", name: "Elite" });
    expect(state.bands[2]).toMatchObject({
      name: "Untitled division",
      icon_url: null,
      slug: LADDER[10].slug
    });
    expect(state.bands[2].id).toBeUndefined();
  });

  it("merges a band into a neighbour that keeps its own identity", () => {
    const up = apply(threeBandDraft(), [{ type: "merge", bandIndex: 1, into: "up" }]);
    expect(up.bands[0]).toMatchObject({ slug: "champion", native: { from: 0, to: 20 } });

    const down = apply(threeBandDraft(), [{ type: "merge", bandIndex: 1, into: "down" }]);
    expect(down.bands[1]).toMatchObject({ slug: "open", native: { from: 3, to: LAST } });

    const three = threeBandDraft();
    expect(draftReducer(three, { type: "merge", bandIndex: 0, into: "up" })).toBe(three);
    expect(draftReducer(three, { type: "merge", bandIndex: 2, into: "down" })).toBe(three);
  });

  it("keeps a bottom floor below the ladder through edits", () => {
    // `0 … 3999` is a ladder band: every rank under Bronze 5 lands at the bottom anyway.
    const tiers: DivisionTier[] = [
      { id: 1, slug: "top", number: 1, name: "Top", rank_min: 4000, rank_max: null, icon_url: "/a.png" },
      { id: 2, slug: "open", number: 2, name: "Open", rank_min: 0, rank_max: 3999, icon_url: "/b.png" }
    ];
    expect(scaleOf(tiers)).toBe("ladder");

    const split = apply(initDraftState(bandsFromTiers(tiers), "ladder", []), [
      { type: "splitAt", rank: 30 }
    ]);
    expect(split.bands.at(-1)!.rankMin).toBe(0);
    expect(split.bands[1].rankMin).toBe(LADDER[29].rank_min);
  });

  it("refuses the custom-scale edits that would break the partition", () => {
    const state = threeBandDraft();
    expect(draftReducer(state, { type: "setFloor", bandIndex: 1, rankMin: 3000 })).toBe(state);
    expect(draftReducer(state, { type: "link", bandIndex: 1, from: 0, to: 5 })).toBe(state);
    expect(draftReducer(state, { type: "unlink", bandIndex: 1 })).toBe(state);
  });

  it("ignores a rename that is empty or unchanged", () => {
    const state = threeBandDraft();
    expect(draftReducer(state, { type: "rename", bandIndex: 0, name: "   " })).toBe(state);
    expect(draftReducer(state, { type: "rename", bandIndex: 0, name: "Champion" })).toBe(state);
    expect(apply(state, [{ type: "rename", bandIndex: 0, name: "  Apex  " }]).bands[0].name).toBe(
      "Apex"
    );
  });

  it("undo walks the whole stack back, scale included, and then stops", () => {
    const start = threeBandDraft();
    const edited = apply(start, [
      { type: "splitAt", rank: 10 },
      { type: "setScale", scale: "custom" },
      { type: "setFloor", bandIndex: 1, rankMin: 3500 }
    ]);
    expect(edited.scale).toBe("custom");

    const back = apply(edited, [{ type: "undo" }, { type: "undo" }, { type: "undo" }]);
    expect(back.bands).toEqual(start.bands);
    expect(back.scale).toBe("ladder");
    expect(draftReducer(back, { type: "undo" })).toBe(back);
  });
});

describe("custom scale", () => {
  it("keeps floors descending and OW runs ordered through every kind of action", () => {
    const final = apply(newEraDraft(), [
      { type: "link", bandIndex: 0, from: 0, to: 2 },
      { type: "link", bandIndex: 1, from: 3, to: 5 },
      { type: "nudge", rank: 3, delta: 1 },
      { type: "nudge", rank: 4, delta: -1 },
      { type: "nudge", rank: 6, delta: 1 },
      { type: "nudge", rank: 7, delta: -1 },
      { type: "link", bandIndex: 19, from: 40, to: LAST },
      { type: "setFloor", bandIndex: 4, rankMin: 1650 },
      { type: "split", bandIndex: 0 },
      { type: "split", bandIndex: 6 },
      { type: "unlink", bandIndex: 2 },
      { type: "merge", bandIndex: 18, into: "down" },
      { type: "merge", bandIndex: 3, into: "up" },
      { type: "undo" }
    ]);

    expect(final.scale).toBe("custom");
  });

  it("refuses a floor that would overlap a neighbour, and says why", () => {
    const state = newEraDraft();
    // Division 5 sits between Division 4 (1700) and Division 6 (1500).
    expect(floorError(state.bands, 4, "1650")).toBeNull();
    expect(floorError(state.bands, 4, "1700")).toEqual({ code: "mustBeBelow", name: "Division 4", rankMin: 1700 });
    expect(floorError(state.bands, 4, "1500")).toEqual({ code: "mustBeAbove", name: "Division 6", rankMin: 1500 });
    expect(floorError(state.bands, 4, "16.5")).toEqual({ code: "notInteger" });
    expect(draftReducer(state, { type: "setFloor", bandIndex: 4, rankMin: 1700 })).toBe(state);

    const moved = apply(state, [{ type: "setFloor", bandIndex: 4, rankMin: 1650 }]);
    expect(moved.bands[4]).toMatchObject({ rankMin: 1650, rankMax: 1699 });
    expect(moved.bands[5].rankMax).toBe(1649);
  });

  it("links a run by taking ranks from the neighbours, which may leave some unlinked", () => {
    const state = apply(newEraDraft(), [
      { type: "link", bandIndex: 0, from: 2, to: 0 },
      { type: "link", bandIndex: 1, from: 3, to: 5 }
    ]);

    expect(state.bands[0].native).toEqual({ from: 0, to: 2 });
    expect(state.bands[1].native).toEqual({ from: 3, to: 5 });
    // Division 1 used to hold Champion 1 … Platinum 5 and Division 2 Gold 1:
    // what the links released lands nowhere until it is linked again.
    const owners = ladderOwners(state.bands);
    expect(owners.slice(6, 31).every((owner) => owner === null)).toBe(true);
    expect(owners[31]).toBe(2);
  });

  it("lets a boundary move unlink a division's last rank, and fill a gap", () => {
    // Division 16 holds only Bronze 5; handing it up leaves Division 16 unlinked.
    const state = apply(newEraDraft(), [{ type: "nudge", rank: LAST, delta: 1 }]);
    expect(state.bands[15].native).toBeNull();
    expect(state.bands[14].native).toEqual({ from: LAST - 1, to: LAST });

    const gap = apply(newEraDraft(), [
      { type: "link", bandIndex: 1, from: 3, to: 5 },
      { type: "nudge", rank: 6, delta: 1 }
    ]);
    expect(gap.bands[1].native).toEqual({ from: 3, to: 6 });
  });

  it("halves a native range, the open-ended top by one width of the division below", () => {
    const state = apply(newEraDraft(), [
      { type: "split", bandIndex: 4 },
      { type: "split", bandIndex: 0 }
    ]);

    // Division 5 (1600–1699, one OW rank): the new lower half has no rank to share.
    expect(state.bands[5]).toMatchObject({ name: "Division 5", rankMin: 1650, rankMax: 1699 });
    expect(state.bands[6]).toMatchObject({
      name: "Untitled division",
      slug: "division-1600",
      rankMin: 1600,
      rankMax: 1649,
      native: null
    });
    // Division 1 (2000+, thirty OW ranks) gives 2000–2099 and the lower fifteen ranks away.
    expect(state.bands[0]).toMatchObject({ rankMin: 2100, rankMax: null, native: { from: 0, to: 14 } });
    expect(state.bands[1]).toMatchObject({ rankMin: 2000, rankMax: 2099, native: { from: 15, to: 29 } });
  });

  it("merges into a neighbour that takes the lower floor and both runs", () => {
    const state = apply(newEraDraft(), [{ type: "merge", bandIndex: 16, into: "up" }]);
    expect(state.bands[15]).toMatchObject({
      slug: "division-16",
      rankMin: 400,
      rankMax: 599,
      native: { from: LAST, to: LAST }
    });
    expect(state.bands[16].rankMax).toBe(399);
  });

  it("follows the ladder only once every rank and division is linked, then rewrites floors", () => {
    const newEra = newEraDraft();
    expect(newEra.scale).toBe("custom");
    expect(draftReducer(newEra, { type: "setScale", scale: "ladder" })).toBe(newEra);

    const custom = apply(threeBandDraft(), [
      { type: "setScale", scale: "custom" },
      { type: "setFloor", bandIndex: 1, rankMin: 3000 }
    ]);
    expect(custom.bands[1].rankMin).toBe(3000);
    const ladder = apply(custom, [{ type: "setScale", scale: "ladder" }]);
    expect(ladder.bands[1].rankMin).toBe(LADDER[20].rank_min);
  });
});

describe("tiers <-> bands", () => {
  it("re-derives the reference ladder tier for tier, OW ranks included", () => {
    const bands = bandsFromTiers(TEST_LADDER_TIERS as DivisionTier[]);
    expect(scaleOf(TEST_LADDER_TIERS as DivisionTier[])).toBe("ladder");
    expect(bandsCoverLadder(bands)).toBe(true);

    const tiers = tiersFromBands(bands);
    expect(tiers.map((tier) => tier.slug)).toEqual(LADDER.map((tier) => tier.slug));
    expect(tiers.map((tier) => tier.rank_min)).toEqual(LADDER.map((tier) => tier.rank_min));
    expect(tiers.map((tier) => tier.rank_max)).toEqual(LADDER.map((tier) => tier.rank_max));
    // A ladder rank's `rank_min` IS its OW rank value, so a one-rank band pins both
    // OW endpoints to it — a `null` endpoint would make the division unreachable.
    expect(tiers.every((tier) => tier.native_rank_min === tier.rank_min)).toBe(true);
    expect(tiers.every((tier) => tier.native_rank_max === tier.rank_min)).toBe(true);
  });

  it("opens a grid on its own scale as itself, with the backend's OW fallback drawn", () => {
    expect(scaleOf(NEW_ERA)).toBe("custom");
    const bands = bandsFromTiers(NEW_ERA);

    expect(bands.map((band) => band.id)).toEqual(NEW_ERA.map((tier) => tier.id));
    // No stored link: an OW rank resolves by rank range, bottom division as fallback.
    expect(bands[0].native).toEqual({ from: 0, to: 29 });
    expect(bands[1].native).toEqual({ from: 30, to: 30 });
    expect(bands[15].native).toEqual({ from: LAST, to: LAST });
    expect(bands.slice(16).every((band) => band.native === null)).toBe(true);

    const tiers = tiersFromBands(bands);
    expect(tiers.map((tier) => [tier.rank_min, tier.rank_max])).toEqual(
      NEW_ERA.map((tier) => [tier.rank_min, tier.rank_max])
    );
    expect(tiers.map((tier) => tier.icon_url)).toEqual(NEW_ERA.map((tier) => tier.icon_url));
  });

  it("round-trips explicit OW links bit-identically", () => {
    const stored: DivisionTier[] = [
      { id: 1, slug: "d1", number: 1, name: "Division 1", rank_min: 2000, rank_max: null, icon_url: "/1.png", native_rank_min: 4700, native_rank_max: 4900 },
      { id: 2, slug: "d2", number: 2, name: "Division 2", rank_min: 1900, rank_max: 1999, icon_url: "/2.png", native_rank_min: 4000, native_rank_max: 4600 },
      { id: 3, slug: "d3", number: 3, name: "Division 3", rank_min: 0, rank_max: 1899, icon_url: "/3.png", native_rank_min: 500, native_rank_max: 3900 }
    ];
    expect(scaleOf(stored)).toBe("custom");

    const tiers = tiersFromBands(bandsFromTiers(stored));
    for (const key of ["id", "slug", "rank_min", "rank_max", "icon_url", "native_rank_min", "native_rank_max"] as const) {
      expect(tiers.map((tier) => tier[key])).toEqual(stored.map((tier) => tier[key]));
    }
  });

  it("reads inverted and overlapping OW pairs the way the backend resolves them", () => {
    // Mirrors backend `_grid_with_inverted_top`: pairs entered high → low, sharing Champion 3.
    const stored: DivisionTier[] = [
      { id: 1, number: 1, name: "Division 1", rank_min: 2000, rank_max: 2099, icon_url: "/1.png", native_rank_min: 4900, native_rank_max: 4700 },
      { id: 2, number: 2, name: "Division 2", rank_min: 1900, rank_max: 1999, icon_url: "/2.png", native_rank_min: 4700, native_rank_max: 4500 },
      { id: 14, number: 14, name: "Division 14", rank_min: 700, rank_max: 799, icon_url: "/14.png", native_rank_min: 3200, native_rank_max: 3300 }
    ];
    const bands = bandsFromTiers(stored);

    // First match wins, so Champion 3 stays in Division 1.
    expect(bands.map((band) => band.native)).toEqual([
      { from: 0, to: 2 },
      { from: 3, to: 4 },
      { from: 16, to: 17 }
    ]);
    expect(ladderOwners(bands).filter((owner) => owner === null)).toHaveLength(RANK_COUNT - 7);
  });

  it("opens an empty version as one editable division instead of nothing", () => {
    expect(bandsFromTiers([])).toEqual([
      {
        slug: "division-1",
        name: "Division 1",
        number: 1,
        icon_url: null,
        rankMin: LADDER[LAST].rank_min,
        rankMax: null,
        native: { from: 0, to: LAST }
      }
    ]);
  });
});

describe("diff against the parent version", () => {
  it("labels each band new, range moved, relinked or renamed — range before link before name", () => {
    const ladder = threeBandDraft();
    const state = apply(ladder, [
      { type: "rename", bandIndex: 0, name: "Apex" },
      { type: "splitAt", rank: 10 },
      { type: "nudge", rank: 21, delta: -1 }
    ]);
    expect(bandVerdict(ladder.base, state.bands[0])).toBe("renamed");
    expect(bandVerdict(ladder.base, state.bands[1])).toBe("range moved");
    expect(bandVerdict(ladder.base, state.bands[2])).toBe("new");
    expect(bandVerdict(ladder.base, state.bands[3])).toBe("range moved");

    const newEra = newEraDraft();
    const linked = apply(newEra, [{ type: "link", bandIndex: 1, from: 3, to: 5 }]);
    expect(bandVerdict(newEra.base, linked.bands[1])).toBe("relinked");
    expect(bandVerdict(newEra.base, linked.bands[2])).toBeNull();

    const diff = diffBands(ladder.base, state.bands);
    expect(diff.added.map((band) => band.name)).toEqual(["Untitled division"]);
    expect(diff.renamed.map((entry) => entry.after.name)).toEqual(["Apex"]);
  });

  it("reports a merged-away band as removed", () => {
    const state = threeBandDraft();
    const merged = apply(state, [{ type: "merge", bandIndex: 1, into: "up" }]);
    expect(diffBands(state.base, merged.bands).removed.map((band) => band.slug)).toEqual([
      "elite"
    ]);
  });
});

describe("edit log", () => {
  it("reads every kind of edit back as a sentence", () => {
    const ladder = apply(threeBandDraft(), [
      { type: "rename", bandIndex: 0, name: "Apex" },
      { type: "splitAt", rank: 10 },
      { type: "nudge", rank: 10, delta: -1 },
      { type: "merge", bandIndex: 2, into: "up" },
      { type: "setIcon", bandIndex: 1, iconUrl: "https://cdn/elite.png" },
      { type: "setScale", scale: "custom" }
    ]);
    expect(describeEdits(ladder)).toEqual([
      { key: "edit.renamed", values: { before: "Champion", after: "Apex" } },
      { key: "edit.splitAt", values: { name: "Elite", rank: LADDER[10].name } },
      { key: "edit.moved", values: { rank: LADDER[9].name, from: "Elite", to: "Untitled division" } },
      { key: "edit.merged", values: { gone: "Untitled division", survivor: "Elite" } },
      { key: "edit.crest", values: { name: "Elite" } },
      { key: "edit.customScale" }
    ]);

    const custom = apply(newEraDraft(), [
      { type: "setFloor", bandIndex: 4, rankMin: 1650 },
      { type: "link", bandIndex: 0, from: 0, to: 2 },
      { type: "unlink", bandIndex: 2 },
      { type: "split", bandIndex: 5 }
    ]);
    expect(describeEdits(custom)).toEqual([
      { key: "edit.floor", values: { name: "Division 5", rank: 1650 } },
      { key: "edit.linked", values: { range: `${LADDER[0].name} – ${LADDER[2].name}`, name: "Division 1" } },
      { key: "edit.unlinked", values: { name: "Division 3" } },
      { key: "edit.split", values: { name: "Division 6", range: "1500–1574" } }
    ]);
  });
});

describe("a discipline without a native ladder", () => {
  const stored: DivisionTier[] = [
    { id: 1, slug: "gold", number: 1, name: "Gold", rank_min: 1000, rank_max: null, icon_url: "/g.png" },
    { id: 2, slug: "iron", number: 2, name: "Iron", rank_min: 0, rank_max: 999, icon_url: "" }
  ];

  it("opens plain custom bands: no native run is invented and no scale but custom exists", () => {
    const bands = tiersToBands(null, stored);
    expect(bands.map((band) => band.native)).toEqual([null, null]);
    expect(scaleOfTiers(null, stored)).toBe("custom");
    expect(tiersToBands(null, [])[0]).toMatchObject({ rankMin: 0, native: null });
  });

  it("rejects every native action and the ladder scale, keeping floor/rename/split edits", () => {
    const state = initState(null, tiersToBands(null, stored), "custom", []);
    for (const action of [
      { type: "link", bandIndex: 0, from: 0, to: 1 },
      { type: "nudge", rank: 1, delta: 1 },
      { type: "splitAt", rank: 1 },
      { type: "setScale", scale: "ladder" }
    ] satisfies Action[]) {
      expect(draftReducer(state, action)).toBe(state);
    }
    const edited = draftReducer(state, { type: "split", bandIndex: 1 });
    expect(edited.bands).toHaveLength(3);
    expect(edited.bands.every((band) => band.native === null)).toBe(true);
  });

  it("stores no native link and borrows no crest: a band without its own crest is reported", () => {
    const bands = tiersToBands(null, stored);
    const tiers = bandsToTiers(null, bands);
    expect(tiers.map((tier) => [tier.native_rank_min, tier.native_rank_max])).toEqual([
      [null, null],
      [null, null]
    ]);
    expect(tiers.map((tier) => tier.icon_url)).toEqual(["/g.png", ""]);
    expect(bandsMissingCrest(null, bands).map((band) => band.slug)).toEqual(["iron"]);
    // With a ladder the same band borrows the ladder's crest instead.
    expect(bandsMissingCrest(TEST_LADDER, tiersToBands(TEST_LADDER, stored))).toEqual([]);
  });
});

describe("native ladder", () => {
  it("is absent for an empty declaration and sorted top first otherwise", () => {
    expect(createLadder([])).toBeNull();
    const shuffled = [...LADDER].reverse();
    expect(createLadder(shuffled)?.ranks.map((rank) => rank.slug)).toEqual(LADDER.map((rank) => rank.slug));
  });

  it("loads the standard ladder as one division per native rank, linked to itself", () => {
    const tiers = standardTiers(TEST_LADDER);
    expect(tiers).toHaveLength(RANK_COUNT);
    expect(tiers.every((tier) => tier.id === undefined)).toBe(true);
    expect(tiers.map((tier) => tier.rank_min)).toEqual(LADDER.map((rank) => rank.rank_min));
    expect(tiers.every((tier) => tier.native_rank_min === tier.rank_min)).toBe(true);
  });
});
