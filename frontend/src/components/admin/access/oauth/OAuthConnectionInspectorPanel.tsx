"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { ProviderBadge } from "@/components/admin/OAuthProviderBadge";
import { EYEBROW_CLASS } from "@/components/kit/tone";
import type { OAuthConnectionAdmin } from "@/types/rbac.types";

import { accountsHref, isTokenExpired } from "./model";

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="min-w-0">
      <p className={EYEBROW_CLASS}>{label}</p>
      <div className="mt-0.5 break-words text-sm">{children}</div>
    </div>
  );
}

/** What a support question about a connection needs: both accounts' ids and the token's expiry. */
export function OAuthConnectionInspectorPanel({
  connection
}: Readonly<{ connection: OAuthConnectionAdmin }>) {
  const t = useTranslations("adminAccess.common");
  const to = useTranslations("adminAccess.oauthUi");
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={t("provider")}>
        <ProviderBadge provider={connection.provider} />
      </Field>
      <Field label={t("providerId")}>
        <span className="font-mono tabular-nums">{connection.provider_user_id}</span>
      </Field>
      <Field label={t("providerUsername")}>{connection.username}</Field>
      <Field label={t("providerEmail")}>{connection.email ?? to("notShared")}</Field>
      <Field label={t("authorization")}>
        <Link
          href={accountsHref(connection)}
          className="text-primary hover:underline"
        >
          {connection.auth_user_username ?? `#${connection.auth_user_id}`}
        </Link>
      </Field>
      <Field label={t("authEmail")}>{connection.auth_user_email ?? t("unavailable")}</Field>
      <Field label={t("connected")}>
        <span className="tabular-nums">{connection.created_at.slice(0, 10)}</span>
      </Field>
      <Field label={t("token")}>
        {connection.token_expires_at
          ? isTokenExpired(connection.token_expires_at)
            ? t("tokenExpiredOn", { date: connection.token_expires_at.slice(0, 10) })
            : t("tokenValidUntil", { date: connection.token_expires_at.slice(0, 10) })
          : t("noStoredToken")}
      </Field>
    </div>
  );
}
