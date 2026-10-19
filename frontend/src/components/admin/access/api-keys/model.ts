import type { PermissionCatalogEntry } from "@/components/admin/access/PermissionPicker";
import type { DateFormatter } from "@/components/kit/format-time";
import type { Tone } from "@/components/kit/tone";
import type { AccountApiKey } from "@/types/auth.types";

/**
 * The catalog wildcard: `resource="*" action="*"`. It grants every permission
 * the owner holds, including ones added to the catalog later, so the picker
 * renders it apart from the per-resource groups and locks what it covers.
 */
export const FULL_ACCESS_SCOPE = "admin.*";

export type ApiKeyStatus = "active" | "expired" | "revoked";

export const STATUS_META: Record<ApiKeyStatus, { tone: Tone }> = {
  active: { tone: "success" },
  expired: { tone: "neutral" },
  revoked: { tone: "warning" }
};

export function formatTimestamp(format: DateFormatter, value: string | null | undefined, neverLabel: string): string {
  if (!value) return neverLabel;

  return format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" });
}

export function getApiKeyStatus(apiKey: AccountApiKey): ApiKeyStatus {
  if (apiKey.revoked_at) return "revoked";
  const expiresAt = apiKey.expires_at ? new Date(apiKey.expires_at).getTime() : NaN;
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return "expired";
  return "active";
}

/**
 * `available_scopes` as `PermissionPicker` reads them: concrete grants become
 * catalog entries split at the first dot, and `resource.*` wildcards go apart.
 */
export function scopePickerCatalog(availableScopes: readonly string[]): {
  catalog: PermissionCatalogEntry[];
  wildcards: string[];
} {
  return {
    catalog: availableScopes
      .filter((scope) => !scope.endsWith(".*"))
      .map((scope) => {
        const separator = scope.indexOf(".");
        return {
          key: scope,
          resource: separator > 0 ? scope.slice(0, separator) : scope,
          action: separator > 0 ? scope.slice(separator + 1) : "*"
        };
      }),
    wildcards: availableScopes.filter((scope) => scope.endsWith(".*"))
  };
}
