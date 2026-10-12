"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { ColumnDef } from "@tanstack/react-table";
import { Pencil, Trash2 } from "lucide-react";

import { DataTable, createKebabColumn } from "@/components/data-table";
import { CatalogAliasesField, CatalogNameField } from "@/components/admin/CatalogFormFields";
import { CatalogToolbarActions, entityFormError, onEntityDialogClose } from "@/components/admin/CatalogToolbarActions";
import { EntityFormDialog } from "@/components/kit/EntityFormDialog";
import { createAliasesColumn } from "@/components/admin/catalog-table-columns";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";

import adminService from "@/services/admin.service";
import type { Gamemode, GamemodeCreateInput, GamemodeUpdateInput } from "@/types/admin.types";
import { usePermissions } from "@/hooks/usePermissions";
import { useCatalogEntityCrud } from "@/hooks/useCatalogEntityCrud";
import { adminQueryKeys } from "@/lib/admin/query-keys";

// Key order matters: `hasUnsavedChanges` compares JSON, so the edit form below
// must list the same fields in the same order or every dialog opens dirty.
const emptyGamemodeForm: GamemodeCreateInput = { name: "", aliases: [] };

function getGamemodeForm(gamemode: Gamemode | null): GamemodeCreateInput | GamemodeUpdateInput {
  if (!gamemode) {
    return { ...emptyGamemodeForm };
  }

  return { name: gamemode.name, aliases: gamemode.aliases ?? [] };
}

export default function GamemodesAdminPage() {
  const t = useTranslations("adminWorkspace.content");
  const { isSuperuser } = usePermissions();
  const formId = useId();
  const nameFieldId = `${formId}-name`;
  const aliasesFieldId = `${formId}-aliases`;

  const {
    formData,
    setFormData,
    editingEntity: editingGamemode,
    deletingEntity: deletingGamemode,
    setDeletingEntity: setDeletingGamemode,
    isDialogOpen,
    closeForm,
    openCreate,
    openEdit,
    handleSubmit,
    isFormDirty,
    createMutation,
    updateMutation,
    deleteMutation,
    syncMutation,
  } = useCatalogEntityCrud<Gamemode, GamemodeCreateInput, GamemodeUpdateInput>({
    queryKey: adminQueryKeys.contentEntity("gamemodes"),
    emptyForm: emptyGamemodeForm,
    getForm: getGamemodeForm,
    service: {
      create: (data) => adminService.createGamemode(data),
      update: (id, data) => adminService.updateGamemode(id, data),
      delete: (id) => adminService.deleteGamemode(id),
      sync: () => adminService.syncGamemodes(),
    },
  });

  const columns: ColumnDef<Gamemode>[] = [
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
    createAliasesColumn<Gamemode>((gamemode) => gamemode.aliases, t("columns.aliases")),
    createKebabColumn<Gamemode>(
      (gamemode) => [
        {
          label: t("actions.editGamemode"),
          icon: Pencil,
          hidden: !isSuperuser,
          onSelect: () => openEdit(gamemode),
        },
        {
          label: t("actions.deleteGamemode"),
          icon: Trash2,
          destructive: true,
          hidden: !isSuperuser,
          onSelect: () => setDeletingGamemode(gamemode),
        },
      ],
      { rowLabel: (gamemode) => gamemode.name }
    ),
  ];

  return (
    <>
      <DataTable
        queryKey={(page, search, pageSize, sortField, sortDir) => ["admin", "gamemodes", page, search, pageSize, sortField, sortDir]}
        queryFn={(page, search, pageSize, sortField, sortDir) =>
          adminService.getGamemodes({ page, search, per_page: pageSize, sort: sortField ?? undefined, order: sortDir })
        }
        columns={columns}
        searchPlaceholder={t("catalog.gamemode.search")}
        emptyMessage={t("catalog.gamemode.empty")}
        onRowDoubleClick={isSuperuser ? (row) => openEdit(row.original) : undefined}
        actions={
          <CatalogToolbarActions
            canSync={isSuperuser}
            isSyncing={syncMutation.isPending}
            onSync={() => syncMutation.mutate()}
            syncLabel={t("catalog.gamemode.sync")}
            onCreate={openCreate}
            createLabel={t("catalog.gamemode.create")}
          />
        }
      />

      {/* Create/Edit Dialog */}
      <EntityFormDialog
        open={isDialogOpen}
        onOpenChange={onEntityDialogClose(closeForm)}
        title={editingGamemode ? t("catalog.gamemode.updateTitle") : t("catalog.gamemode.createTitle")}
        description={
          editingGamemode ? t("catalog.gamemode.descriptionUpdate") : t("catalog.gamemode.descriptionCreate")
        }
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        submittingLabel={editingGamemode ? t("catalog.gamemode.updating") : t("catalog.gamemode.creating")}
        errorMessage={entityFormError(
          "gamemode",
          !!editingGamemode,
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
            placeholder={t("catalog.gamemode.namePlaceholder")}
          />

          <CatalogAliasesField
            id={aliasesFieldId}
            aliases={formData.aliases}
            onChange={(aliases) => setFormData({ ...formData, aliases })}
            placeholder={"Контроль\nコントロール"}
            helperText={t("fields.aliasesHelp")}
          />
        </div>
      </EntityFormDialog>

      {/* Delete Confirmation */}
      {deletingGamemode && (
        <ConfirmDialog
          open={!!deletingGamemode}
          onOpenChange={(open) => !open && setDeletingGamemode(null)}
          onConfirm={() => deleteMutation.mutate(deletingGamemode.id)}
          pending={deleteMutation.isPending}
          intent={{
            title: t("catalog.gamemode.deleteTitle"),
            description: t("catalog.gamemode.deleteDescription", { name: deletingGamemode.name }),
            confirmLabel: t("actions.delete"),
            tone: "danger",
          }}
        />
      )}
    </>
  );
}
