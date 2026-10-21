import type { MixListFilter } from "@/services/custom-game.service";

/**
 * Every open mix of a workspace in one page: the directory's "now" block and the mix page's voice panel read the
 * same cache entry. Open mixes are few (each one has a host running it), so one page of the ceiling covers them.
 */
export const OPEN_MIXES: MixListFilter = { status: "open", limit: 100 };

/** How many lobbies one mix may run at once -- the server's own CHECK ceiling. */
export const MAX_LOBBIES = 6;

/** A lobby's glyph from its 0-based index: A..F, identical in every locale. */
export function lobbyLetter(lobbyIndex: number) {
  return String.fromCharCode(65 + lobbyIndex);
}

/**
 * The recurring chrome of the mix surface, named once.
 *
 * The mix screen, the fullscreen lobby board, the player pool and the player
 * sheet all repeat the same three shapes — a mono eyebrow, a mono metric pill
 * and a card head. Inlining them meant a density or tracking change was eight
 * edits in five files, and they had already drifted by a pixel in two places.
 */

/** Mono, wide-tracked, uppercase: the "tactical voice" label above a heading. */
export const EYEBROW_CLASS =
  "text-label uppercase tracking-label text-[color:var(--aqt-fg-faint)]";

/** Same voice one step tighter, for a caption that sits beside a label. */
export const CAPTION_CLASS = "text-xs tabular-nums text-[color:var(--aqt-fg-dim)]";

/** Section title inside a card head — display face, uppercase, short tracking. */
export const CARD_TITLE_CLASS =
  "font-display text-sm font-bold uppercase tracking-[0.04em] text-[color:var(--aqt-fg)]";

/** A read-only stat: pill, hairline border, tabular mono. Tone comes from the caller. */
export const METRIC_PILL_CLASS =
  "flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-label font-semibold tabular-nums tracking-[0.06em]";

/** Neutral metric tone — the default for a number that carries no verdict. */
export const METRIC_NEUTRAL_CLASS =
  "border-[color:var(--aqt-border-2)] bg-white/[0.025] text-[color:var(--aqt-fg-muted)]";

/**
 * Team accents. Index is the 0-based team position, matching the design's
 * teal/amber pair; a third team would wrap rather than invent a colour.
 */
export const TEAM_ACCENTS = [
  {
    bar: "bg-[color:var(--aqt-teal)]",
    crestPanel: "bg-[color:color-mix(in_srgb,var(--aqt-teal)_14%,transparent)]",
    crestBorder: "border-[color:color-mix(in_srgb,var(--aqt-teal)_28%,transparent)]",
    /** The "this team won" button: filled in the team's colour so it reads as that team's, not as a generic control. */
    win: "border-[color:color-mix(in_srgb,var(--aqt-teal)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-teal)_16%,transparent)] text-[color:var(--aqt-teal)] hover:bg-[color:color-mix(in_srgb,var(--aqt-teal)_28%,transparent)] hover:border-[color:var(--aqt-teal)]",
  },
  {
    bar: "bg-[color:var(--aqt-amber)]",
    crestPanel: "bg-[color:color-mix(in_srgb,var(--aqt-amber)_13%,transparent)]",
    crestBorder: "border-[color:color-mix(in_srgb,var(--aqt-amber)_28%,transparent)]",
    win: "border-[color:color-mix(in_srgb,var(--aqt-amber)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-amber)_16%,transparent)] text-[color:var(--aqt-amber)] hover:bg-[color:color-mix(in_srgb,var(--aqt-amber)_28%,transparent)] hover:border-[color:var(--aqt-amber)]",
  },
] as const;

export function teamAccent(teamIndex: number) {
  return TEAM_ACCENTS[teamIndex % TEAM_ACCENTS.length];
}
