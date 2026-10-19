"use client";

import { Globe } from "lucide-react";
import { useTranslations } from "next-intl";

import { EYEBROW_CLASS } from "@/components/kit/tone";
import { useFormatter } from "@/lib/datetime/client";
import type { AdminAuthSession } from "@/types/rbac.types";

import { formatTimestamp } from "./model";
import { SessionStatusCell } from "./SessionCells";

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="min-w-0">
      <p className={EYEBROW_CLASS}>{label}</p>
      <div className="mt-0.5 break-words text-sm">{children}</div>
    </div>
  );
}

export function SessionInspectorPanel({ session }: Readonly<{ session: AdminAuthSession }>) {
  const t = useTranslations("adminAccess.common");
  const ts = useTranslations("adminAccess.sessionsUi");
  const format = useFormatter();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("status")}>
          <SessionStatusCell status={session.status} />
        </Field>
        <Field label={ts("network")}>
          <span className="flex items-center gap-1.5">
            <Globe aria-hidden className="size-3.5 text-muted-foreground" />
            <span className="tabular-nums">{session.ip_address ?? t("unavailable")}</span>
          </span>
        </Field>
        <Field label={t("signedIn")}>
          <span className="tabular-nums">{formatTimestamp(format, session.login_at, t("unavailable"))}</span>
        </Field>
        <Field label={t("lastSeen")}>
          <span className="tabular-nums">
            {formatTimestamp(format, session.last_seen_at, t("unavailable"))}
          </span>
        </Field>
        <Field label={t("expires")}>
          <span className="tabular-nums">{formatTimestamp(format, session.expires_at, t("unavailable"))}</span>
        </Field>
        <Field label={t("revoked")}>
          <span className="tabular-nums">
            {session.revoked_at ? formatTimestamp(format, session.revoked_at, t("unavailable")) : ts("notRevoked")}
          </span>
        </Field>
      </div>
      <Field label={ts("sessionId")}>
        <span className="font-mono text-xs tabular-nums">{session.session_id}</span>
      </Field>
      <Field label={ts("userAgent")}>
        <span className="font-mono text-xs">
          {session.user_agent ?? t("userAgentUnavailable")}
        </span>
      </Field>
    </div>
  );
}
