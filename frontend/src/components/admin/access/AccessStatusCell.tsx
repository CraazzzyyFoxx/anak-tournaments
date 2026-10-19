"use client";

import { useTranslations } from "next-intl";

import { StatusPill } from "@/components/kit/StatusPill";
import { StatusDot } from "@/components/ui/status-dot";

/**
 * Status of a session or an API key. `active` is a live pill where it wants
 * attention (a signed-in session) and nothing where it is the norm (a key);
 * `expired` and `revoked` are finished, so a muted dot and word.
 */
export function AccessStatusCell({
  status,
  activePill
}: Readonly<{ status: "active" | "expired" | "revoked"; activePill: boolean }>) {
  const t = useTranslations("adminAccess.common");
  if (status === "active") {
    return activePill ? (
      <StatusPill tone="success" dot>
        {t("active")}
      </StatusPill>
    ) : null;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <StatusDot />
      {t(status)}
    </span>
  );
}
