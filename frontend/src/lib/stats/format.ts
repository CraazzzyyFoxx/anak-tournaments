import type { NumberFormatOptions } from "next-intl";

import type { StatDefinition } from "@/types/discipline.types";

/**
 * The slice of next-intl's formatter this module needs: client components pass `useFormatter()`, server
 * components `await getFormatter()`. A plain module cannot pin a locale itself.
 */
export interface StatFormatter {
  number: (value: number, options?: NumberFormatOptions) => string;
}

/** A missing or non-finite value. Zero is a real value and never prints this. */
const MISSING = "—";

function formatDuration(secondsRaw: number): string {
  const seconds = Math.max(0, Math.floor(secondsRaw));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Display a native stat value by its definition's `value_format` only.
 *
 * Scale is part of the contract, not guessed from labels: `percent` is a 0–1 FRACTION (values over 1.0001 are
 * not a fraction and read as absent), `duration` is SECONDS. Sorting and aggregation always use the raw number,
 * never this string.
 */
export function formatStat(
  def: { value_format: `${StatDefinition["value_format"]}` },
  value: number | null | undefined,
  formatter: StatFormatter
): string {
  if (value == null || !Number.isFinite(value)) return MISSING;
  const num = (v: number) => formatter.number(v, { maximumFractionDigits: 2 });
  switch (def.value_format) {
    case "percent":
      return value > 1.0001 ? MISSING : `${(value * 100).toFixed(1)}%`;
    case "duration":
      return formatDuration(value);
    case "decimal":
      return num(Number(value.toFixed(2)));
    case "integer":
      return num(Math.round(value));
  }
}
