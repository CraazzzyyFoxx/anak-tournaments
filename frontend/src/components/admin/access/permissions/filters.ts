import { useMemo } from "react";
import { useTranslations } from "next-intl";

import type { FilterDef } from "@/components/kit/useFilters";
import type { RbacPermission } from "@/types/rbac.types";

/**
 * The resource and action chips. Their options are derived from the inventory
 * itself, so a resource added on the backend becomes a chip without a release.
 */
export function usePermissionFilterDefs(permissions: readonly RbacPermission[]): FilterDef[] {
  const t = useTranslations("adminAccess.common");
  return useMemo<FilterDef[]>(() => {
    const resources = [...new Set(permissions.map((permission) => permission.resource))].sort();
    const actions = [...new Set(permissions.map((permission) => permission.action))].sort();
    return [
      {
        key: "resource",
        label: t("resource"),
        kind: "single",
        options: resources.map((resource) => ({ value: resource, label: resource }))
      },
      {
        key: "action",
        label: t("action"),
        kind: "single",
        options: actions.map((action) => ({ value: action, label: action }))
      }
    ];
  }, [permissions, t]);
}
