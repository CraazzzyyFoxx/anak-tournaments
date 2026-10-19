import type { OAuthConnectionAdmin } from "@/types/rbac.types";

export function isTokenExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

/** The Accounts list searched down to the auth account a connection signs in as. */
export function accountsHref(connection: OAuthConnectionAdmin): string {
  const needle = connection.auth_user_username ?? connection.auth_user_email ?? "";
  return `/admin/access/accounts?search=${encodeURIComponent(needle)}`;
}
