import { useState } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { invalidateCatalogSync } from "@/lib/catalog/invalidate";
import { catalogQueryKeys, type CatalogScope } from "@/lib/catalog/query-keys";
import { hasUnsavedChanges } from "@/lib/form-change";
import type { CatalogKind } from "@/types/catalog.types";

interface CatalogEntityService<TEntity, TCreate, TUpdate> {
  create: (discipline: string, kind: CatalogKind, data: TCreate) => Promise<TEntity>;
  update: (discipline: string, kind: CatalogKind, id: number, data: TUpdate) => Promise<TEntity>;
  delete: (discipline: string, kind: CatalogKind, id: number) => Promise<void>;
  /** Pulls the whole discipline (every kind) from the module's source. */
  sync: (discipline: string) => Promise<unknown>;
}

interface UseCatalogEntityCrudOptions<TEntity, TCreate, TUpdate> {
  discipline: string;
  kind: CatalogKind;
  /** Key order matters: `hasUnsavedChanges` compares JSON, so `getForm` below
   *  must list the same fields in the same order or every dialog opens dirty. */
  emptyForm: TCreate;
  getForm: (entity: TEntity | null) => TCreate | TUpdate;
  service: CatalogEntityService<TEntity, TCreate, TUpdate>;
}

/** The discipline and kind a mutation was submitted for: fixed at submit, so a later switch cannot redirect it. */
interface Submitted extends CatalogScope {
  kind: CatalogKind;
}

const invalidateKind = (client: QueryClient, { discipline, kind }: Submitted) =>
  client.invalidateQueries({ queryKey: catalogQueryKeys.kind({ discipline }, kind) });

/**
 * Create/edit/delete/sync state and mutations shared by the game-catalogue admin
 * pages (characters, maps, modes of the selected discipline): same
 * dialog-as-create-and-edit pattern, same invalidate-on-success mutations, same
 * dirty-check. Pages keep their own columns and form fields — only this
 * boilerplate lives here instead of being copy-pasted three times.
 *
 * Create, edit and delete drop that kind's caches; sync drops the whole discipline (it pulls every kind) plus its
 * statistic families. Each invalidates the discipline it was submitted for, even if the page has switched games
 * by the time the request settles.
 */
export function useCatalogEntityCrud<TEntity extends { id: number }, TCreate, TUpdate>({
  discipline,
  kind,
  emptyForm,
  getForm,
  service,
}: UseCatalogEntityCrudOptions<TEntity, TCreate, TUpdate>) {
  const queryClient = useQueryClient();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingEntity, setEditingEntity] = useState<TEntity | null>(null);
  const [deletingEntity, setDeletingEntity] = useState<TEntity | null>(null);
  const [formData, setFormData] = useState<TCreate | TUpdate>({ ...emptyForm });

  const closeForm = () => {
    setCreateDialogOpen(false);
    setEditingEntity(null);
    setFormData({ ...emptyForm });
  };

  const createMutation = useMutation({
    mutationFn: ({ scope, data }: { scope: Submitted; data: TCreate }) =>
      service.create(scope.discipline, scope.kind, data),
    onSuccess: (_entity, { scope }) => {
      invalidateKind(queryClient, scope);
      closeForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ scope, id, data }: { scope: Submitted; id: number; data: TUpdate }) =>
      service.update(scope.discipline, scope.kind, id, data),
    onSuccess: (_entity, { scope }) => {
      invalidateKind(queryClient, scope);
      closeForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ scope, id }: { scope: Submitted; id: number }) =>
      service.delete(scope.discipline, scope.kind, id),
    onSuccess: (_result, { scope }) => {
      invalidateKind(queryClient, scope);
      setDeletingEntity(null);
    },
  });

  const syncMutation = useMutation({
    mutationFn: ({ scope }: { scope: Submitted }) => service.sync(scope.discipline),
    onSuccess: (_result, { scope }) => invalidateCatalogSync(queryClient, scope.discipline),
  });

  const submitted = (): Submitted => ({ discipline, kind });

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
      updateMutation.mutate({ scope: submitted(), id: editingEntity.id, data: formData as TUpdate });
    } else {
      createMutation.mutate({ scope: submitted(), data: formData as TCreate });
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
    /** Each captures the discipline and kind of the render that called it. */
    deleteEntity: (id: number) => deleteMutation.mutate({ scope: submitted(), id }),
    sync: () => syncMutation.mutate({ scope: submitted() }),
  };
}
