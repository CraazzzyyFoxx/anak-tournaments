import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Localized inclusive date range, e.g. `Jan 15 – 20, 2026` / `15–20 янв. 2026 г.`
 *
 * `locale` is REQUIRED on purpose. It used to default to `"ru"`, and the two
 * call sites that omitted it rendered Russian dates inside the English UI —
 * next to an English date in the very same table row. Making it required lets
 * the compiler find every such site.
 *
 * `Intl.DateTimeFormat.formatRange` collapses the shared month/year itself and
 * uses the locale's own range separator, so no manual string assembly is
 * needed. It has been Baseline since 2021; the `formatRange`-less path is kept
 * only as a defensive fallback.
 */
export function formatDateRange(
  startDate: Date | string,
  endDate: Date | string,
  locale: string
): string {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const resolved = locale.startsWith("ru") ? "ru-RU" : "en-US";

  const formatter = new Intl.DateTimeFormat(resolved, {
    day: "numeric",
    month: "short",
    year: "numeric"
  });

  if (typeof formatter.formatRange === "function") {
    return formatter.formatRange(start, end);
  }
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

export function hexToRgba(hex: string, alpha: number): string | null {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }

  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

