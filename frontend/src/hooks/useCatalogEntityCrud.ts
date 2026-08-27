import { useState } from "react";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";

import { hasUnsavedChanges } from "@/lib/form-change";

interface CatalogEntityService<TEntity, TCreate, TUpdate> {
  create: (data: TCreate) => Promise<TEntity>;
  update: (id: number, data: TUpdate) => Promise<TEntity>;
  delete: (id: number) => Promise<void>;
  sync: () => Promise<unknown>;
}

interface UseCatalogEntityCrudOptions<TEntity, TCreate, TUpdate> {
  /** Invalidated on every mutation success; pass the same key the list uses. */
  queryKey: QueryKey;
  /** Key order matters: `hasUnsavedChanges` compares JSON, so `getForm` below
   *  must list the same fields in the same order or every dialog opens dirty. */
  emptyForm: TCreate;
  getForm: (entity: TEntity | null) => TCreate | TUpdate;
  service: CatalogEntityService<TEntity, TCreate, TUpdate>;
}

/**
 * Create/edit/delete/sync state and mutations shared by the game-catalogue
 * admin pages (maps, heroes, gamemodes): same dialog-as-create-and-edit
 * pattern, same invalidate-on-success mutations, same dirty-check. Pages keep
 * their own columns and form fields — only this boilerplate lives here
 * instead of being copy-pasted three times.
 */
export function useCatalogEntityCrud<TEntity extends { id: number }, TCreate, TUpdate>({
  queryKey,
  emptyForm,
  getForm,
  service,
}: UseCatalogEntityCrudOptions<TEntity, TCreate, TUpdate>) {
  const queryClient = useQueryClient();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingEntity, setEditingEntity] = useState<TEntity | null>(null);
  const [deletingEntity, setDeletingEntity] = useState<TEntity | null>(null);
  const [formData, setFormData] = useState<TCreate | TUpdate>({ ...emptyForm });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const closeForm = () => {
    setCreateDialogOpen(false);
    setEditingEntity(null);
    setFormData({ ...emptyForm });
  };

  const createMutation = useMutation({
    mutationFn: (data: TCreate) => service.create(data),
    onSuccess: () => {
      invalidate();
      closeForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: TUpdate }) => service.update(id, data),
    onSuccess: () => {
      invalidate();
      closeForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => service.delete(id),
    onSuccess: () => {
      invalidate();
      setDeletingEntity(null);
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => service.sync(),
    onSuccess: invalidate,
  });

  const openCreate = () => {
    createMutation.reset();
    updateMutation.reset();
    setFormData({ ...emptyForm });
    setCreateDialogOpen(true);
  };

  const openEdit = (entity: TEntity) => {
    updateMutation.reset();
    setEditingEntity(entity);
    setFormData(getForm(entity));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingEntity) {
      updateMutation.mutate({ id: editingEntity.id, data: formData as TUpdate });
    } else {
      createMutation.mutate(formData as TCreate);
    }
  };

  const isDialogOpen = createDialogOpen || !!editingEntity;
  const isFormDirty = isDialogOpen && hasUnsavedChanges(formData, getForm(editingEntity));

  return {
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
    syncMutation,
  };
}
