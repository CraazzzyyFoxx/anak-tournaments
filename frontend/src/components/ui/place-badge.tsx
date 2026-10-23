import { cn } from "@/lib/utils";

const SIZE_CLASS = {
  /** Inline chip: table cells, leaderboards. */
  default: "h-5 min-w-5 px-1.5 text-label",
  /** Squares: a profile's tournament list (`md`), its dossier (`lg`/`sm`). */
  sm: "size-7 font-display text-caption",
  md: "size-9 font-display text-ui",
  lg: "size-11 font-display text-title"
} as const;

/**
 * Placement medal. One implementation, driven by the `--aqt-medal-*` tokens.
 *
 * The gold/silver/bronze hex triple used to be written out by hand in the home
 * dashboard, the statistics leaderboards and the OWAL standings — three copies
 * that no workspace theme could reach. A missing placement (`null`, or a
 * non-positive one) draws "—" on the neutral medal.
 */
export function PlaceBadge({
  place,
  size = "default",
  className
}: Readonly<{
  place: number | null;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
}>) {
  const tier = place === 1 ? "gold" : place === 2 ? "silver" : place === 3 ? "bronze" : "default";

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[6px] font-bold leading-none tabular-nums",
        SIZE_CLASS[size],
        className
      )}
      style={{
        background: `var(--aqt-medal-${tier})`,
        color: `var(--aqt-medal-${tier}-fg)`
      }}
    >
      {place != null && place > 0 ? place : "—"}
    </span>
  );
}
