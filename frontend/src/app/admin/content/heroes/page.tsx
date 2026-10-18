"use client";

import { useCallback, useId, useMemo } from "react";
import { useTranslations } from "next-intl";
import { ColumnDef } from "@tanstack/react-table";
import { CircleCheck, CircleSlash, Pencil, Trash2 } from "lucide-react";

import { DataTable, columnMeta, createKebabColumn } from "@/components/data-table";
import { AssetPreview } from "@/components/admin/AssetPreview";
import { CatalogAliasesField, CatalogNameField } from "@/components/admin/CatalogFormFields";
import { CatalogToolbarActions, entityFormError, onEntityDialogClose } from "@/components/admin/CatalogToolbarActions";
import { EntityFormDialog } from "@/components/kit/EntityFormDialog";
import { createAliasesColumn } from "@/components/admin/catalog-table-columns";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { FilterBar } from "@/components/kit/FilterBar";
import { useFilters, type FilterDef } from "@/components/kit/useFilters";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import adminService from "@/services/admin.service";
import type { CatalogEntityRead, CatalogEntityWrite } from "@/types/catalog.types";
import { usePermissions } from "@/hooks/usePermissions";
import { useCatalogEntityCrud } from "@/hooks/useCatalogEntityCrud";
import { catalogQueryKeys } from "@/lib/catalog/query-keys";
import { catalogSort } from "@/lib/catalog/sort";

import { CatalogKindGuard, type CatalogKindContext } from "../_components/ContentDiscipline";

/**
 * Neutral blue: the form default, the color-picker fallback and the hex hint.
 *
 * Exempt from the design-token rule: `color` is a persisted character attribute the
 * admin edits, so this literal is the initial *value* of a data field and is
 * also what `<input type="color">` requires — not chrome this page paints with.
 */
const DEFAULT_COLOR = "#3b82f6";

interface CharacterForm {
  name: string;
  /** The module's character class (`attrs.class`); empty when the game declares none. */
  class: string;
  color: string;
  image_path: string;
  aliases: string[];
  active: boolean;
}

// Key order matters: `hasUnsavedChanges` compares JSON, so `getCharacterForm` below
// must list the same fields in the same order or every dialog opens dirty.
const emptyForm = (classes: readonly string[]): CharacterForm => ({
  name: "",
  class: classes[0] ?? "",
  color: DEFAULT_COLOR,
  image_path: "",
  aliases: [],
  active: true,
});

function getCharacterForm(classes: readonly string[], entity: CatalogEntityRead | null): CharacterForm {
  if (!entity) return emptyForm(classes);
  return {
    name: entity.name,
    class: typeof entity.attrs.class === "string" ? entity.attrs.class : (classes[0] ?? ""),
    color: typeof entity.attrs.color === "string" ? entity.attrs.color : DEFAULT_COLOR,
    image_path: entity.image_path ?? "",
    aliases: entity.aliases ?? [],
    active: entity.active,
  };
}

/** Attrs merge on update: send only what this game's character form owns. */
function toWrite(classes: readonly string[], form: CharacterForm): CatalogEntityWrite {
  return {
    name: form.name,
    image_path: form.image_path || null,
    aliases: form.aliases,
    active: form.active,
    attrs: { ...(classes.length > 0 && { class: form.class }), color: form.color },
  };
}

export default function CharactersAdminPage() {
  return <CatalogKindGuard kind="character">{(context) => <CharactersTable {...context} />}</CatalogKindGuard>;
}

function CharactersTable({ descriptor, discipline, kind, kindLabel }: Readonly<CatalogKindContext>) {
  const t = useTranslations("adminWorkspace.content");
  const classes = descriptor.character_classes;
  const classLabel = useCallback(
    (code: string) => (t.has(`heroRoles.${code}` as never) ? t(`heroRoles.${code}` as never) : code),
    [t]
  );
  const { isSuperuser } = usePermissions();
  const formId = useId();
  const nameFieldId = `${formId}-name`;
  const imageFieldId = `${formId}-image`;
  const classFieldId = `${formId}-class`;
  const colorFieldId = `${formId}-color`;
  const colorPickerId = `${formId}-color-picker`;
  const aliasesFieldId = `${formId}-aliases`;

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
  } = useCatalogEntityCrud<CatalogEntityRead, CharacterForm, CharacterForm>({
    discipline,
    kind,
    emptyForm: emptyForm(classes),
    getForm: (entity) => getCharacterForm(classes, entity),
    service: {
      create: (d, k, data) => adminService.createCatalogEntity(d, k, toWrite(classes, data)),
      update: (d, k, id, data) => adminService.updateCatalogEntity(d, k, id, toWrite(classes, data)),
      delete: (d, k, id) => adminService.deleteCatalogEntity(d, k, id),
      sync: (d) => adminService.syncCatalog(d),
    },
  });

  const filterDefs = useMemo<FilterDef[]>(
    () => [
      {
        key: "class",
        label: t("filters.class"),
        kind: "single",
        options: classes.map((code) => ({ value: code, label: classLabel(code) })),
      },
    ],
    [classes, classLabel, t]
  );
  const filters = useFilters(filterDefs);
  const classFilter = String(filters.values.class ?? "");

  const columns: ColumnDef<CatalogEntityRead>[] = [
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
    createAliasesColumn<CatalogEntityRead>((entity) => entity.aliases, t("columns.aliases")),
    createKebabColumn<CatalogEntityRead>(
      (entity) => [
        {
          label: t("actions.edit", { kind: kindLabel }),
          icon: Pencil,
          hidden: !isSuperuser,
          onSelect: () => openEdit(entity),
        },
        {
          label: t("actions.deleteKind", { kind: kindLabel }),
          icon: Trash2,
          destructive: true,
          hidden: !isSuperuser,
          onSelect: () => setDeletingEntity(entity),
        },
      ],
      { rowLabel: (entity) => entity.name }
    ),
  ];

  return (
    <>
      <DataTable
        queryKey={(page, search, pageSize, sortField, sortDir) =>
          catalogQueryKeys.adminList({ discipline }, kind, {
            page,
            per_page: pageSize,
            search,
            sort: catalogSort(sortField),
            order: sortDir,
            ...(classFilter && { attrs: { class: classFilter } }),
          })
        }
        queryFn={(page, search, pageSize, sortField, sortDir) =>
          adminService.listCatalogEntities(discipline, kind, {
            page,
            per_page: pageSize,
            search,
            sort: catalogSort(sortField),
            order: sortDir,
            ...(classFilter && { attrs: { class: classFilter } }),
          })
        }
        columns={columns}
        searchPlaceholder={t("catalog.entity.search", { kind: kindLabel })}
        filterKey={filters.filterKey}
        toolbar={classes.length > 0 ? <FilterBar defs={filterDefs} filters={filters} /> : undefined}
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

          <div className="space-y-2">
            <Label htmlFor={imageFieldId}>{t("catalog.entity.imageUrl", { kind: kindLabel })}</Label>
            <div className="flex items-center gap-3">
              <AssetPreview
                imagePath={formData.image_path}
                name={formData.name || kindLabel}
                assetLabel={t("catalog.entity.imageUrl", { kind: kindLabel })}
                shape="circle"
                className="h-10 w-10 shrink-0"
              />
              <Input
                id={imageFieldId}
                type="url"
                value={formData.image_path || ""}
                onChange={(e) => setFormData({ ...formData, image_path: e.target.value })}
                className="flex-1"
              />
            </div>
            <p className="text-xs text-muted-foreground">{t("catalog.character.iconLink")}</p>
          </div>

          {classes.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor={classFieldId}>{t("catalog.character.classRequired")}</Label>
              <Select
                value={formData.class}
                onValueChange={(value) => setFormData({ ...formData, class: value })}
              >
                <SelectTrigger id={classFieldId}>
                  <SelectValue placeholder={t("catalog.character.selectClass")} />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((code) => (
                    <SelectItem key={code} value={code}>
                      {classLabel(code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor={colorFieldId}>{t("catalog.character.color")}</Label>
            <div className="flex items-center gap-2">
              <Input
                id={colorPickerId}
                aria-label={t("catalog.character.pickColor")}
                type="color"
                value={formData.color || DEFAULT_COLOR}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="h-10 w-14 shrink-0 cursor-pointer p-1"
              />
              <Input
                id={colorFieldId}
                type="text"
                value={formData.color || ""}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                placeholder={DEFAULT_COLOR}
                className="flex-1 font-mono"
              />
            </div>
          </div>

          <CatalogAliasesField
            id={aliasesFieldId}
            aliases={formData.aliases}
            onChange={(aliases) => setFormData({ ...formData, aliases })}
            placeholder={"Ана\nアナ"}
            helperText={t("fields.aliasesHelp")}
          />

          <div className="flex items-center gap-2 pt-2">
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
