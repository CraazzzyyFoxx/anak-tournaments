import { GameMark } from "@/components/workspace/GameMark";
import { cn } from "@/lib/utils";
import type { DisciplineDescriptor } from "@/types/discipline.types";

/**
 * A row's or card's game in an all-games list (spec §6.1): the decorative mark beside the game's name. A code the
 * installed list does not know (an uninstalled game's history) reads as itself.
 */
export function GameLabel({
  code,
  games,
  className
}: Readonly<{ code: string; games: Map<string, DisciplineDescriptor>; className?: string }>) {
  const game = games.get(code);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      {game ? <GameMark discipline={game} size={14} decorative /> : null}
      {/* `self-baseline` makes the name, not the icon's bottom edge, the label's baseline: inline in a text line the
          label then sits on that line's baseline instead of lifting the name and growing the line. */}
      <span className="self-baseline truncate">{game?.name ?? code}</span>
    </span>
  );
}
