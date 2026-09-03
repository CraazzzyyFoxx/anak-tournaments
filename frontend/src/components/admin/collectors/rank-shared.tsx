import { TintedBadge } from "@/components/admin/TintedBadge";
import type { Tone } from "@/components/admin/tone";
import type { RankCollectionStats } from "@/types/admin.types";

export { formatDate, formatInterval, formatRelative } from "@/components/admin/format-time";

/** Tone per fetch status, handed to `TintedBadge` as the domain's vocabulary. */
const STATUS_TONES: Record<string, Tone> = {
  ok: "success",
  private: "warning",
  not_found: "warning",
  error: "danger",
  rate_limited: "warning",
  disabled: "neutral",
  pending: "info"
};

/**
 * Solid fill per status, for the stacked distribution bar. The three warning
 * statuses share one hue, so they are separated by alpha instead of by three
 * unrelated palette colours.
 */
export const STATUS_BAR: Record<string, string> = {
  ok: "bg-success",
  pending: "bg-info",
  not_found: "bg-warning",
  private: "bg-warning/70",
  error: "bg-danger",
  rate_limited: "bg-warning/40",
  disabled: "bg-muted-foreground/40"
};

/** Canonical display order for statuses. */
export const STATUS_ORDER = [
  "ok",
  "pending",
  "not_found",
  "private",
  "error",
  "rate_limited",
  "disabled"
] as const;

export function StatusBadge({ status }: Readonly<{ status: string | null }>) {
  return <TintedBadge value={status} tones={STATUS_TONES} fallback="never" />;
}

/**
 * Health marker for the Rank tab of the collectors bar (F14).
 *
 * Ordered by what the operator must act on first: a paused collector explains
 * every other number on the page, and a fleet-wide error rate outranks a
 * handful of tags the worker gave up on. The word is not decoration — the tab
 * renders it `sr-only`, because a dot alone encodes state in colour.
 */
export function rankHealthDot(stats: RankCollectionStats): { tone: Tone; label: string } {
  if (!stats.enabled) return { tone: "neutral", label: "Paused" };
  if ((stats.error_rate_24h ?? 0) >= 0.2) return { tone: "danger", label: "Failing" };
  if ((stats.by_status?.disabled ?? 0) > 0) return { tone: "warning", label: "Degraded" };
  return { tone: "success", label: "Healthy" };
}
