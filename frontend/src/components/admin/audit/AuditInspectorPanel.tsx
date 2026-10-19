"use client";

import { useTranslations } from "next-intl";

import { AuditFieldDiff } from "@/components/kit/AuditTrail";
import { auditSourceLabel, useAuditTranslator } from "@/components/kit/audit-log";
import { EYEBROW_CLASS } from "@/components/kit/tone";
import type { AuditLogRead } from "@/types/admin.types";

/** One journal entry: why, the field diff, and where the write came from. */
export function AuditInspectorPanel({ row }: Readonly<{ row: AuditLogRead }>) {
  const t = useTranslations("adminMatches.audit");
  const auditT = useAuditTranslator();

  const meta: Array<{ label: string; value: string }> = [
    { label: t("source"), value: auditSourceLabel(row.source, auditT) },
    {
      label: t("workspace"),
      value: row.workspace_id == null ? t("everyWorkspace") : `#${row.workspace_id}`,
    },
    ...(row.ip_address ? [{ label: t("ipAddress"), value: row.ip_address }] : []),
    ...(row.user_agent ? [{ label: t("userAgent"), value: row.user_agent }] : []),
    ...(row.correlation_id ? [{ label: t("correlationId"), value: row.correlation_id }] : []),
    { label: t("entry"), value: `#${row.id}` },
  ];

  return (
    <div className="space-y-4">
      {row.reason ? (
        <div className="space-y-1">
          <h3 className={EYEBROW_CLASS}>{t("reason")}</h3>
          <p className="text-sm">{row.reason}</p>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <h3 className={EYEBROW_CLASS}>{t("changes")}</h3>
        <AuditFieldDiff before={row.before_json} after={row.after_json} />
      </div>

      <dl className="grid gap-x-4 gap-y-1.5 border-t border-border/40 pt-3 text-xs">
        {meta.map((item) => (
          <div key={item.label} className="flex min-w-0 items-baseline gap-1.5">
            <dt className="shrink-0 text-muted-foreground">{item.label}:</dt>
            <dd className="min-w-0 break-all font-mono text-foreground/80">{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
