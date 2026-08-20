import { TintedBadge } from "@/components/admin/TintedBadge";
import { TONE_CLASS } from "@/components/admin/tone";

export { formatDate, formatRelative, formatInterval } from "@/components/admin/format-time";

/** Tinted badge classes (border + tint + text) per check state. */
const STATE_STYLES: Record<string, string> = {
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

/** Display wording per check state. The stored values are machine tokens, and a
 *  row that reads "unknown" in lower case is the enum leaking, not a label. */
export const STATE_LABELS: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  unknown: "Unresolved",
  error: "Error"
};

/** Display wording per check trigger. `check_in` in particular must never reach
 *  a table cell with its underscore intact. */
export const SOURCE_LABELS: Record<string, string> = {
  scheduled: "Scheduled sweep",
  registration: "Registration",
  check_in: "Check-in",
  manual: "Manual re-check",
  redeem: "Code redeemed"
};

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

export function StateBadge({ state }: { state: string | null }) {
  return (
    <TintedBadge value={state} styles={STATE_STYLES} labels={STATE_LABELS} fallback="Never checked" />
  );
}
