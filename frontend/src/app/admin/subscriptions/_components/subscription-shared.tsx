import { Badge } from "@/components/ui/badge";
import { TONE_CLASS } from "@/components/admin/tone";

/** Tinted badge classes (border + tint + text) per check state. */
export const STATE_STYLES: Record<string, string> = {
  active: TONE_CLASS.success,
  inactive: TONE_CLASS.warning,
  unknown: TONE_CLASS.info,
  error: TONE_CLASS.danger
};

/** Solid fill per state, for the stacked distribution bar. */
export const STATE_BAR: Record<string, string> = {
  active: "bg-success",
  inactive: "bg-warning",
  unknown: "bg-info",
  error: "bg-danger"
};

/** Canonical display order for states. */
export const STATE_ORDER = ["active", "inactive", "unknown", "error"] as const;

/** Providers the subscription domain can verify. Lookups fall back to the raw
 *  key, so a provider added backend-side still renders, just less prettily. */
export const PROVIDER_LABELS: Record<string, string> = {
  boosty: "Boosty",
  twitch: "Twitch"
};

/**
 * Human wording for the reason codes the provider resolvers emit.
 *
 * The raw code is the fallback rather than a generic string: a reason added
 * backend-side must still be readable here, just less prettily.
 */
export const REASON_LABELS: Record<string, string> = {
  not_subscribed: "not subscribed",
  not_a_member: "not in the Discord server",
  no_mapped_role: "no matching role",
  no_code_redeemed: "no code redeemed",
  code_redeemed: "code redeemed",
  no_linked_discord_account: "Discord not linked",
  no_linked_twitch_account: "Twitch not linked",
  missing_scope: "Twitch scope missing — needs reconnect",
  broadcaster_not_configured: "broadcaster not configured",
  broadcaster_not_eligible: "broadcaster not eligible",
  guild_not_configured: "guild not configured",
  guild_not_accessible: "bot cannot read the guild",
  bot_not_configured: "our Discord bot token is not configured",
  twitch_client_not_configured: "our Twitch client id is not configured",
  no_role_tiers_configured: "no role tiers configured",
  role_mapping_drift: "role mapping drifted",
  provider_not_configured: "provider not configured",
  provider_disabled: "provider disabled",
  no_codes_configured: "no codes configured",
  no_strategy_for_provider: "no strategy for provider",
  provider_unavailable: "provider unavailable",
  strategy_error: "provider call failed",
  not_resolved: "provider gave no answer"
};

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

/** Compact "5m ago" / "2h ago" style relative time; falls back to "—". */
export function formatRelative(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return "just now";
  const mins = Math.round(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function formatInterval(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

export function StateBadge({ state }: { state: string | null }) {
  return (
    <Badge variant="outline" className={STATE_STYLES[state ?? ""] ?? TONE_CLASS.neutral}>
      {state ?? "never"}
    </Badge>
  );
}
