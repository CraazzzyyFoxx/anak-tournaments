"use client";

import { useTranslations } from "next-intl";

import { InspectorField } from "@/components/kit/InspectorField";
import type { RbacPermission } from "@/types/rbac.types";

/** The open permission, read-only: nothing here is editable from the panel. */
export function PermissionInspectorPanel({ permission }: Readonly<{ permission: RbacPermission }>) {
  const t = useTranslations("adminAccess.common");
  const tp = useTranslations("adminAccess.permissionsUi");
  return (
    <div className="space-y-3">
      <InspectorField label={t("description")}>{permission.description}</InspectorField>
      <div className="grid grid-cols-2 gap-3">
        <InspectorField label={t("resource")}>
          <span className="font-mono">{permission.resource}</span>
        </InspectorField>
        <InspectorField label={t("action")}>
          <span className="font-mono">{permission.action}</span>
        </InspectorField>
        <InspectorField label={tp("added")}>
          <span className="tabular-nums">{permission.created_at.slice(0, 10)}</span>
        </InspectorField>
      </div>
      <p className="text-xs text-muted-foreground">{tp("platformNotice")}</p>
    </div>
  );
}
