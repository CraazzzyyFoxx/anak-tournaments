"use client";

import React from "react";
import Link from "next/link";
import {
  ColumnDef,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable
} from "@tanstack/react-table";
import { useTranslations } from "next-intl";

import { OwalStack } from "@/types/tournament.types";
import { Card, CardContent } from "@/components/ui/card";
import { columnMeta, DataTable } from "@/components/ui/data-table";

const playerCell = (name: string) => (
  <Link href={`/users/${name.replace("#", "-")}`}>{name.split("#")[0]}</Link>
);

const OwalStacksTable = ({ data }: { data: OwalStack[] }) => {
  const t = useTranslations();

  const columns = React.useMemo<ColumnDef<OwalStack>[]>(
    () => [
      {
        accessorKey: "user_1.name",
        id: "userName1",
        header: t("owal.playerOne"),
        enableSorting: false,
        cell: ({ row }) => playerCell(row.getValue<string>("userName1"))
      },
      {
        accessorKey: "user_2.name",
        id: "userName2",
        header: t("owal.playerTwo"),
        enableSorting: false,
        cell: ({ row }) => playerCell(row.getValue<string>("userName2"))
      },
      {
        accessorKey: "games",
        id: "games",
        header: t("owal.days"),
        meta: columnMeta<OwalStack>({ numeric: true }),
        cell: ({ row }) => row.getValue<number>("games")
      },
      {
        accessorKey: "avg_position",
        id: "avg_position",
        header: t("owal.averagePlacement"),
        meta: columnMeta<OwalStack>({ numeric: true }),
        cell: ({ row }) => row.getValue<number>("avg_position").toFixed(2)
      }
    ],
    [t]
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    rowCount: data.length
  });

  return (
    <Card className="w-full max-w-[800px]">
      <CardContent className="p-0">
        <DataTable table={table} label={t("owal.stacksTableLabel")} align="center" />
      </CardContent>
    </Card>
  );
};

export default OwalStacksTable;
