"use client";

import { useTranslations } from "next-intl";

import { AccessStatusCell } from "@/components/admin/access/AccessStatusCell";
import { InspectorField } from "@/components/kit/InspectorField";
import { useFormatter } from "@/lib/datetime/client";
import type { AdminAuthSession } from "@/types/rbac.types";

import { formatTimestamp } from "./model";

export function SessionInspectorPanel({ session }: Readonly<{ session: AdminAuthSession }>) {
  const t = useTranslations("adminAccess.common");
  const ts = useTranslations("adminAccess.sessionsUi");
  const format = useFormatter();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <InspectorField label={t("status")}>
          <AccessStatusCell status={session.status} showActive />
        </InspectorField>
        <InspectorField label={ts("network")}>
          {session.ip_address ? <span className="tabular-nums">{session.ip_address}</span> : null}
        </InspectorField>
        <InspectorField label={t("signedIn")}>
          {session.login_at ? (
            <span className="tabular-nums">{formatTimestamp(format, session.login_at)}</span>
          ) : null}
        </InspectorField>
        <InspectorField label={t("lastSeen")}>
          {session.last_seen_at ? (
            <span className="tabular-nums">{formatTimestamp(format, session.last_seen_at)}</span>
          ) : null}
        </InspectorField>
        <InspectorField label={t("expires")}>
          {session.expires_at ? (
            <span className="tabular-nums">{formatTimestamp(format, session.expires_at)}</span>
          ) : null}
        </InspectorField>
        <InspectorField label={t("revoked")}>
          {session.revoked_at ? (
            <span className="tabular-nums">{formatTimestamp(format, session.revoked_at)}</span>
          ) : null}
        </InspectorField>
      </div>
      <InspectorField label={ts("sessionId")}>
        <span className="break-all font-mono text-xs">{session.session_id}</span>
      </InspectorField>
      <InspectorField label={ts("userAgent")}>
        {session.user_agent ? (
          <span className="break-words font-mono text-xs">{session.user_agent}</span>
        ) : null}
      </InspectorField>
    </div>
  );
}
