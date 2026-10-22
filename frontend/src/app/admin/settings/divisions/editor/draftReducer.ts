/**
 * The draft division grid: divisions on the workspace's own rank scale, each
 * optionally linked to a run of the discipline's native ladder (the ranks its
 * collector reports).
 *
 * Two coordinates, kept apart on purpose. `rankMin` is where a division starts
 * on the scale player ranks are stored on (`rank_min`); its ceiling is the
 * floor above minus one, so ranges are contiguous by construction. `native`
 * is the run of native ladder ranks a collected snapshot resolves into the
 * division (`native_rank_min` / `native_rank_max`). On the native scale the two
 * coincide; on a grid like "New Era x5" — twenty divisions of 100 on
 * 100 … 2099 — they do not, and forcing them together is what re-banded such
 * grids and dropped divisions.
 *
 * A discipline without a native ladder (`ladder === null`) has plain custom
 * grids: floors are typed, no division carries a `native` run, and nothing here
 * invents one.
 *
 * `scale` says which coordinate the editor drives:
 *  - `ladder` — rank ranges follow the native ladder. Divisions are bands that
 *    partition every native rank, cut and joined on the ladder; `rankMin` is
 *    derived. Only available with a ladder.
 *  - `custom` — floors are typed. Native runs are linked per division, monotone
 *    and disjoint by construction, and may leave a rank or a division unlinked,
 *    which the publish checks report instead of forbidding mid-edit.
 *
 * Indices, not ranks: a run's `from` / `to` are positions in the ladder (0 =
 * its top rank), `from <= to`. The conversion to stored native values happens
 * once, in `tiersFromBands`.
 *
 * Pure by contract: no React, no services, no clock.
 */

import type { NativeRankRange } from "@/disciplines/types";
import type { NativeTier } from "@/types/discipline.types";
import type { DivisionTier } from "@/types/workspace.types";

/** What the editor reads of one native rank: the `native_ladder` tier of the discipline's metadata. */
export type LadderRank = NativeTier;

/** A discipline's native ladder, ranks top first. Index arithmetic everywhere below depends on that order. */
export interface Ladder {
  ranks: LadderRank[];
  /** Number of native ranks. */
  count: number;
  last: number;
  /**
   * The bottom rank's floor. A bottom division may start below it: every lower
   * rank resolves into the bottom division anyway.
   */
  floor: number;
  /** Width of one rank on the native scale (top rank minus the one below it). */
  step: number;
}

/** The ladder of a discipline's metadata, or `null` when it declares none. */
export function createLadder(ranks: readonly LadderRank[]): Ladder | null {
  if (ranks.length === 0) return null;
  const sorted = [...ranks].sort((left, right) => right.rank_min - left.rank_min);
  const last = sorted.length - 1;
  return {
    ranks: sorted,
    count: sorted.length,
    last,
    floor: sorted[last].rank_min,
    step: sorted.length > 1 ? sorted[0].rank_min - sorted[1].rank_min : 1
  };
}

/** A run of consecutive native ranks, as ladder indices. */
type NativeRun = NativeRankRange;

export interface Band {
  /** Present for a tier that already exists server-side; absent for a new one. */
  id?: number;
  slug: string;
  name: string;
  /** Position from the top, `1`-based. Derived. */
  number: number;
  /** `null` means the band has no crest of its own yet. */
  icon_url: string | null;
  /** Floor on the grid's own rank scale — the stored `rank_min`. */
  rankMin: number;
  /** The floor above minus one; `null` for the open-ended top division. Derived. */
  rankMax: number | null;
  /** The native ranks that land in this division, or `null` when none does. */
  native: NativeRun | null;
}

export type Scale = "ladder" | "custom";

interface HistoryEntry {
  bands: Band[];
  scale: Scale;
  /** The edit that left this state; the UI translates it. */
  note: EditNote;
}

export type EditNote =
  | { key: "edit.renamed"; values: { before: string; after: string } }
  | { key: "edit.splitAt"; values: { name: string; rank: string } }
  | { key: "edit.split"; values: { name: string; range: string } }
  | { key: "edit.merged"; values: { gone: string; survivor: string } }
  | { key: "edit.moved"; values: { rank: string; from: string; to: string } }
  | { key: "edit.floor"; values: { name: string; rank: number } }
  | { key: "edit.linked"; values: { range: string; name: string } }
  | { key: "edit.unlinked"; values: { name: string } }
  | { key: "edit.ladderScale"; values?: undefined }
  | { key: "edit.customScale"; values?: undefined }
  | { key: "edit.crest"; values: { name: string } };

export interface DraftState {
  /** `null` for a discipline without a native ladder. */
  ladder: Ladder | null;
  bands: Band[];
  scale: Scale;
  /** One entry per edit, oldest first: the state before it. `undo` pops it. */
  history: HistoryEntry[];
  /** The parent version's bands, for the `vs base` diff. Never mutated. */
  base: Band[];
}

export type Action =
  /** Ladder scale: start a new division at this ladder rank. */
  | { type: "splitAt"; rank: number }
  /** Halve a division — its ladder band, or its range and native run. */
  | { type: "split"; bandIndex: number }
  | { type: "merge"; bandIndex: number; into: "up" | "down" }
  /** Move the boundary above ladder rank `rank` by one: `-1` up, `+1` down. */
  | { type: "nudge"; rank: number; delta: -1 | 1 }
  /** Custom scale. */
  | { type: "setFloor"; bandIndex: number; rankMin: number }
  /** Custom scale: link a run, taking its ranks from whichever division held them. */
  | { type: "link"; bandIndex: number; from: number; to: number }
  | { type: "unlink"; bandIndex: number }
  | { type: "setScale"; scale: Scale }
  | { type: "rename"; bandIndex: number; name: string }
  | { type: "setIcon"; bandIndex: number; iconUrl: string }
  | { type: "undo" };

// ---------------------------------------------------------------------------
// Reading a band
// ---------------------------------------------------------------------------

/** Full name of one ladder rank, e.g. "Grandmaster 4". */
export function rankLabel(ladder: Ladder, index: number): string {
  return ladder.ranks[index]?.name ?? `Rank ${index + 1}`;
}

/** Ladder ranks linked to the band; `0` when it has none. */
export function nativeSize(band: Band): number {
  return band.native ? band.native.to - band.native.from + 1 : 0;
}

/** "Grandmaster 4 – Master 2", one rank's name, or `null` when unlinked. */
export function nativeRangeLabel(ladder: Ladder, band: Band): string | null {
  if (!band.native) return null;
  return band.native.from === band.native.to
    ? rankLabel(ladder, band.native.from)
    : `${rankLabel(ladder, band.native.from)} – ${rankLabel(ladder, band.native.to)}`;
}

/** The native run in the width of a table cell ("GR5–MA2"); `null` when unlinked. */
export function nativeShortLabel(ladder: Ladder, band: Band): string | null {
  if (!band.native) return null;
  const short = (index: number) =>
    rankLabel(ladder, index).replace(/^(\S{2})\S*\s+(\d+)$/, (_match, stem: string, digit: string) =>
      `${stem.toUpperCase()}${digit}`
    );
  return band.native.from === band.native.to
    ? short(band.native.from)
    : `${short(band.native.from)}\u2013${short(band.native.to)}`;
}

/** "1900–1999", or "2000+" for the open-ended top. */
export function rankRangeLabel(band: Pick<Band, "rankMin" | "rankMax">): string {
  return band.rankMax === null ? `${band.rankMin}+` : `${band.rankMin}\u2013${band.rankMax}`;
}

/**
 * The crest a band shows: its own, else the one of its top native rank (or the ladder rank at its
 * floor) — read off the discipline's declared ladder. `null` without either: the caller says so.
 */
export function bandIconUrl(ladder: Ladder | null, band: Band): string | null {
  if (band.icon_url) return band.icon_url;
  if (!ladder) return null;
  const index = band.native?.from ?? ladder.ranks.findIndex((rank) => rank.rank_min <= band.rankMin);
  return ladder.ranks[index === -1 ? ladder.last : index].icon_url;
}

/** The band index each ladder rank lands in, top first; `null` where no division takes it. */
export function ladderOwners(ladder: Ladder, bands: Band[]): (number | null)[] {
  const owners: (number | null)[] = Array.from({ length: ladder.count }, () => null);
  bands.forEach((band, index) => {
    if (!band.native) return;
    for (let rank = band.native.from; rank <= band.native.to; rank += 1) owners[rank] = index;
  });
  return owners;
}

/** Ladder ranks that land in no division. */
export function unlinkedRanks(ladder: Ladder, bands: Band[]): number[] {
  return ladderOwners(ladder, bands).flatMap((owner, rank) => (owner === null ? [rank] : []));
}

/**
 * Every band owns a run and the runs partition the ladder — the `ladder` scale
 * invariant, and the precondition for switching to it.
 */
export function bandsCoverLadder(ladder: Ladder, bands: Band[]): boolean {
  if (bands.length === 0) return false;
  return bands.every((band, index) => {
    if (!band.native || band.native.from > band.native.to) return false;
    const expectedFrom = index === 0 ? 0 : (bands[index - 1].native?.to ?? -2) + 1;
    return band.native.from === expectedFrom && (index < bands.length - 1 || band.native.to === ladder.last);
  });
}

/** Floors strictly descend, so every range is non-empty and none overlap. */
export function floorsDescend(bands: Band[]): boolean {
  return bands.every(
    (band, index) =>
      Number.isInteger(band.rankMin) && (index === 0 || band.rankMin < bands[index - 1].rankMin)
  );
}

/** Why a floor was refused; the editor renders it as a message. */
export type FloorError =
  | { code: "notInteger" }
  | { code: "mustBeBelow" | "mustBeAbove"; name: string; rankMin: number };

/** Why `raw` cannot be this band's floor, or `null` when it can. The reducer applies the same rule. */
export function floorError(bands: Band[], bandIndex: number, raw: string): FloorError | null {
  if (!/^-?\d+$/.test(raw.trim())) return { code: "notInteger" };
  const value = Number(raw);
  const above = bands[bandIndex - 1];
  const below = bands[bandIndex + 1];
  if (above && value >= above.rankMin) return { code: "mustBeBelow", name: above.name, rankMin: above.rankMin };
  if (below && value <= below.rankMin) return { code: "mustBeAbove", name: below.name, rankMin: below.rankMin };
  return null;
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

/**
 * Derived fields, recomputed after every edit: position, the ceiling from the
 * floor above, and — on the ladder scale — the floor from the band's run.
 */
function finalize(ladder: Ladder | null, bands: Band[], scale: Scale): Band[] {
  const floors = bands.map((band) => {
    if (scale !== "ladder" || !ladder || !band.native) return band.rankMin;
    return band.native.to === ladder.last
      ? Math.min(band.rankMin, ladder.floor)
      : ladder.ranks[band.native.to].rank_min;
  });
  return bands.map((band, index) => {
    const number = index + 1;
    const rankMin = floors[index];
    const rankMax = index === 0 ? null : floors[index - 1] - 1;
    return band.number === number && band.rankMin === rankMin && band.rankMax === rankMax
      ? band
      : { ...band, number, rankMin, rankMax };
  });
}

/**
 * A slug for a band that has none yet, from a stem that survives renames and
 * boundary moves — the diff and the mapping rules key on the slug. Suffixed
 * only on a collision with a slug inherited from the parent version.
 */
function freshSlug(bands: Band[], stem: string): string {
  if (!bands.some((band) => band.slug === stem)) return stem;
  let suffix = 2;
  while (bands.some((band) => band.slug === `${stem}-${suffix}`)) suffix += 1;
  return `${stem}-${suffix}`;
}

function freshBand(ladder: Ladder | null, bands: Band[], rankMin: number, native: NativeRun | null): Band {
  const stem =
    ladder && native
      ? (ladder.ranks[native.from]?.slug ?? `rank-${native.from + 1}`)
      : `division-${rankMin}`;
  return {
    slug: freshSlug(bands, stem),
    name: "Untitled division",
    number: 0,
    icon_url: null,
    rankMin,
    rankMax: null,
    native
  };
}

function hull(upper: NativeRun | null, lower: NativeRun | null): NativeRun | null {
  if (!upper) return lower;
  if (!lower) return upper;
  return { from: Math.min(upper.from, lower.from), to: Math.max(upper.to, lower.to) };
}

function clip(run: NativeRun, min: number, max: number): NativeRun | null {
  const from = Math.max(run.from, min);
  const to = Math.min(run.to, max);
  if (from > to) return null;
  return from === run.from && to === run.to ? run : { from, to };
}

/**
 * Ladder scale: split the band holding `rank` so a new band starts exactly
 * there. The upper half keeps the division's identity; clicking a rank that
 * already starts a band is a no-op — honouring it would mean an empty band.
 */
function splitAt(ladder: Ladder, bands: Band[], rank: number): Band[] | null {
  if (!Number.isInteger(rank) || rank <= 0 || rank > ladder.last) return null;
  const index = bands.findIndex((band) => band.native && rank >= band.native.from && rank <= band.native.to);
  const band = bands[index];
  if (!band?.native || rank === band.native.from) return null;

  const upper: Band = { ...band, native: { from: band.native.from, to: rank - 1 } };
  // The new band inherits the floor, which only survives `finalize` at the bottom of the ladder.
  const lower = freshBand(ladder, bands, band.rankMin, { from: rank, to: band.native.to });
  return [...bands.slice(0, index), upper, lower, ...bands.slice(index + 1)];
}

/**
 * Halve a division. On the ladder scale that is a cut through the middle of its
 * band. On a custom scale the range is halved (the open-ended top gives up one
 * width of the division below it) and the new lower division takes the lower
 * half of the native run, if the run has two ranks to share.
 */
function split(ladder: Ladder | null, bands: Band[], bandIndex: number, scale: Scale): Band[] | null {
  const band = bands[bandIndex];
  if (!band) return null;
  if (scale === "ladder") {
    if (!ladder || !band.native || nativeSize(band) < 2) return null;
    return splitAt(ladder, bands, band.native.from + Math.ceil(nativeSize(band) / 2));
  }

  const below = bands[bandIndex + 1];
  const width =
    band.rankMax === null
      ? Math.max(1, below ? band.rankMin - below.rankMin : (ladder?.step ?? 1))
      : band.rankMax - band.rankMin + 1;
  if (band.rankMax !== null && width < 2) return null;
  const upperFloor = band.rankMax === null ? band.rankMin + width : band.rankMin + Math.floor(width / 2);

  let upperRun = band.native;
  let lowerRun: NativeRun | null = null;
  if (band.native && nativeSize(band) >= 2) {
    const middle = band.native.from + Math.ceil(nativeSize(band) / 2);
    upperRun = { from: band.native.from, to: middle - 1 };
    lowerRun = { from: middle, to: band.native.to };
  }

  const upper: Band = { ...band, rankMin: upperFloor, native: upperRun };
  const lower = freshBand(ladder, bands, band.rankMin, lowerRun);
  return [...bands.slice(0, bandIndex), upper, lower, ...bands.slice(bandIndex + 1)];
}

/** Fold a band into a neighbour, which inherits its range and native ranks and keeps its own identity. */
function merge(bands: Band[], bandIndex: number, into: "up" | "down"): Band[] | null {
  const band = bands[bandIndex];
  if (!band || bands.length < 2) return null;

  if (into === "up") {
    const above = bands[bandIndex - 1];
    if (!above) return null;
    const survivor: Band = { ...above, rankMin: band.rankMin, native: hull(above.native, band.native) };
    return [...bands.slice(0, bandIndex - 1), survivor, ...bands.slice(bandIndex + 1)];
  }

  const below = bands[bandIndex + 1];
  if (!below) return null;
  const survivor: Band = { ...below, native: hull(band.native, below.native) };
  return [...bands.slice(0, bandIndex), survivor, ...bands.slice(bandIndex + 2)];
}

/**
 * Move the boundary above ladder rank `rank` by one rank. `-1` hands the rank
 * above the boundary to the side below it, `+1` the other way. On the ladder
 * scale the losing band keeps at least one rank — emptying is `merge`'s job.
 * On a custom scale either side may be "no division", and a band that gives up
 * its last rank simply becomes unlinked.
 */
function nudge(ladder: Ladder, bands: Band[], rank: number, delta: -1 | 1, scale: Scale): Band[] | null {
  if (!Number.isInteger(rank) || rank <= 0 || rank > ladder.last) return null;
  const owners = ladderOwners(ladder, bands);
  const above = owners[rank - 1];
  const below = owners[rank];
  if (above === below) return null;

  const moving = delta === -1 ? rank - 1 : rank;
  const loser = delta === -1 ? above : below;
  const gainer = delta === -1 ? below : above;
  if (scale === "ladder" && (loser === null || gainer === null || nativeSize(bands[loser]) < 2)) {
    return null;
  }

  return bands.map((band, index) => {
    if (index === loser && band.native) {
      if (band.native.from === band.native.to) return { ...band, native: null };
      return {
        ...band,
        native:
          moving === band.native.from
            ? { ...band.native, from: moving + 1 }
            : { ...band.native, to: moving - 1 }
      };
    }
    if (index === gainer) {
      return { ...band, native: hull(band.native, { from: moving, to: moving }) };
    }
    return band;
  });
}

/**
 * Link a run to one division. Order is the constraint: a division above may
 * only keep ranks above the run and one below only ranks below it, so taking
 * ranks from a neighbour clips it, and may leave ranks between them unlinked.
 */
function link(ladder: Ladder, bands: Band[], bandIndex: number, from: number, to: number): Band[] | null {
  const band = bands[bandIndex];
  if (!band || !Number.isInteger(from) || !Number.isInteger(to)) return null;
  const low = Math.max(0, Math.min(from, to));
  const high = Math.min(ladder.last, Math.max(from, to));
  if (low > high || (band.native?.from === low && band.native.to === high)) return null;

  return bands.map((entry, index) => {
    if (index === bandIndex) return { ...entry, native: { from: low, to: high } };
    if (!entry.native) return entry;
    const run =
      index < bandIndex ? clip(entry.native, 0, low - 1) : clip(entry.native, high + 1, ladder.last);
    return run === entry.native ? entry : { ...entry, native: run };
  });
}

function apply(state: DraftState, action: Exclude<Action, { type: "undo" }>): Band[] | null {
  const { bands, scale, ladder } = state;
  const replace = (bandIndex: number, patch: Partial<Band>) =>
    bands.map((band, index) => (index === bandIndex ? { ...band, ...patch } : band));

  switch (action.type) {
    case "splitAt":
      return scale === "ladder" && ladder ? splitAt(ladder, bands, action.rank) : null;
    case "split":
      return split(ladder, bands, action.bandIndex, scale);
    case "merge":
      return merge(bands, action.bandIndex, action.into);
    case "nudge":
      return ladder ? nudge(ladder, bands, action.rank, action.delta, scale) : null;
    case "setFloor": {
      const band = bands[action.bandIndex];
      if (scale !== "custom" || !band || band.rankMin === action.rankMin) return null;
      if (floorError(bands, action.bandIndex, String(action.rankMin)) !== null) return null;
      return replace(action.bandIndex, { rankMin: action.rankMin });
    }
    case "link":
      return scale === "custom" && ladder ? link(ladder, bands, action.bandIndex, action.from, action.to) : null;
    case "unlink":
      return scale === "custom" && bands[action.bandIndex]?.native
        ? replace(action.bandIndex, { native: null })
        : null;
    case "setScale":
      if (action.scale === scale) return null;
      // Following the ladder derives every floor from a run, so every division needs one.
      if (action.scale === "custom") return bands;
      return ladder && bandsCoverLadder(ladder, bands) ? bands : null;
    case "rename": {
      const name = action.name.trim();
      const band = bands[action.bandIndex];
      if (!band || name === "" || name === band.name) return null;
      return replace(action.bandIndex, { name });
    }
    case "setIcon": {
      const band = bands[action.bandIndex];
      if (!band || action.iconUrl === band.icon_url) return null;
      return replace(action.bandIndex, { icon_url: action.iconUrl });
    }
  }
}

/** The edit in a sentence, from the action and the states around it. */
function describe(
  ladder: Ladder | null,
  action: Exclude<Action, { type: "undo" }>,
  before: Band[],
  after: Band[]
): EditNote {
  const label = (index: number) => (ladder ? rankLabel(ladder, index) : String(index + 1));
  switch (action.type) {
    case "splitAt":
    case "split": {
      const known = new Set(before.map((band) => band.slug));
      const added = after.find((band) => !known.has(band.slug));
      const parent = added ? after[after.indexOf(added) - 1] : undefined;
      if (!added || !parent) return { key: "edit.split", values: { name: "", range: "" } };
      return action.type === "splitAt"
        ? { key: "edit.splitAt", values: { name: parent.name, rank: label(added.native?.from ?? action.rank) } }
        : { key: "edit.split", values: { name: parent.name, range: rankRangeLabel(added) } };
    }
    case "merge": {
      const gone = before[action.bandIndex];
      const survivor = after[action.into === "up" ? action.bandIndex - 1 : action.bandIndex];
      return { key: "edit.merged", values: { gone: gone.name, survivor: survivor.name } };
    }
    case "nudge": {
      const moving = action.delta === -1 ? action.rank - 1 : action.rank;
      const from = ladder ? ladderOwners(ladder, before)[moving] : null;
      const to = ladder ? ladderOwners(ladder, after)[moving] : null;
      const name = (list: Band[], index: number | null) =>
        index === null ? "" : list[index].name;
      return { key: "edit.moved", values: { rank: label(moving), from: name(before, from), to: name(after, to) } };
    }
    case "setFloor":
      return { key: "edit.floor", values: { name: after[action.bandIndex].name, rank: action.rankMin } };
    case "link":
      return {
        key: "edit.linked",
        values: {
          range: ladder ? (nativeRangeLabel(ladder, after[action.bandIndex]) ?? "") : "",
          name: after[action.bandIndex].name
        }
      };
    case "unlink":
      return { key: "edit.unlinked", values: { name: before[action.bandIndex].name } };
    case "setScale":
      return action.scale === "ladder"
        ? { key: "edit.ladderScale" }
        : { key: "edit.customScale" };
    case "rename":
      return { key: "edit.renamed", values: { before: before[action.bandIndex].name, after: after[action.bandIndex].name } };
    case "setIcon":
      return { key: "edit.crest", values: { name: after[action.bandIndex].name } };
  }
}

export function draftReducer(state: DraftState, action: Action): DraftState {
  if (action.type === "undo") {
    const previous = state.history.at(-1);
    if (!previous) return state;
    return {
      ...state,
      bands: previous.bands,
      scale: previous.scale,
      history: state.history.slice(0, -1)
    };
  }

  const next = apply(state, action);
  // A rejected action returns the same object, so React skips the re-render.
  if (next === null) return state;
  const scale = action.type === "setScale" ? action.scale : state.scale;
  const bands = finalize(state.ladder, next, scale);
  return {
    ...state,
    bands,
    scale,
    history: [
      ...state.history,
      { bands: state.bands, scale: state.scale, note: describe(state.ladder, action, state.bands, bands) }
    ]
  };
}

export function initDraftState(ladder: Ladder | null, bands: Band[], scale: Scale, base: Band[]): DraftState {
  return { ladder, bands: finalize(ladder, bands, scale), scale, history: [], base };
}

/** The whole edit log, oldest first. */
export function describeEdits(state: DraftState): EditNote[] {
  return state.history.map((entry) => entry.note);
}

// ---------------------------------------------------------------------------
// Stored tiers <-> bands
// ---------------------------------------------------------------------------

/** The tier payload `updateDivisionGridVersion` / `createDivisionGridVersion` take. */
export interface DraftTierPayload {
  id?: number;
  slug: string;
  number: number;
  name: string;
  sort_order: number;
  rank_min: number;
  rank_max: number | null;
  icon_url: string;
  native_rank_min: number | null;
  native_rank_max: number | null;
}

/** Bands that cannot be stored yet: the server requires a crest and there is no ladder to borrow one from. */
export function bandsMissingCrest(ladder: Ladder | null, bands: Band[]): Band[] {
  return bands.filter((band) => bandIconUrl(ladder, band) === null);
}

/**
 * Bands as stored tiers. A native rank's `rank_min` IS its stored rank value, so a run is stored as its
 * floor and ceiling ranks' values; an unlinked band stores both as `null`, which the backend reads as
 * "no native rank lands here". A band with no crest and nothing to borrow one from (no ladder) is the
 * caller's to prevent — see {@link bandsMissingCrest}; it is stored with an empty `icon_url` the server refuses.
 */
export function tiersFromBands(ladder: Ladder | null, bands: Band[]): DraftTierPayload[] {
  return bands.map((band, index) => ({
    ...(band.id === undefined ? {} : { id: band.id }),
    slug: band.slug,
    number: index + 1,
    name: band.name,
    sort_order: index,
    rank_min: band.rankMin,
    rank_max: band.rankMax,
    icon_url: bandIconUrl(ladder, band) ?? "",
    native_rank_min: ladder && band.native ? ladder.ranks[band.native.to].rank_min : null,
    native_rank_max: ladder && band.native ? ladder.ranks[band.native.from].rank_min : null
  }));
}

function hasNativeLink(tier: DivisionTier): boolean {
  return tier.native_rank_min != null && tier.native_rank_max != null;
}

/** The backend's order: highest floor first, ties by position. */
function sortedTiers(tiers: DivisionTier[]): DivisionTier[] {
  return [...tiers].sort(
    (left, right) =>
      right.rank_min - left.rank_min ||
      (left.sort_order ?? left.number) - (right.sort_order ?? right.number)
  );
}

/**
 * Stored tiers as bands, resolving the ladder exactly as the backend resolves a
 * native rank: through the explicit `native_rank_*` pairs when any tier has one
 * (first match wins), else by rank range with the bottom division as the
 * fallback. A rank that would break the run order — only possible with
 * overlapping stored pairs — is left unlinked rather than guessed. Without a
 * ladder no run exists.
 */
export function bandsFromTiers(ladder: Ladder | null, tiers: DivisionTier[]): Band[] {
  if (tiers.length === 0) {
    return finalize(
      ladder,
      [
        {
          slug: "division-1",
          name: "Division 1",
          number: 1,
          icon_url: null,
          rankMin: ladder?.floor ?? 0,
          rankMax: null,
          native: ladder ? { from: 0, to: ladder.last } : null
        }
      ],
      "custom"
    );
  }

  const sorted = sortedTiers(tiers);
  const bands: Band[] = [];
  for (const tier of sorted) {
    bands.push({
      ...(tier.id === undefined ? {} : { id: tier.id }),
      slug: tier.slug || freshSlug(bands, `division-${tier.number}`),
      name: tier.name,
      number: bands.length + 1,
      icon_url: tier.icon_url || null,
      rankMin: tier.rank_min,
      rankMax: null,
      native: null
    });
  }
  if (!ladder) return finalize(ladder, bands, "custom");

  const explicit = sorted.some(hasNativeLink);
  const ownerOf = (rank: number): number | null => {
    const value = ladder.ranks[rank].rank_min;
    if (explicit) {
      const index = sorted.findIndex(
        (tier) =>
          hasNativeLink(tier) &&
          value >= Math.min(tier.native_rank_min!, tier.native_rank_max!) &&
          value <= Math.max(tier.native_rank_min!, tier.native_rank_max!)
      );
      return index === -1 ? null : index;
    }
    const index = bands.findIndex((band) => band.rankMin <= value);
    return index === -1 ? bands.length - 1 : index;
  };

  let previous: number | null = null;
  let highest = -1;
  for (let rank = 0; rank < ladder.count; rank += 1) {
    const owner = ownerOf(rank);
    if (owner === null || (owner !== previous && owner <= highest)) {
      previous = null;
      continue;
    }
    const band = bands[owner];
    band.native = band.native ? { from: band.native.from, to: rank } : { from: rank, to: rank };
    previous = owner;
    highest = owner;
  }

  return finalize(ladder, bands, "custom");
}

/**
 * `ladder` when the stored ranges are exactly bands of the native ladder and any
 * stored link is the band itself — what "Load standard ladder" writes, and
 * the one case where a single edit can drive both coordinates. Anything else
 * opens as `custom`, so the editor never rewrites a scale it did not create.
 */
export function scaleOf(ladder: Ladder | null, tiers: DivisionTier[]): Scale {
  if (!ladder) return "custom";
  const bands = bandsFromTiers(ladder, tiers);
  if (!bandsCoverLadder(ladder, bands)) return "custom";
  const sorted = sortedTiers(tiers);
  const aligned = finalize(ladder, bands, "ladder").every(
    (band, index) =>
      band.rankMin === sorted[index].rank_min && band.rankMax === sorted[index].rank_max
  );
  return aligned ? "ladder" : "custom";
}

/**
 * The whole native ladder as saveable tiers — one division per native rank on the native scale, no `id`
 * (so saving makes a new version). Same band conversion the editor uses, so it cannot disagree with a
 * hand-edited draft about `rank_min` / `native_rank_*`.
 */
export function standardTiers(ladder: Ladder): DraftTierPayload[] {
  const asTiers: DivisionTier[] = ladder.ranks.map((rank, index) => ({
    slug: rank.slug,
    number: index + 1,
    name: rank.name,
    sort_order: index,
    rank_min: rank.rank_min,
    rank_max: rank.rank_max,
    icon_url: rank.icon_url
  }));
  return tiersFromBands(ladder, bandsFromTiers(ladder, asTiers));
}

// ---------------------------------------------------------------------------
// Diff against the parent version
// ---------------------------------------------------------------------------

function sameRun(left: NativeRun | null, right: NativeRun | null): boolean {
  return left?.from === right?.from && left?.to === right?.to;
}

function rangeMoved(before: Band, after: Band): boolean {
  return before.rankMin !== after.rankMin || before.rankMax !== after.rankMax;
}

export interface BandDiff {
  added: Band[];
  /** In the parent version, gone from the draft — folded into a neighbour. */
  removed: Band[];
  /** Rank range or native link changed. */
  moved: { before: Band; after: Band }[];
  renamed: { before: Band; after: Band }[];
}

export function diffBands(base: Band[], bands: Band[]): BandDiff {
  const bySlug = new Map(base.map((band) => [band.slug, band]));
  const draftSlugs = new Set(bands.map((band) => band.slug));

  const diff: BandDiff = { added: [], removed: [], moved: [], renamed: [] };
  for (const band of bands) {
    const before = bySlug.get(band.slug);
    if (!before) {
      diff.added.push(band);
      continue;
    }
    if (rangeMoved(before, band) || !sameRun(before.native, band.native)) {
      diff.moved.push({ before, after: band });
    }
    if (before.name !== band.name) {
      diff.renamed.push({ before, after: band });
    }
  }
  diff.removed = base.filter((band) => !draftSlugs.has(band.slug));
  return diff;
}
