"use client";

import { useId, useMemo } from "react";
import { useTranslations } from "next-intl";
import { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleSlash, Gamepad2, Pencil, Swords, Trash2 } from "lucide-react";

import { DataTable, columnMeta, createKebabColumn } from "@/components/data-table";
import { AssetPreview } from "@/components/admin/AssetPreview";
import { CatalogAliasesField, CatalogNameField } from "@/components/admin/CatalogFormFields";
import { CatalogToolbarActions, entityFormError, onEntityDialogClose } from "@/components/admin/CatalogToolbarActions";
import { EntityFormDialog } from "@/components/kit/EntityFormDialog";
import { createAliasesColumn } from "@/components/admin/catalog-table-columns";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { FilterBar } from "@/components/kit/FilterBar";
import { useFilters, type FilterDef } from "@/components/kit/useFilters";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import adminService from "@/services/admin.service";
import type { CatalogEntityRead, CatalogEntityWrite } from "@/types/catalog.types";
import { usePermissions } from "@/hooks/usePermissions";
import { useCatalogEntityCrud } from "@/hooks/useCatalogEntityCrud";
import { useKindLabel } from "@/hooks/useKindLabel";
import { catalogQueryKeys } from "@/lib/catalog/query-keys";
import { catalogSort } from "@/lib/catalog/sort";

import { CatalogKindGuard, type CatalogKindContext } from "../_components/ContentDiscipline";

interface MapForm {
  name: string;
  /** The map's mode (`parent_id`); only a game that declares `mode` has one. */
  parent_id: number;
  in_competitive: boolean;
  aliases: string[];
  active: boolean;
}

// Key order matters: `hasUnsavedChanges` compares JSON, so `getMapForm` below
// must list the same fields in the same order or every dialog opens dirty.
const EMPTY_FORM: MapForm = { name: "", parent_id: 0, in_competitive: true, aliases: [], active: true };

function getMapForm(entity: CatalogEntityRead | null): MapForm {
  if (!entity) return { ...EMPTY_FORM };
  return {
    name: entity.name,
    parent_id: entity.parent_id ?? 0,
    in_competitive: entity.attrs.in_competitive !== false,
    aliases: entity.aliases ?? [],
    active: entity.active,
  };
}

/** A game without modes has no parent and no competitive pool: send only what its maps carry. */
function toWrite(hasModes: boolean, form: MapForm): CatalogEntityWrite {
  return {
    name: form.name,
    aliases: form.aliases,
    active: form.active,
    ...(hasModes && { parent_id: form.parent_id, attrs: { in_competitive: form.in_competitive } }),
  };
}

export default function MapsAdminPage() {
  return <CatalogKindGuard kind="map">{(context) => <MapsTable {...context} />}</CatalogKindGuard>;
}

function MapsTable({ descriptor, discipline, kind, kindLabel }: Readonly<CatalogKindContext>) {
  const t = useTranslations("adminWorkspace.content");
  const modeLabel = useKindLabel()(descriptor, "mode");
  const hasModes = "mode" in descriptor.kinds;
  const { isSuperuser } = usePermissions();
  const formId = useId();
  const nameFieldId = `${formId}-name`;
  const modeFieldId = `${formId}-mode`;
  const aliasesFieldId = `${formId}-aliases`;

  // A map's mode is a catalog entity of the same discipline; a game without modes never asks.
  const { data: modesData } = useQuery({
    queryKey: catalogQueryKeys.adminList({ discipline }, "mode", { per_page: -1 }),
    queryFn: async ({ signal }) =>
      (await adminService.listCatalogEntities(discipline, "mode", { per_page: -1 }, { signal })).results,
    enabled: hasModes,
  });

  const {
    formData,
    setFormData,
    editingEntity,
    deletingEntity,
    setDeletingEntity,
    isDialogOpen,
    closeForm,
    openCreate,
    openEdit,
    handleSubmit,
    isFormDirty,
    createMutation,
    updateMutation,
    deleteMutation,
    deleteEntity,
    syncMutation,
    sync,
  } = useCatalogEntityCrud<CatalogEntityRead, MapForm, MapForm>({
    discipline,
    kind,
    emptyForm: EMPTY_FORM,
    getForm: getMapForm,
    service: {
      create: (d, k, data) => adminService.createCatalogEntity(d, k, toWrite(hasModes, data)),
      update: (d, k, id, data) => adminService.updateCatalogEntity(d, k, id, toWrite(hasModes, data)),
      delete: (d, k, id) => adminService.deleteCatalogEntity(d, k, id),
      sync: (d) => adminService.syncCatalog(d),
    },
  });

  const filterDefs = useMemo<FilterDef[]>(
    () =>
      hasModes
        ? [
            {
              key: "mode",
              label: t("filters.mode", { kind: modeLabel }),
              kind: "single",
              options: (modesData ?? []).map((mode) => ({ value: mode.id.toString(), label: mode.name })),
            },
            {
              key: "in_competitive",
              label: t("filters.modePool"),
              kind: "single",
              options: [
                { value: "true", label: t("catalog.competitive") },
                { value: "false", label: t("catalog.casual") },
              ],
            },
          ]
        : [],
    [hasModes, modesData, modeLabel, t]
  );
  const filters = useFilters(filterDefs);
  const modeFilter = String(filters.values.mode ?? "");
  const competitiveFilter = String(filters.values.in_competitive ?? "");

  const listFilters = (page: number, search: string, pageSize: number, sortField: string | null, sortDir: "asc" | "desc") => ({
    page,
    per_page: pageSize,
    search,
    sort: catalogSort(sortField),
    order: sortDir,
    ...(modeFilter && { parent_id: Number(modeFilter) }),
    // `false` is a real filter value (the casual pool), so test the string, not truthiness.
    ...(competitiveFilter && { attrs: { in_competitive: competitiveFilter === "true" } }),
  });

  const columns: ColumnDef<CatalogEntityRead>[] = [
    {
      accessorKey: "id",
      header: t("columns.id"),
      size: 44,
      cell: ({ row }) => <span className="tabular-nums">{row.original.id}</span>,
    },
    {
      id: "image",
      header: t("columns.image"),
      size: 96,
      meta: columnMeta<CatalogEntityRead>({ align: "center" }),
      cell: ({ row }) => {
        const map = row.original;
        return (
          <AssetPreview
            imagePath={map.image_path}
            name={map.name}
            assetLabel={t("columns.image")}
            className="mx-auto h-12 w-24"
          />
        );
      },
    },
    {
      accessorKey: "name",
      header: t("columns.name"),
      size: 144,
    },
    ...(hasModes
      ? [
          {
            accessorKey: "parent",
            header: modeLabel,
            size: 112,
            enableSorting: false,
            cell: ({ row }) => {
              const map = row.original;
              return map.parent ? (
                <Badge variant="outline">{map.parent.name}</Badge>
              ) : (
                <span className="text-sm text-muted-foreground">{t("catalog.unknown")}</span>
              );
            },
          } satisfies ColumnDef<CatalogEntityRead>,
          {
            accessorKey: "in_competitive",
            header: t("columns.modePool"),
            size: 120,
            enableSorting: false,
            meta: columnMeta<CatalogEntityRead>({ align: "center" }),
            cell: ({ row }) =>
              row.original.attrs.in_competitive !== false ? (
                <StatusIcon icon={Swords} label={t("catalog.competitive")} variant="success" />
              ) : (
                <StatusIcon icon={Gamepad2} label={t("catalog.casual")} variant="muted" />
              ),
          } satisfies ColumnDef<CatalogEntityRead>,
        ]
      : []),
    {
      accessorKey: "active",
      header: t("columns.active"),
      size: 72,
      enableSorting: false,
      meta: columnMeta<CatalogEntityRead>({ align: "center" }),
      cell: ({ row }) =>
        row.original.active ? (
          <StatusIcon icon={CircleCheck} label={t("catalog.active")} variant="success" />
        ) : (
          <StatusIcon icon={CircleSlash} label={t("catalog.inactive")} variant="muted" />
        ),
    },
    createAliasesColumn<CatalogEntityRead>((map) => map.aliases, t("columns.aliases")),
    createKebabColumn<CatalogEntityRead>(
      (map) => [
        {
          label: t("actions.edit", { kind: kindLabel }),
          icon: Pencil,
          hidden: !isSuperuser,
          onSelect: () => openEdit(map),
        },
        {
          label: t("actions.deleteKind", { kind: kindLabel }),
          icon: Trash2,
          destructive: true,
          hidden: !isSuperuser,
          onSelect: () => setDeletingEntity(map),
        },
      ],
      { rowLabel: (map) => map.name }
    ),
  ];

  return (
    <>
      <DataTable
        queryKey={(page, search, pageSize, sortField, sortDir) =>
          catalogQueryKeys.adminList({ discipline }, kind, listFilters(page, search, pageSize, sortField, sortDir))
        }
        queryFn={(page, search, pageSize, sortField, sortDir) =>
          adminService.listCatalogEntities(
            discipline,
            kind,
            listFilters(page, search, pageSize, sortField, sortDir)
          )
        }
        columns={columns}
        searchPlaceholder={t("catalog.entity.search", { kind: kindLabel })}
        filterKey={filters.filterKey}
        toolbar={hasModes ? <FilterBar defs={filterDefs} filters={filters} /> : undefined}
        emptyMessage={t("catalog.entity.empty", { kind: kindLabel })}
        onRowDoubleClick={isSuperuser ? (row) => openEdit(row.original) : undefined}
        actions={
          <CatalogToolbarActions
            canSync={isSuperuser}
            isSyncing={syncMutation.isPending}
            onSync={sync}
            syncLabel={t("catalog.entity.sync", { game: descriptor.name })}
            onCreate={openCreate}
            createLabel={t("catalog.entity.create", { kind: kindLabel })}
          />
        }
      />

      {/* Create/Edit Dialog */}
      <EntityFormDialog
        open={isDialogOpen}
        onOpenChange={onEntityDialogClose(closeForm)}
        title={
          editingEntity
            ? t("catalog.entity.updateTitle", { kind: kindLabel })
            : t("catalog.entity.createTitle", { kind: kindLabel })
        }
        description={
          editingEntity
            ? t("catalog.entity.descriptionUpdate", { kind: kindLabel })
            : t("catalog.entity.descriptionCreate", { kind: kindLabel })
        }
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        submittingLabel={editingEntity ? t("catalog.entity.updating") : t("catalog.entity.creating")}
        errorMessage={entityFormError(
          kindLabel,
          !!editingEntity,
          updateMutation.error,
          createMutation.error,
          (key, values) => t(key, values)
        )}
        isDirty={isFormDirty}
      >
        <div className="space-y-4">
          <CatalogNameField
            id={nameFieldId}
            value={formData.name}
            onChange={(name) => setFormData({ ...formData, name })}
            placeholder={t("catalog.entity.namePlaceholder", { kind: kindLabel })}
          />

          {hasModes && (
            <div className="space-y-2">
              <Label htmlFor={modeFieldId}>{t("catalog.map.modeRequired", { kind: modeLabel })}</Label>
              <Select
                value={formData.parent_id ? formData.parent_id.toString() : ""}
                onValueChange={(value) => setFormData({ ...formData, parent_id: parseInt(value) })}
              >
                <SelectTrigger id={modeFieldId}>
                  <SelectValue placeholder={t("catalog.map.selectMode", { kind: modeLabel })} />
                </SelectTrigger>
                <SelectContent>
                  {modesData?.map((mode) => (
                    <SelectItem key={mode.id} value={mode.id.toString()}>
                      {mode.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <CatalogAliasesField
            id={aliasesFieldId}
            aliases={formData.aliases}
            onChange={(aliases) => setFormData({ ...formData, aliases })}
            placeholder={"Илиос\nHollywood (Halloween)"}
            helperText={t("fields.aliasesHelp")}
          />

          {hasModes && (
            <div className="flex items-center gap-2 pt-2">
              <Checkbox
                id={`${formId}-in-competitive`}
                checked={formData.in_competitive}
                onCheckedChange={(checked) => setFormData({ ...formData, in_competitive: Boolean(checked) })}
              />
              <Label htmlFor={`${formId}-in-competitive`} className="cursor-pointer font-medium text-sm">
                {t("catalog.map.competitiveMap")}
              </Label>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Checkbox
              id={`${formId}-active`}
              checked={formData.active}
              onCheckedChange={(checked) => setFormData({ ...formData, active: Boolean(checked) })}
            />
            <Label htmlFor={`${formId}-active`} className="cursor-pointer font-medium text-sm">
              {t("fields.activeHelp")}
            </Label>
          </div>
        </div>
      </EntityFormDialog>

      {/* Delete Confirmation */}
      {deletingEntity && (
        <ConfirmDialog
          open={!!deletingEntity}
          onOpenChange={(open) => !open && setDeletingEntity(null)}
          onConfirm={() => deleteEntity(deletingEntity.id)}
          pending={deleteMutation.isPending}
          intent={{
            title: t("catalog.entity.deleteTitle", { kind: kindLabel }),
            description: t("catalog.entity.deleteDescription", { name: deletingEntity.name }),
            confirmLabel: t("actions.delete"),
            tone: "danger",
          }}
        />
      )}
    </>
  );
}
