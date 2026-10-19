"use client";

import { useTranslations } from "next-intl";

import { EYEBROW_CLASS } from "@/components/kit/tone";
import type { RbacPermission } from "@/types/rbac.types";

/** The open permission, read-only: nothing here is editable from the panel. */
export function PermissionInspectorPanel({ permission }: Readonly<{ permission: RbacPermission }>) {
  const t = useTranslations("adminAccess.common");
  const tp = useTranslations("adminAccess.permissionsUi");
  return (
    <div className="space-y-3">
      <div>
        <p className={EYEBROW_CLASS}>{t("description")}</p>
        <p className="mt-0.5 text-sm">
          {permission.description || tp("noDescription")}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className={EYEBROW_CLASS}>{t("resource")}</p>
          <p className="mt-0.5 font-mono text-sm">{permission.resource}</p>
        </div>
        <div>
          <p className={EYEBROW_CLASS}>{t("action")}</p>
          <p className="mt-0.5 font-mono text-sm">{permission.action}</p>
        </div>
        <div>
          <p className={EYEBROW_CLASS}>{tp("id")}</p>
          <p className="mt-0.5 font-mono text-sm tabular-nums">#{permission.id}</p>
        </div>
        <div>
          <p className={EYEBROW_CLASS}>{tp("added")}</p>
          <p className="mt-0.5 text-sm tabular-nums">{permission.created_at.slice(0, 10)}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {tp("platformNotice")}
      </p>
    </div>
  );
}
