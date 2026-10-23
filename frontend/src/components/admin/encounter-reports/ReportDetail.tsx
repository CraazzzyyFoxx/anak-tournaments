"use client";

import { InspectorField, InspectorSection } from "@/components/kit/InspectorField";
import { useFormatter } from "@/lib/datetime/client";
import { useTranslations } from "next-intl";
import type { AdminCaptainReport } from "@/types/admin.types";
import type { ReplayCode, ReportCustomFieldDefinition } from "@/types/encounter.types";

import { fmtDate, replayCodesText, submittedAt } from "./report-model";

/**
 * Everything one captain filed, in full.
 *
 * The table cell is a summary by necessity; this is the surface an admin
 * settling a dispute reads, so it withholds nothing the report carries —
 * including the organizer's own questions, whose labels come from the
 * tournament's report form rather than the raw storage keys. A field the
 * captain left blank is simply absent.
 */
export function ReportDetail({
  label,
  teamName,
  standing,
  report,
  replayCodes,
  customFields
}: Readonly<{
  label: string;
  teamName: string;
  /** What the report claims, in slot order: `2 – 1`. */
  standing: string;
  report: AdminCaptainReport | null;
  /** This participation's codes by position (`game_team.replay_code`). */
  replayCodes: ReplayCode[];
  customFields: ReportCustomFieldDefinition[];
}>) {
  const format = useFormatter();
  const t = useTranslations("adminMatches.reports");
  const title = `${label} · ${teamName}`;
  if (!report) {
    return (
      <InspectorSection title={title}>
        <p className="text-sm text-muted-foreground">{t("noReport")}</p>
      </InspectorSection>
    );
  }

  // Answers to questions the form no longer defines still happened, so they are
  // listed under their key rather than dropped with the definition.
  const known = new Set(customFields.map((field) => field.key));
  const extras = Object.entries(report.custom_fields).filter(([key]) => !known.has(key));

  return (
    <InspectorSection title={title}>
      <div className="space-y-3">
        <p className="text-sm font-semibold tabular-nums">{standing}</p>
        <InspectorField label={t("reportedBy")}>{report.reporter_name ?? t("unknown")}</InspectorField>
        <InspectorField label={t("submitted")}>
          <span className="tabular-nums">{fmtDate(format, submittedAt(report))}</span>
        </InspectorField>
        <InspectorField label={t("closeness")}>
          {report.closeness == null ? null : <span className="tabular-nums">{report.closeness}/10</span>}
        </InspectorField>
        <InspectorField label={t("lobbyCodes")}>
          {replayCodes.length > 0 ? <span className="font-mono text-xs">{replayCodesText(replayCodes)}</span> : null}
        </InspectorField>
        <InspectorField label={t("comment")}>
          {report.comment ? <span className="break-words">{report.comment}</span> : null}
        </InspectorField>
        {customFields.map((field) => (
          <InspectorField key={field.key} label={field.label}>
            {report.custom_fields[field.key] ? (
              <span className="break-words">{report.custom_fields[field.key]}</span>
            ) : null}
          </InspectorField>
        ))}
        {extras.map(([key, value]) => (
          <InspectorField key={key} label={key}>
            <span className="break-words">{value}</span>
          </InspectorField>
        ))}
      </div>
    </InspectorSection>
  );
}
