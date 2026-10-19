import type { DateFormatter } from "@/components/kit/format-time";
import type { Tone } from "@/components/kit/tone";
import { detectBrowser, detectPlatform } from "@/lib/user-agent";
import type { AdminAuthSession, AdminSessionStatus } from "@/types/rbac.types";

export const STATUS_META: Record<AdminSessionStatus, { tone: Tone }> = {
  active: { tone: "success" }, revoked: { tone: "warning" }, expired: { tone: "neutral" }
};

export function formatTimestamp(format: DateFormatter, value: string | null | undefined, unavailable: string): string {
  if (!value) return unavailable;

  return format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" });
}

export function formatDeviceLabel(
  userAgent: string | null | undefined,
  unknownDevice: string
): string {
  if (!userAgent) return unknownDevice;

  const browser = detectBrowser(userAgent);
  const platform = detectPlatform(userAgent);

  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return platform;

  return userAgent.length > 64 ? `${userAgent.slice(0, 64)}…` : userAgent;
}

export function accountsHref(session: AdminAuthSession): string {
  return `/admin/access/accounts?search=${encodeURIComponent(session.email ?? session.username ?? "")}`;
}
