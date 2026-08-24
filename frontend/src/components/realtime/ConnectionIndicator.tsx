"use client";

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import type { RealtimeConnectionState } from "@/types/realtime.types";

/**
 * The realtime connection-status dot + label shared by every surface backed
 * by `useRealtimeStore` (draft, bracket, streams). Originally lived inline in
 * `DraftPageHero`; extracted so bracket/streams can show the same trust
 * signal instead of showing nothing while draft alone had it.
 */
export function ConnectionIndicator({
  connectionState
}: Readonly<{ connectionState: RealtimeConnectionState }>) {
  const t = useTranslations("common");
  const connected = connectionState === "connected";

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px]",
        connected ? "text-[color:var(--aqt-support)]" : "text-[color:var(--aqt-warm)]"
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
      {t(`connection.${connectionState}`)}
    </span>
  );
}
