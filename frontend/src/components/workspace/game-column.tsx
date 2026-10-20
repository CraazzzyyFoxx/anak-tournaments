"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { GameLabel } from "@/components/workspace/GameLabel";
import { GameMark } from "@/components/workspace/GameMark";
import { useGameDescriptors } from "@/hooks/useGameDescriptors";

/** A row's game in an all-games admin list — its table cell or its mobile card (spec §6.1): mark and name. */
export function RowGameLabel({ code, className }: Readonly<{ code: string; className?: string }>) {
  const games = useGameDescriptors();
  return <GameLabel code={code} games={games} className={className} />;
}

/** A game's mark alone, by code: a filter option's leading icon (a game, a tournament of an all-games picker). */
export function RowGameMark({ code, size = 16 }: Readonly<{ code: string; size?: number }>) {
  const games = useGameDescriptors();
  const game = games.get(code) ?? { code, name: code, short_name: code, icon: null };
  return <GameMark discipline={game} size={size} decorative />;
}

/** The admin tables' "Game" column (spec §6.1): each row's game mark and name. Only the all-games view adds it. */
export function gameColumn<T>(header: string, codeOf: (row: T) => string | null | undefined): ColumnDef<T> {
  return {
    id: "game",
    header,
    size: 160,
    enableSorting: false,
    cell: ({ row }) => {
      const code = codeOf(row.original);
      return code ? <RowGameLabel code={code} /> : null;
    }
  };
}
