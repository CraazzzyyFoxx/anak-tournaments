"use client";

import { useId, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  CatalogToolbarActions,
  entityFormError,
  onEntityDialogClose
} from "@/components/admin/CatalogToolbarActions";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import adminService from "@/services/admin.service";
import type { Gamemode, GamemodeCreateInput, GamemodeUpdateInput } from "@/types/admin.types";
import { usePermissions } from "@/hooks/usePermissions";
import { hasUnsavedChanges } from "@/lib/form-change";

const emptyGamemodeForm: GamemodeCreateInput = { name: "" };

export default function GamemodesAdminPage() {
  const queryClient = useQueryClient();
  const { isSuperuser } = usePermissions();
  const formId = useId();
  const nameFieldId = `${formId}-name`;
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

  const formInitial = editingGamemode ? { name: editingGamemode.name } : emptyGamemodeForm;
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
    {
      id: "actions",
      size: 50,
      cell: ({ row }) => {
        const gamemode = row.original;
        if (!isSuperuser) {
          return null;
        }
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label={`Open actions for ${gamemode.name}`} variant="ghost" size="icon">
                <MoreHorizontal aria-hidden className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="truncate">{gamemode.name}</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => {
                  updateMutation.reset();
                  setEditingGamemode(gamemode);
                  setFormData({ name: gamemode.name });
                }}
              >
                <Pencil aria-hidden className="mr-2 h-4 w-4" />
                Edit gamemode
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setDeletingGamemode(gamemode)}
                className="text-destructive"
              >
                <Trash2 aria-hidden className="mr-2 h-4 w-4" />
                Delete gamemode
              </DropdownMenuItem>
            </DropdownMenuContent>
           </DropdownMenu>
         );
      },
    },
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
                setFormData({ name: gamemode.name });
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
          <div className="space-y-2">
            <Label htmlFor={nameFieldId}>Name *</Label>
            <Input
              id={nameFieldId}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Gamemode name"
              required
            />
          </div>
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
