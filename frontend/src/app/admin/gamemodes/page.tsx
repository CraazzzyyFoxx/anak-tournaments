"use client";

import { useId, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { CatalogAliasesField, CatalogNameField } from "@/components/admin/CatalogFormFields";
import {
  CatalogToolbarActions,
  entityFormError,
  onEntityDialogClose
} from "@/components/admin/CatalogToolbarActions";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { createAliasesColumn, createEntityActionsColumn } from "@/components/admin/catalog-table-columns";

import adminService from "@/services/admin.service";
import type { Gamemode, GamemodeCreateInput, GamemodeUpdateInput } from "@/types/admin.types";
import { usePermissions } from "@/hooks/usePermissions";
import { hasUnsavedChanges } from "@/lib/form-change";

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
  const queryClient = useQueryClient();
  const { isSuperuser } = usePermissions();
  const formId = useId();
  const nameFieldId = `${formId}-name`;
  const aliasesFieldId = `${formId}-aliases`;
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingGamemode, setEditingGamemode] = useState<Gamemode | null>(null);
  const [deletingGamemode, setDeletingGamemode] = useState<Gamemode | null>(null);
  const [formData, setFormData] = useState<GamemodeCreateInput | GamemodeUpdateInput>({
    ...emptyGamemodeForm,
  });

  const closeForm = () => {
    setCreateDialogOpen(false);
    setEditingGamemode(null);
    setFormData({ ...emptyGamemodeForm });
  };

  const createMutation = useMutation({
    mutationFn: (data: GamemodeCreateInput) => adminService.createGamemode(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "gamemodes"] });
      closeForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: GamemodeUpdateInput }) =>
      adminService.updateGamemode(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "gamemodes"] });
      closeForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteGamemode(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "gamemodes"] });
      setDeletingGamemode(null);
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => adminService.syncGamemodes(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "gamemodes"] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingGamemode) {
      updateMutation.mutate({ id: editingGamemode.id, data: formData as GamemodeUpdateInput });
    } else {
      createMutation.mutate(formData as GamemodeCreateInput);
    }
  };

  const formInitial = getGamemodeForm(editingGamemode);
  const isFormDirty = (createDialogOpen || !!editingGamemode) && hasUnsavedChanges(formData, formInitial);

  const columns: ColumnDef<Gamemode>[] = [
    {
      accessorKey: "id",
      header: "ID",
      size: 80,
      cell: ({ row }) => <span className="tabular-nums">{row.original.id}</span>,
    },
    {
      accessorKey: "name",
      header: "Name",
    },
    createAliasesColumn<Gamemode>((gamemode) => gamemode.aliases),
    createEntityActionsColumn<Gamemode>({
      entityLabel: "gamemode",
      getName: (gamemode) => gamemode.name,
      isSuperuser,
      onEdit: (gamemode) => {
        updateMutation.reset();
        setEditingGamemode(gamemode);
        setFormData(getGamemodeForm(gamemode));
      },
      onDelete: (gamemode) => setDeletingGamemode(gamemode),
    }),
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Gamemodes"
        description="Manage game modes"
        actions={
          <CatalogToolbarActions
            canSync={isSuperuser}
            isSyncing={syncMutation.isPending}
            onSync={() => syncMutation.mutate()}
            syncLabel="Sync gamemodes from game"
            onCreate={() => {
              createMutation.reset();
              updateMutation.reset();
              setFormData({ ...emptyGamemodeForm });
              setCreateDialogOpen(true);
            }}
            createLabel="Create gamemode"
          />
        }
      />

      <AdminDataTable
        queryKey={(page, search, pageSize, sortField, sortDir) => ["admin", "gamemodes", page, search, pageSize, sortField, sortDir]}
        queryFn={(page, search, pageSize, sortField, sortDir) =>
          adminService.getGamemodes({ page, search, per_page: pageSize, sort: sortField ?? undefined, order: sortDir })
        }
        columns={columns}
        searchPlaceholder="Search gamemodes…"
        emptyMessage="No gamemodes yet. Use “Create gamemode” to add the first one."
        onRowDoubleClick={
          isSuperuser
            ? (row) => {
                const gamemode = row.original;
                updateMutation.reset();
                setEditingGamemode(gamemode);
                setFormData(getGamemodeForm(gamemode));
              }
            : undefined
        }
      />

      {/* Create/Edit Dialog */}
      <EntityFormDialog
        open={createDialogOpen || !!editingGamemode}
        onOpenChange={onEntityDialogClose(closeForm)}
        title={editingGamemode ? "Edit gamemode" : "Create gamemode"}
        description={
          editingGamemode ? "Update gamemode information" : "Create a new gamemode in the game"
        }
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        submittingLabel={editingGamemode ? "Updating gamemode…" : "Creating gamemode…"}
        errorMessage={entityFormError(
          "gamemode",
          !!editingGamemode,
          updateMutation.error,
          createMutation.error
        )}
        isDirty={isFormDirty}
      >
        <div className="space-y-4">
          <CatalogNameField
            id={nameFieldId}
            value={formData.name}
            onChange={(name) => setFormData({ ...formData, name })}
            placeholder="Gamemode name"
          />

          <CatalogAliasesField
            id={aliasesFieldId}
            aliases={formData.aliases}
            onChange={(aliases) => setFormData({ ...formData, aliases })}
            placeholder={"Контроль\nコントロール"}
            helperText="One alias per line — names as they appear in match logs."
          />
        </div>
      </EntityFormDialog>

      {/* Delete Confirmation */}
      {deletingGamemode && (
        <DeleteConfirmDialog
          open={!!deletingGamemode}
          onOpenChange={(open) => !open && setDeletingGamemode(null)}
          onConfirm={() => deleteMutation.mutate(deletingGamemode.id)}
          isDeleting={deleteMutation.isPending}
          title="Delete gamemode"
          description={`“${deletingGamemode.name}” will be permanently removed. Reassign any maps still using it first, otherwise the delete will fail.`}
        />
      )}
    </div>
  );
}
