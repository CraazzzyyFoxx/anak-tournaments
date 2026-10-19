"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";

import type { CatalogEntityRead } from "@/types/catalog.types";

import { useCatalogTrailingColumns } from "../shared";

export function useGamemodeColumns({
  kindLabel,
  isSuperuser,
  onEdit,
  onDelete,
}: Readonly<{
  kindLabel: string;
  isSuperuser: boolean;
  onEdit: (mode: CatalogEntityRead) => void;
  onDelete: (mode: CatalogEntityRead) => void;
}>): ColumnDef<CatalogEntityRead>[] {
  const t = useTranslations("adminWorkspace.content");
  const trailing = useCatalogTrailingColumns({ kindLabel, isSuperuser, onEdit, onDelete });
  return useMemo<ColumnDef<CatalogEntityRead>[]>(
    () => [
      {
        accessorKey: "id",
        header: t("columns.id"),
        size: 80,
        cell: ({ row }) => <span className="tabular-nums">{row.original.id}</span>,
      },
      {
        accessorKey: "name",
        header: t("columns.name"),
      },
      ...trailing,
    ],
    [t, trailing]
  );
}
