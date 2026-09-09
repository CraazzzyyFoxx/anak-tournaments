
import { cn } from "@/lib/utils";

/**
 * Placement medal. One implementation, driven by the `--aqt-medal-*` tokens.
 *
 * The gold/silver/bronze hex triple used to be written out by hand in the home
 * dashboard, the statistics leaderboards and the OWAL standings — three copies
 * that no workspace theme could reach.
 */
export function PlaceBadge({
  place,
  className
}: Readonly<{
  place: number;
  className?: string;
}>) {
  const tier = place === 1 ? "gold" : place === 2 ? "silver" : place === 3 ? "bronze" : "default";

  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] px-1.5 text-label font-bold tabular-nums",
        className
      )}
      style={{
        background: `var(--aqt-medal-${tier})`,
        color: `var(--aqt-medal-${tier}-fg)`
      }}
    >
      {place}
    </span>
  );
}
