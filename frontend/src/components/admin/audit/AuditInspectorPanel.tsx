"use client";

import { useTranslations } from "next-intl";

import { AuditFieldDiff } from "@/components/kit/AuditTrail";
import { InspectorField } from "@/components/kit/InspectorField";
import type { AuditLogRead } from "@/types/admin.types";

/** One journal entry: why, the field diff, and where the write came from. */
export function AuditInspectorPanel({ row }: Readonly<{ row: AuditLogRead }>) {
  const t = useTranslations("adminMatches.audit");

  return (
    <div className="space-y-4">
      <InspectorField label={t("reason")}>{row.reason}</InspectorField>
      <InspectorField label={t("changes")}>
        <AuditFieldDiff before={row.before_json} after={row.after_json} />
      </InspectorField>
      <InspectorField label={t("workspace")}>
        {row.workspace_id == null ? t("everyWorkspace") : `#${row.workspace_id}`}
      </InspectorField>
      <InspectorField label={t("ipAddress")}>
        {row.ip_address ? <span className="font-mono">{row.ip_address}</span> : null}
      </InspectorField>
      <InspectorField label={t("userAgent")}>{row.user_agent}</InspectorField>
      <InspectorField label={t("correlationId")}>
        {row.correlation_id ? <span className="break-all font-mono">{row.correlation_id}</span> : null}
      </InspectorField>
    </div>
  );
}
