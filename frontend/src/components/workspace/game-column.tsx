"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { GameLabel } from "@/components/workspace/GameLabel";
import { useGameDescriptors } from "@/hooks/useGameDescriptors";

function GameCell({ code }: Readonly<{ code: string }>) {
  const games = useGameDescriptors();
  return <GameLabel code={code} games={games} />;
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
      return code ? <GameCell code={code} /> : null;
    }
  };
}
