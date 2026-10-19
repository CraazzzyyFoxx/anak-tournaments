"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";

import { DataTable } from "@/components/data-table";
import { CatalogAliasesField, CatalogNameField } from "@/components/admin/CatalogFormFields";
import { CatalogToolbarActions } from "@/components/admin/CatalogToolbarActions";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

import adminService from "@/services/admin.service";
import type { CatalogEntityRead } from "@/types/catalog.types";
import { usePermissions } from "@/hooks/usePermissions";
import { useCatalogEntityCrud } from "@/hooks/useCatalogEntityCrud";
import { catalogQueryKeys } from "@/lib/catalog/query-keys";
import { catalogSort } from "@/lib/catalog/sort";
import type { CatalogKindContext } from "@/app/admin/content/_components/ContentDiscipline";

import { CatalogEntityDialogs } from "../shared";
import { useGamemodeColumns } from "./useGamemodeColumns";

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

export function GamemodesBrowser({ descriptor, discipline, kind, kindLabel }: Readonly<CatalogKindContext>) {
  const t = useTranslations("adminWorkspace.content");
  const { isSuperuser } = usePermissions();
  const formId = useId();
  const nameFieldId = `${formId}-name`;
  const aliasesFieldId = `${formId}-aliases`;

  const crud = useCatalogEntityCrud<CatalogEntityRead, ModeForm, ModeForm>({
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
  const { formData, setFormData } = crud;

  const columns = useGamemodeColumns({
    kindLabel,
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
        onRowDoubleClick={isSuperuser ? (row) => crud.openEdit(row.original) : undefined}
        actions={
          <CatalogToolbarActions
            canSync={isSuperuser}
            isSyncing={crud.syncMutation.isPending}
            onSync={crud.sync}
            syncLabel={t("catalog.entity.sync", { game: descriptor.name })}
            onCreate={crud.openCreate}
            createLabel={t("catalog.entity.create", { kind: kindLabel })}
          />
        }
      />

      <CatalogEntityDialogs crud={crud} kindLabel={kindLabel}>
        <CatalogNameField id={nameFieldId} value={formData.name} onChange={(name) => setFormData({ ...formData, name })} />

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
    </>
  );
}
