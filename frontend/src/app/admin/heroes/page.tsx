"use client";

import { useId, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AssetPreview } from "@/components/admin/AssetPreview";
import { CatalogAliasesField, CatalogNameField } from "@/components/admin/CatalogFormFields";
import {
  CatalogToolbarActions,
  entityFormError,
  onEntityDialogClose
} from "@/components/admin/CatalogToolbarActions";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { createAliasesColumn, createEntityActionsColumn } from "@/components/admin/catalog-table-columns";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import adminService from "@/services/admin.service";
import type { Hero } from "@/types/hero.types";
import type { HeroCreateInput, HeroUpdateInput } from "@/types/admin.types";
import { usePermissions } from "@/hooks/usePermissions";
import { hasUnsavedChanges } from "@/lib/form-change";

const HERO_ROLES = ["Tank", "Damage", "Support"];
/**
 * Overwatch blue: the form default, the color-picker fallback and the hex hint.
 *
 * Exempt from the design-token rule: `color` is a persisted hero column the
 * admin edits, so this literal is the initial *value* of a data field and is
 * also what `<input type="color">` requires — not chrome this page paints with.
 */
const DEFAULT_HERO_COLOR = "#3b82f6";
// Key order matters: `hasUnsavedChanges` compares JSON, so `getHeroForm` below
// must list the shared fields in the same order or every dialog opens dirty.
const emptyHeroForm: HeroCreateInput = {
  name: "",
  role: "Damage",
  color: DEFAULT_HERO_COLOR,
  aliases: [],
};

/** The backend sends `type`; `role` is the legacy field kept for older payloads. */
function getHeroRoleValue(hero: Hero): string {
  return hero.type || hero.role || emptyHeroForm.role;
}

function getHeroForm(hero: Hero | null): HeroCreateInput | HeroUpdateInput {
  if (!hero) {
    return { ...emptyHeroForm };
  }

  return {
    name: hero.name,
    role: getHeroRoleValue(hero),
    color: hero.color,
    image_path: hero.image_path,
    aliases: hero.aliases ?? [],
  };
}

export default function HeroesAdminPage() {
  const queryClient = useQueryClient();
  const { isSuperuser } = usePermissions();
  const formId = useId();
  const nameFieldId = `${formId}-name`;
  const imageFieldId = `${formId}-image`;
  const roleFieldId = `${formId}-role`;
  const colorFieldId = `${formId}-color`;
  const colorPickerId = `${formId}-color-picker`;
  const aliasesFieldId = `${formId}-aliases`;
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingHero, setEditingHero] = useState<Hero | null>(null);
  const [deletingHero, setDeletingHero] = useState<Hero | null>(null);
  const [formData, setFormData] = useState<HeroCreateInput | HeroUpdateInput>({
    ...emptyHeroForm,
  });

  const closeForm = () => {
    setCreateDialogOpen(false);
    setEditingHero(null);
    setFormData({ ...emptyHeroForm });
  };

  const createMutation = useMutation({
    mutationFn: (data: HeroCreateInput) => adminService.createHero(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "heroes"] });
      closeForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: HeroUpdateInput }) =>
      adminService.updateHero(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "heroes"] });
      closeForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteHero(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "heroes"] });
      setDeletingHero(null);
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => adminService.syncHeroes(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "heroes"] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingHero) {
      updateMutation.mutate({ id: editingHero.id, data: formData as HeroUpdateInput });
    } else {
      createMutation.mutate(formData as HeroCreateInput);
    }
  };

  const formInitial = getHeroForm(editingHero);
  const isFormDirty = (createDialogOpen || !!editingHero) && hasUnsavedChanges(formData, formInitial);

  const columns: ColumnDef<Hero>[] = [
    {
      accessorKey: "id",
      header: "ID",
      size: 44,
      cell: ({ row }) => <span className="tabular-nums">{row.original.id}</span>,
    },
    {
      id: "icon",
      header: () => <div className="text-center">Icon</div>,
      size: 52,
      cell: ({ row }) => {
        const hero = row.original;
        return (
          <div className="flex justify-center">
            <AssetPreview
              imagePath={hero.image_path}
              name={hero.name}
              assetLabel="hero icon"
              shape="circle"
              className="h-10 w-10"
            />
          </div>
        );
      },
    },
    {
      accessorKey: "name",
      header: "Name",
      size: 132,
      cell: ({ row }) => {
        const hero = row.original;
        return (
          <div className="flex items-center gap-2">
            {hero.color && (
              <div
                role="img"
                aria-label={`Hero color ${hero.color}`}
                title={hero.color}
                className="h-4 w-4 rounded-full border border-border"
                style={{ backgroundColor: hero.color }}
              />
            )}
            <span>{hero.name}</span>
          </div>
        );
      },
    },
    {
      id: "role",
      header: () => <div className="text-center">Role</div>,
      size: 48,
      cell: ({ row }) => {
        const role = getHeroRoleValue(row.original);
        return (
          <div className="flex justify-center">
            <div title={role}>
              <PlayerRoleIcon role={role} size={22} decorative />
              <span className="sr-only">{role}</span>
            </div>
          </div>
        );
      },
    },
    createAliasesColumn<Hero>((hero) => hero.aliases),
    createEntityActionsColumn<Hero>({
      entityLabel: "hero",
      getName: (hero) => hero.name,
      isSuperuser,
      onEdit: (hero) => {
        updateMutation.reset();
        setEditingHero(hero);
        setFormData(getHeroForm(hero));
      },
      onDelete: (hero) => setDeletingHero(hero),
    }),
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Heroes"
        description="Manage game heroes and their roles"
        actions={
          <CatalogToolbarActions
            canSync={isSuperuser}
            isSyncing={syncMutation.isPending}
            onSync={() => syncMutation.mutate()}
            syncLabel="Sync heroes from game"
            onCreate={() => {
              createMutation.reset();
              updateMutation.reset();
              setFormData({ ...emptyHeroForm });
              setCreateDialogOpen(true);
            }}
            createLabel="Create hero"
          />
        }
      />

      <AdminDataTable
        queryKey={(page, search, pageSize, sortField, sortDir) => ["admin", "heroes", page, search, pageSize, sortField, sortDir]}
        queryFn={(page, search, pageSize, sortField, sortDir) =>
          adminService.getHeroes({ page, search, per_page: pageSize, sort: sortField ?? undefined, order: sortDir })
        }
        columns={columns}
        searchPlaceholder="Search heroes…"
        emptyMessage="No heroes yet. Use “Create hero” to add the first one."
        onRowDoubleClick={
          isSuperuser
            ? (row) => {
                const hero = row.original;
                updateMutation.reset();
                setEditingHero(hero);
                setFormData(getHeroForm(hero));
              }
            : undefined
        }
      />

      {/* Create/Edit Dialog */}
      <EntityFormDialog
        open={createDialogOpen || !!editingHero}
        onOpenChange={onEntityDialogClose(closeForm)}
        title={editingHero ? "Edit hero" : "Create hero"}
        description={editingHero ? "Update hero information" : "Create a new hero in the game"}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        submittingLabel={editingHero ? "Updating hero…" : "Creating hero…"}
        errorMessage={entityFormError(
          "hero",
          !!editingHero,
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
            placeholder="Hero name"
          />

          <div className="space-y-2">
            <Label htmlFor={imageFieldId}>Hero icon URL</Label>
            <div className="flex items-center gap-3">
              <AssetPreview
                imagePath={formData.image_path}
                name={formData.name || "Hero"}
                assetLabel="hero icon"
                shape="circle"
                className="h-10 w-10 shrink-0"
              />
              <Input
                id={imageFieldId}
                type="url"
                value={formData.image_path || ""}
                onChange={(e) => setFormData({ ...formData, image_path: e.target.value })}
                placeholder="https://overfast.craazzzyyfoxx.me/static/heroes/ana.png"
                className="flex-1"
              />
            </div>
            <p className="text-xs text-muted-foreground">Direct link to the hero portrait.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={roleFieldId}>Role *</Label>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border/70 bg-muted/20">
                <PlayerRoleIcon role={formData.role || emptyHeroForm.role} size={20} />
              </div>
              <Select
                value={formData.role}
                onValueChange={(value) => setFormData({ ...formData, role: value })}
              >
                <SelectTrigger id={roleFieldId} className="flex-1">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {HERO_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      <div className="flex items-center gap-2">
                        <PlayerRoleIcon role={role} size={16} decorative />
                        <span>{role}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={colorFieldId}>Color</Label>
            <div className="flex items-center gap-2">
              <Input
                id={colorPickerId}
                aria-label="Pick hero color"
                type="color"
                value={formData.color || DEFAULT_HERO_COLOR}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="h-10 w-14 shrink-0 cursor-pointer p-1"
              />
              <Input
                id={colorFieldId}
                type="text"
                value={formData.color || ""}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                placeholder={DEFAULT_HERO_COLOR}
                className="flex-1 font-mono"
              />
            </div>
          </div>

          <CatalogAliasesField
            id={aliasesFieldId}
            aliases={formData.aliases}
            onChange={(aliases) => setFormData({ ...formData, aliases })}
            placeholder={"Ана\nアナ"}
            helperText={
              <>
                One alias per line — names as they appear in match logs. The hero sync fills
                these from every Blizzard locale; manual entries survive it.
              </>
            }
          />
        </div>
      </EntityFormDialog>

      {/* Delete Confirmation */}
      {deletingHero && (
        <DeleteConfirmDialog
          open={!!deletingHero}
          onOpenChange={(open) => !open && setDeletingHero(null)}
          onConfirm={() => deleteMutation.mutate(deletingHero.id)}
          isDeleting={deleteMutation.isPending}
          title="Delete hero"
          description={`“${deletingHero.name}” will be permanently removed from the hero catalogue. This cannot be undone.`}
        />
      )}
    </div>
  );
}
