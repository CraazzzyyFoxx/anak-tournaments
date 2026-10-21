import { memo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { formatSeconds } from "@/lib/format";
import { getPlayerSlug } from "@/lib/player";
import { cn } from "@/lib/utils";

import { beatsShare, type RankedEntry } from "./board";
import { StatColumnDef } from "./stat-columns";
import RankBadge from "./RankBadge";

/**
 * A stat column plus its values over every ranked player (ascending), so a bar
 * reads as the share of the board a value beats. Built once per table render and
 * shared by every row, so bars down a column are comparable and `memo` below holds.
 */
export interface StatCellSpec {
  def: StatColumnDef;
  sorted: number[];
}

export const CELL = "border-b border-[color:var(--aqt-border)] px-3 py-2";
/** The rank and player columns stay put while a phone scrolls the stat columns under them. */
export const STICKY_RANK = "sticky left-0 z-[1]";
export const STICKY_PLAYER = "sticky left-[52px] z-[1] max-lg:shadow-[inset_-1px_0_0_var(--aqt-border)]";
/** Opaque, so the scrolled columns never show through the sticky ones. */
const ROW_BG = "bg-[color:var(--aqt-card)]";
const ROW_HIGHLIGHT = "bg-[color:color-mix(in_srgb,var(--aqt-teal)_8%,var(--aqt-card))]";

interface BarRowProps {
  ranked: RankedEntry;
  cells: StatCellSpec[];
  /** Index into `cells` of the column ordering the board. */
  activeIndex: number;
  isHighlighted: boolean;
  onHoverUser: (userId: number | null) => void;
}

const BarRow = ({ ranked: { entry, rank }, cells, activeIndex, isHighlighted, onHoverUser }: BarRowProps) => {
  const t = useTranslations();
  const at = entry.username.lastIndexOf("#");
  const handle = at > 0 ? entry.username.slice(0, at) : entry.username;
  const tag = at > 0 ? entry.username.slice(at) : "";
  const bg = isHighlighted ? ROW_HIGHLIGHT : ROW_BG;

  return (
    <tr onMouseEnter={() => onHoverUser(entry.user_id)} onMouseLeave={() => onHoverUser(null)}>
      <td className={cn(CELL, STICKY_RANK, bg)}>
        <RankBadge rank={rank} />
      </td>
      <td className={cn(CELL, STICKY_PLAYER, bg)}>
        <Link
          href={`/users/${getPlayerSlug(entry.username)}`}
          title={entry.team ? `${entry.username} · ${entry.team}` : entry.username}
          onFocus={() => onHoverUser(entry.user_id)}
          onBlur={() => onHoverUser(null)}
          className="flex min-w-0 items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)]"
        >
          <span className="min-w-0 truncate text-caption font-semibold text-[color:var(--aqt-fg)]">
            {handle}
            <span className="font-medium text-[color:var(--aqt-fg-faint)]">{tag}</span>
          </span>
          {/* From `sm` up: on a phone the narrow sticky column is the name's, the division waits for a wider screen. */}
          <span className="shrink-0 rounded-[5px] border border-[color:var(--aqt-border-2)] px-1.5 text-label font-semibold leading-[18px] tabular-nums text-[color:var(--aqt-fg-dim)] max-sm:hidden">
            {t("users.heroesCompare.table.division", { division: entry.div })}
          </span>
        </Link>
      </td>
      <td className={cn(CELL, "text-right leading-tight", bg)}>
        <span className="block text-caption font-semibold tabular-nums text-[color:var(--aqt-fg-muted)]">
          {entry.games_played}
        </span>
        <span className="block text-label tabular-nums text-[color:var(--aqt-fg-faint)]">
          {formatSeconds(entry.playtime_seconds)}
        </span>
      </td>
      {cells.map(({ def, sorted }, i) => {
        const value = def.getValue(entry);
        const share = beatsShare(sorted, value, def.ascending);
        const active = i === activeIndex;

        return (
          <td
            key={`${def.key}-${i}`}
            title={t("users.heroesCompare.table.beats", { value: Math.round(share * 100) })}
            className={cn(CELL, isHighlighted ? ROW_HIGHLIGHT : active && "bg-[color:var(--aqt-overlay-1)]")}
          >
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "w-[52px] shrink-0 text-right text-caption tabular-nums",
                  share < 0.25
                    ? "font-medium text-[color:var(--aqt-fg-dim)]"
                    : "font-semibold text-[color:var(--aqt-fg)]"
                )}
              >
                {def.formatValue(value)}
              </span>
              <span aria-hidden className="relative h-1 min-w-0 flex-1 rounded-full bg-[color:var(--aqt-overlay-2)]">
                <span
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-full",
                    active
                      ? "bg-[color:var(--aqt-teal)]"
                      : "bg-[color:color-mix(in_srgb,var(--aqt-fg-muted)_45%,transparent)]"
                  )}
                  style={{ width: `${share * 100}%` }}
                />
              </span>
            </div>
          </td>
        );
      })}
    </tr>
  );
};

// Memoized: hovering one player flips `isHighlighted` on only the matching
// row, so every other row skips re-render (`cells` is a memoized array from
// the parent and the remaining props are primitives / stable refs).
export default memo(BarRow);
