"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { ProviderMark } from "@/components/admin/OAuthProviderMark";
import { InspectorField } from "@/components/kit/InspectorField";
import type { OAuthConnectionAdmin } from "@/types/rbac.types";

import { accountsHref, isTokenExpired } from "./model";

/**
 * What a support question about a connection needs beyond the row: the
 * provider's id, the auth account and the token's expiry.
 */
export function OAuthConnectionInspectorPanel({
  connection
}: Readonly<{ connection: OAuthConnectionAdmin }>) {
  const t = useTranslations("adminAccess.common");
  const expiry = connection.token_expires_at?.slice(0, 10);
  return (
    <div className="grid grid-cols-2 gap-3">
      <InspectorField label={t("provider")}>
        <ProviderMark provider={connection.provider} />
      </InspectorField>
      <InspectorField label={t("providerId")}>
        <span className="break-all font-mono">{connection.provider_user_id}</span>
      </InspectorField>
      <InspectorField label={t("authorization")}>
        <Link href={accountsHref(connection)} className="text-primary hover:underline">
          {connection.auth_user_username ?? t("accountFallback", { id: connection.auth_user_id })}
        </Link>
      </InspectorField>
      <InspectorField label={t("authEmail")}>{connection.auth_user_email}</InspectorField>
      <InspectorField label={t("connected")}>
        <span className="tabular-nums">{connection.created_at.slice(0, 10)}</span>
      </InspectorField>
      <InspectorField label={t("token")}>
        {expiry
          ? isTokenExpired(connection.token_expires_at)
            ? t("tokenExpiredOn", { date: expiry })
            : t("tokenValidUntil", { date: expiry })
          : null}
      </InspectorField>
    </div>
  );
}
