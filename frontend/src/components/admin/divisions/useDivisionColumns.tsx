"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import Image from "next/image";
import { useTranslations } from "next-intl";

import {
  bandIconUrl,
  nativeRangeLabel,
  rankRangeLabel,
  type Band,
  type Ladder
} from "@/app/admin/settings/divisions/editor/draftReducer";
import { cn } from "@/lib/utils";

/** The divisions of the version in force; the native-rank column only for a game with a ladder. */
export function useDivisionColumns(ladder: Ladder | null): ColumnDef<Band>[] {
  const t = useTranslations("adminSettings.divisions");
  return useMemo<ColumnDef<Band>[]>(
    () => [
      {
        id: "number",
        header: "#",
        size: 52,
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.number}</span>
      },
      {
        id: "name",
        header: t("table.division"),
        cell: ({ row }) => {
          const crest = bandIconUrl(ladder, row.original);
          return (
            <span className="flex min-w-0 items-center gap-2">
              {crest ? (
                <Image
                  src={crest}
                  alt=""
                  width={20}
                  height={20}
                  unoptimized
                  className="size-5 shrink-0"
                />
              ) : null}
              <span className="truncate font-medium">{row.original.name}</span>
            </span>
          );
        }
      },
      {
        id: "range",
        header: t("table.rankRange"),
        size: 130,
        cell: ({ row }) => (
          <span className="font-mono text-sm tabular-nums">{rankRangeLabel(row.original)}</span>
        )
      },
      ...(ladder
        ? [
            {
              id: "native",
              header: t("table.owRanks"),
              cell: ({ row }) => (
                <span className={cn("font-mono text-sm", !row.original.native && "text-warning")}>
                  {nativeRangeLabel(ladder, row.original) ?? t("ladder.notLinked")}
                </span>
              )
            } satisfies ColumnDef<Band>
          ]
        : [])
    ],
    [t, ladder]
  );
}
