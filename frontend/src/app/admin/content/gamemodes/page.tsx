"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { ColumnDef } from "@tanstack/react-table";
import { CircleCheck, CircleSlash, Pencil, Trash2 } from "lucide-react";

import { DataTable, columnMeta, createKebabColumn } from "@/components/data-table";
import { CatalogAliasesField, CatalogNameField } from "@/components/admin/CatalogFormFields";
import { CatalogToolbarActions, entityFormError, onEntityDialogClose } from "@/components/admin/CatalogToolbarActions";
import { EntityFormDialog } from "@/components/kit/EntityFormDialog";
import { createAliasesColumn } from "@/components/admin/catalog-table-columns";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

import adminService from "@/services/admin.service";
import type { CatalogEntityRead } from "@/types/catalog.types";
import { usePermissions } from "@/hooks/usePermissions";
import { useCatalogEntityCrud } from "@/hooks/useCatalogEntityCrud";
import { catalogQueryKeys } from "@/lib/catalog/query-keys";
import { catalogSort } from "@/lib/catalog/sort";

import { CatalogKindGuard, type CatalogKindContext } from "../_components/ContentDiscipline";

interface ModeForm {
  name: string;
  aliases: string[];
  active: boolean;
}

// Key order matters: `hasUnsavedChanges` compares JSON, so the edit form below
// must list the same fields in the same order or every dialog opens dirty.
const EMPTY_FORM: ModeForm = { name: "", aliases: [], active: true };

function getModeForm(entity: CatalogEntityRead | null): ModeForm {
  if (!entity) return { ...EMPTY_FORM };
  return { name: entity.name, aliases: entity.aliases ?? [], active: entity.active };
}

export default function GamemodesAdminPage() {
  return <CatalogKindGuard kind="mode">{(context) => <ModesTable {...context} />}</CatalogKindGuard>;
}

function ModesTable({ descriptor, discipline, kind, kindLabel }: Readonly<CatalogKindContext>) {
  const t = useTranslations("adminWorkspace.content");
  const { isSuperuser } = usePermissions();
  const formId = useId();
  const nameFieldId = `${formId}-name`;
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
  } = useCatalogEntityCrud<CatalogEntityRead, ModeForm, ModeForm>({
    discipline,
    kind,
    emptyForm: EMPTY_FORM,
    getForm: getModeForm,
    service: {
      create: (d, k, data) => adminService.createCatalogEntity(d, k, data),
      update: (d, k, id, data) => adminService.updateCatalogEntity(d, k, id, data),
      delete: (d, k, id) => adminService.deleteCatalogEntity(d, k, id),
      sync: (d) => adminService.syncCatalog(d),
    },
  });

  const columns: ColumnDef<CatalogEntityRead>[] = [
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
    createAliasesColumn<CatalogEntityRead>((mode) => mode.aliases, t("columns.aliases")),
    createKebabColumn<CatalogEntityRead>(
      (mode) => [
        {
          label: t("actions.edit", { kind: kindLabel }),
          icon: Pencil,
          hidden: !isSuperuser,
          onSelect: () => openEdit(mode),
        },
        {
          label: t("actions.deleteKind", { kind: kindLabel }),
          icon: Trash2,
          destructive: true,
          hidden: !isSuperuser,
          onSelect: () => setDeletingEntity(mode),
        },
      ],
      { rowLabel: (mode) => mode.name }
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
          })
        }
        queryFn={(page, search, pageSize, sortField, sortDir) =>
          adminService.listCatalogEntities(discipline, kind, {
            page,
            per_page: pageSize,
            search,
            sort: catalogSort(sortField),
            order: sortDir,
          })
        }
        columns={columns}
        searchPlaceholder={t("catalog.entity.search", { kind: kindLabel })}
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

          <CatalogAliasesField
            id={aliasesFieldId}
            aliases={formData.aliases}
            onChange={(aliases) => setFormData({ ...formData, aliases })}
            placeholder={"Контроль\nコントロール"}
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
