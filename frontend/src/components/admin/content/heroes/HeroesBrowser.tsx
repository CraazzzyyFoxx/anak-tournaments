"use client";

import { useCallback, useId, useMemo } from "react";
import { useTranslations } from "next-intl";

import { DataTable } from "@/components/data-table";
import { AssetPreview } from "@/components/admin/AssetPreview";
import { CatalogAliasesField, CatalogNameField } from "@/components/admin/CatalogFormFields";
import { CatalogSyncDialog } from "@/components/admin/CatalogSyncDialog";
import { CatalogToolbarActions } from "@/components/admin/CatalogToolbarActions";
import { FilterBar } from "@/components/kit/FilterBar";
import { useFilters } from "@/components/kit/useFilters";
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
import type { CatalogEntityRead } from "@/types/catalog.types";
import { usePermissions } from "@/hooks/usePermissions";
import { useCatalogEntityCrud } from "@/hooks/useCatalogEntityCrud";
import { useCatalogSync } from "@/hooks/useCatalogSync";
import { catalogQueryKeys } from "@/lib/catalog/query-keys";
import { catalogSort } from "@/lib/catalog/sort";
import type { CatalogKindContext } from "@/app/admin/content/_components/ContentDiscipline";

import { CatalogEntityDialogs } from "../shared";
import { heroFilterDefs } from "./filters";
import { DEFAULT_COLOR, emptyForm, getCharacterForm, toWrite, type CharacterForm } from "./model";
import { useHeroColumns } from "./useHeroColumns";

/** The selected game's characters, under its own word for them ("Hero", "Champion") and its own classes. */
export function HeroesBrowser({ descriptor, discipline, kind, kindLabel }: Readonly<CatalogKindContext>) {
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

  const crud = useCatalogEntityCrud<CatalogEntityRead, CharacterForm, CharacterForm>({
    discipline,
    kind,
    emptyForm: emptyForm(classes),
    getForm: (entity) => getCharacterForm(classes, entity),
    service: {
      create: (d, k, data) => adminService.createCatalogEntity(d, k, toWrite(classes, data)),
      update: (d, k, id, data) => adminService.updateCatalogEntity(d, k, id, toWrite(classes, data)),
      delete: (d, k, id) => adminService.deleteCatalogEntity(d, k, id),
    },
  });
  const { formData, setFormData } = crud;
  const sync = useCatalogSync(discipline);

  const filterDefs = useMemo(() => heroFilterDefs(classes, classLabel, t), [classes, classLabel, t]);
  const filters = useFilters(filterDefs);
  const classFilter = String(filters.values.class ?? "");

  const columns = useHeroColumns({
    kindLabel,
    classes,
    classLabel,
    isSuperuser,
    onEdit: crud.openEdit,
    onDelete: crud.setDeletingEntity,
  });

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
        onRowDoubleClick={isSuperuser ? (row) => crud.openEdit(row.original) : undefined}
        actions={
          <CatalogToolbarActions
            canSync={isSuperuser}
            isSyncing={sync.running}
            onSync={sync.start}
            syncLabel={t("catalog.entity.sync", { game: descriptor.name })}
            onCreate={crud.openCreate}
            createLabel={t("catalog.entity.create", { kind: kindLabel })}
          />
        }
      />

      <CatalogEntityDialogs crud={crud} kindLabel={kindLabel}>
        <CatalogNameField id={nameFieldId} value={formData.name} onChange={(name) => setFormData({ ...formData, name })} />

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
            <Label htmlFor={classFieldId}>{t("columns.class")}</Label>
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
      </CatalogEntityDialogs>

      <CatalogSyncDialog descriptor={descriptor} sync={sync} />
    </>
  );
}
