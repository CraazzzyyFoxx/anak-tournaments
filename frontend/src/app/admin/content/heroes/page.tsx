"use client";

import { useCallback, useId, useMemo } from "react";
import { useTranslations } from "next-intl";
import { ColumnDef } from "@tanstack/react-table";
import { Pencil, Trash2 } from "lucide-react";

import { DataTable, columnMeta, createKebabColumn } from "@/components/data-table";
import { AssetPreview } from "@/components/admin/AssetPreview";
import { CatalogAliasesField, CatalogNameField } from "@/components/admin/CatalogFormFields";
import { CatalogToolbarActions, entityFormError, onEntityDialogClose } from "@/components/admin/CatalogToolbarActions";
import { EntityFormDialog } from "@/components/kit/EntityFormDialog";
import { createAliasesColumn } from "@/components/admin/catalog-table-columns";
import { FilterBar } from "@/components/kit/FilterBar";
import { useFilters, type FilterDef } from "@/components/kit/useFilters";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
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
import { useCatalogEntityCrud } from "@/hooks/useCatalogEntityCrud";
import { adminQueryKeys } from "@/lib/admin/query-keys";

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
  const t = useTranslations("adminWorkspace.content");
  const roleLabel = useCallback(
    (role: string) =>
      role === "Tank"
        ? t("heroRoles.tank")
        : role === "Damage"
          ? t("heroRoles.damage")
          : role === "Support"
            ? t("heroRoles.support")
            : role,
    [t]
  );
  const { isSuperuser } = usePermissions();
  const formId = useId();
  const nameFieldId = `${formId}-name`;
  const imageFieldId = `${formId}-image`;
  const roleFieldId = `${formId}-role`;
  const colorFieldId = `${formId}-color`;
  const colorPickerId = `${formId}-color-picker`;
  const aliasesFieldId = `${formId}-aliases`;

  const {
    formData,
    setFormData,
    editingEntity: editingHero,
    deletingEntity: deletingHero,
    setDeletingEntity: setDeletingHero,
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
  } = useCatalogEntityCrud<Hero, HeroCreateInput, HeroUpdateInput>({
    queryKey: adminQueryKeys.contentEntity("heroes"),
    emptyForm: emptyHeroForm,
    getForm: getHeroForm,
    service: {
      create: (data) => adminService.createHero(data),
      update: (id, data) => adminService.updateHero(id, data),
      delete: (id) => adminService.deleteHero(id),
      sync: () => adminService.syncHeroes(),
    },
  });

  const filterDefs = useMemo<FilterDef[]>(
    () => [
      {
        key: "role",
        label: t("filters.role"),
        kind: "single",
        options: HERO_ROLES.map((role) => ({ value: role, label: roleLabel(role) })),
      },
    ],
    [roleLabel, t]
  );
  const filters = useFilters(filterDefs);
  const roleFilter = String(filters.values.role ?? "");

  const columns: ColumnDef<Hero>[] = [
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
      meta: columnMeta<Hero>({ align: "center" }),
      cell: ({ row }) => {
        const hero = row.original;
        return (
          <AssetPreview
            imagePath={hero.image_path}
            name={hero.name}
            assetLabel={t("catalog.hero.iconUrl")}
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
        const hero = row.original;
        return (
          <div className="flex items-center gap-2">
            {hero.color && (
              <div
                role="img"
                aria-label={t("catalog.hero.pickColorWithValue", { color: hero.color })}
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
      header: t("columns.role"),
      size: 48,
      meta: columnMeta<Hero>({ align: "center" }),
      cell: ({ row }) => {
        const role = getHeroRoleValue(row.original);
        return (
          <div title={roleLabel(role)}>
            <PlayerRoleIcon role={role} size={22} decorative />
            <span className="sr-only">{roleLabel(role)}</span>
          </div>
        );
      },
    },
    createAliasesColumn<Hero>((hero) => hero.aliases, t("columns.aliases")),
    createKebabColumn<Hero>(
      (hero) => [
        {
          label: t("actions.editHero"),
          icon: Pencil,
          hidden: !isSuperuser,
          onSelect: () => openEdit(hero),
        },
        {
          label: t("actions.deleteHero"),
          icon: Trash2,
          destructive: true,
          hidden: !isSuperuser,
          onSelect: () => setDeletingHero(hero),
        },
      ],
      { rowLabel: (hero) => hero.name }
    ),
  ];

  return (
    <>
      <DataTable
        queryKey={(page, search, pageSize, sortField, sortDir) => ["admin", "heroes", page, search, pageSize, sortField, sortDir, roleFilter]}
        queryFn={(page, search, pageSize, sortField, sortDir) =>
          adminService.getHeroes({
            page,
            search,
            per_page: pageSize,
            role: roleFilter || undefined,
            sort: sortField ?? undefined,
            order: sortDir,
          })
        }
        columns={columns}
        searchPlaceholder={t("catalog.hero.search")}
        filterKey={filters.filterKey}
        toolbar={<FilterBar defs={filterDefs} filters={filters} />}
        emptyMessage={t("catalog.hero.empty")}
        onRowDoubleClick={isSuperuser ? (row) => openEdit(row.original) : undefined}
        actions={
          <CatalogToolbarActions
            canSync={isSuperuser}
            isSyncing={syncMutation.isPending}
            onSync={() => syncMutation.mutate()}
            syncLabel={t("catalog.hero.sync")}
            onCreate={openCreate}
            createLabel={t("catalog.hero.create")}
          />
        }
      />

      {/* Create/Edit Dialog */}
      <EntityFormDialog
        open={isDialogOpen}
        onOpenChange={onEntityDialogClose(closeForm)}
        title={editingHero ? t("catalog.hero.updateTitle") : t("catalog.hero.createTitle")}
        description={editingHero ? t("catalog.hero.descriptionUpdate") : t("catalog.hero.descriptionCreate")}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        submittingLabel={editingHero ? t("catalog.hero.updating") : t("catalog.hero.creating")}
        errorMessage={entityFormError(
          "hero",
          !!editingHero,
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
            placeholder={t("catalog.hero.namePlaceholder")}
          />

          <div className="space-y-2">
            <Label htmlFor={imageFieldId}>{t("catalog.hero.iconUrl")}</Label>
            <div className="flex items-center gap-3">
              <AssetPreview
                imagePath={formData.image_path}
                name={formData.name || t("catalog.heroEntity")}
                assetLabel={t("catalog.hero.iconUrl")}
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
            <p className="text-xs text-muted-foreground">{t("catalog.hero.iconLink")}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={roleFieldId}>{t("catalog.hero.roleRequired")}</Label>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border/70 bg-muted/20">
                <PlayerRoleIcon role={formData.role || emptyHeroForm.role} size={20} />
              </div>
              <Select
                value={formData.role}
                onValueChange={(value) => setFormData({ ...formData, role: value })}
              >
                <SelectTrigger id={roleFieldId} className="flex-1">
                  <SelectValue placeholder={t("catalog.hero.selectRole")} />
                </SelectTrigger>
                <SelectContent>
                  {HERO_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      <div className="flex items-center gap-2">
                        <PlayerRoleIcon role={role} size={16} decorative />
                        <span>{roleLabel(role)}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={colorFieldId}>{t("catalog.hero.color")}</Label>
            <div className="flex items-center gap-2">
              <Input
                id={colorPickerId}
                aria-label={t("catalog.hero.pickColor")}
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
              {t("catalog.hero.aliasesHelp")}
              </>
            }
          />
        </div>
      </EntityFormDialog>

      {/* Delete Confirmation */}
      {deletingHero && (
        <ConfirmDialog
          open={!!deletingHero}
          onOpenChange={(open) => !open && setDeletingHero(null)}
          onConfirm={() => deleteMutation.mutate(deletingHero.id)}
          pending={deleteMutation.isPending}
          intent={{
            title: t("catalog.hero.deleteTitle"),
            description: t("catalog.hero.deleteDescription", { name: deletingHero.name }),
            confirmLabel: t("actions.delete"),
            tone: "danger",
          }}
        />
      )}
    </>
  );
}
