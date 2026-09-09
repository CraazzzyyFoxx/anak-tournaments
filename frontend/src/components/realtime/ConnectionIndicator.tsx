"use client";

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import type { RealtimeConnectionState } from "@/types/realtime.types";

/**
 * Realtime status LED. The words live in `title` / a live region — a labelled
 * pill next to page chrome reads as a third control. Show the label only when
 * the socket is not healthy; connected is just the dot.
 */
export function ConnectionIndicator({
  connectionState,
  className
}: Readonly<{ connectionState: RealtimeConnectionState; className?: string }>) {
  const t = useTranslations("common");
  const connected = connectionState === "connected";
  const label = t(`connection.${connectionState}`);

  return (
    <span
      role="status"
      aria-live="polite"
      title={label}
      className={cn(
        "inline-flex items-center gap-1.5 text-label",
        connected ? "text-[color:var(--aqt-support)]" : "text-[color:var(--aqt-warm)]",
        className
      )}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={
          connected
            ? { background: "var(--aqt-support)", boxShadow: "0 0 6px var(--aqt-support)" }
            : { background: "var(--aqt-warm)" }
        }
      />
      <span className={connected ? "sr-only" : undefined}>{label}</span>
    </span>
  );
}
