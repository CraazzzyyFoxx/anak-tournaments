"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";

import { columnMeta } from "@/components/data-table";
import { AssetPreview } from "@/components/admin/AssetPreview";
import { Badge } from "@/components/ui/badge";
import type { CatalogEntityRead } from "@/types/catalog.types";

import { useCatalogTrailingColumns } from "../shared";

/** The character row: portrait, name in its colour, class when the game declares classes. */
export function useHeroColumns({
  kindLabel,
  classes,
  classLabel,
  isSuperuser,
  onEdit,
  onDelete,
}: Readonly<{
  kindLabel: string;
  classes: readonly string[];
  classLabel: (code: string) => string;
  isSuperuser: boolean;
  onEdit: (entity: CatalogEntityRead) => void;
  onDelete: (entity: CatalogEntityRead) => void;
}>): ColumnDef<CatalogEntityRead>[] {
  const t = useTranslations("adminWorkspace.content");
  const trailing = useCatalogTrailingColumns({ kindLabel, isSuperuser, onEdit, onDelete });
  return useMemo<ColumnDef<CatalogEntityRead>[]>(
    () => [
      {
        accessorKey: "id",
        header: t("columns.id"),
        size: 44,
        cell: ({ row }) => <span className="tabular-nums">{row.original.id}</span>,
      },
      {
        id: "icon",
        header: t("columns.icon"),
        size: 52,
        meta: columnMeta<CatalogEntityRead>({ align: "center" }),
        cell: ({ row }) => {
          const entity = row.original;
          return (
            <AssetPreview
              imagePath={entity.image_path}
              name={entity.name}
              assetLabel={t("catalog.entity.imageUrl", { kind: kindLabel })}
              shape="circle"
              className="mx-auto h-10 w-10"
            />
          );
        },
      },
      {
        accessorKey: "name",
        header: t("columns.name"),
        size: 132,
        cell: ({ row }) => {
          const entity = row.original;
          const color = typeof entity.attrs.color === "string" ? entity.attrs.color : null;
          return (
            <div className="flex items-center gap-2">
              {color && (
                <div
                  role="img"
                  aria-label={t("catalog.character.pickColorWithValue", { color })}
                  title={color}
                  className="h-4 w-4 rounded-full border border-border"
                  style={{ backgroundColor: color }}
                />
              )}
              <span>{entity.name}</span>
            </div>
          );
        },
      },
      ...(classes.length > 0
        ? [
            {
              id: "class",
              header: t("columns.class"),
              size: 80,
              enableSorting: false,
              meta: columnMeta<CatalogEntityRead>({ align: "center" }),
              cell: ({ row }) => {
                const code = row.original.attrs.class;
                return typeof code === "string" ? (
                  <Badge variant="outline">{classLabel(code)}</Badge>
                ) : (
                  <span className="text-sm text-muted-foreground">{t("catalog.unknown")}</span>
                );
              },
            } satisfies ColumnDef<CatalogEntityRead>,
          ]
        : []),
      ...trailing,
    ],
    [t, kindLabel, classes, classLabel, trailing]
  );
}
