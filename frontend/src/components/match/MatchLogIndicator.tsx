"use client";

import React, { useState } from "react";
import { ScrollText, FileDown, FileX } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface MatchLogRef {
  matchId: number;
  label?: string;
}

interface MatchLogIndicatorProps {
  /** Whether the encounter has any logs (authoritative availability flag). */
  hasLogs: boolean;
  /** Per-match downloadable logs within this encounter. When omitted, the
   *  indicator is informational only. */
  logs?: MatchLogRef[];
  size?: number;
  className?: string;
}

/** Direct, browser-navigable download URL for a match's parsed log. */
const matchLogDownloadUrl = (matchId: number) => `/api/v1/matches/${matchId}/log`;

const BASE =
  "inline-flex h-7 w-7 items-center justify-center rounded-[7px] border transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const HAS =
  "border-[color:color-mix(in_srgb,var(--aqt-emerald)_30%,transparent)] " +
  "bg-[color:color-mix(in_srgb,var(--aqt-emerald)_10%,transparent)] text-[color:var(--aqt-emerald)]";
const NONE = "border-border text-[color:var(--aqt-fg-faint)]";

const stop = (e: React.MouseEvent) => e.stopPropagation();

/**
 * Global indicator for match-log availability with download. Theme-agnostic
 * (uses shared tokens, no page-scoped vars) so it renders correctly anywhere
 * encounters are shown.
 * - no logs → dimmed, non-interactive;
 * - logs without per-match refs → emerald icon, "Logs available";
 * - one downloadable log → direct download link;
 * - several → click opens a popover listing each map's log.
 */
const MatchLogIndicator = ({ hasLogs, logs, size = 15, className }: MatchLogIndicatorProps) => {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const downloadable = logs ?? [];

  if (!hasLogs) {
    const label = t("common.matchLogs.noneAvailable");
    return (
      <span role="img" className={cn(BASE, NONE, className)} title={t("common.matchLogs.none")} aria-label={label}>
        <FileX size={size} strokeWidth={1.75} aria-hidden />
      </span>
    );
  }

  if (downloadable.length === 0) {
    const label = t("common.matchLogs.available");
    return (
      <span role="img" className={cn(BASE, HAS, className)} title={label} aria-label={label}>
        <ScrollText size={size} strokeWidth={1.75} aria-hidden />
      </span>
    );
  }

  if (downloadable.length === 1) {
    const log = downloadable[0];
    const label = t("common.matchLogs.download", {
      label: log.label ?? t("common.matchLogs.map", { index: 1 })
    });
    return (
      <a
        href={matchLogDownloadUrl(log.matchId)}
        download
        onClick={stop}
        className={cn(BASE, HAS, "hover:brightness-125", className)}
        title={label}
        aria-label={label}
      >
        <FileDown size={size} strokeWidth={1.9} aria-hidden />
      </a>
    );
  }

  const allLabel = t("common.matchLogs.downloadAll", { count: downloadable.length });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            setOpen((v) => !v);
          }}
          className={cn(BASE, HAS, "hover:brightness-125", className)}
          title={allLabel}
          aria-label={allLabel}
        >
          <FileDown size={size} strokeWidth={1.9} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1.5" onClick={stop}>
        <div className="px-2 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {t("common.matchLogs.title")}
        </div>
        <div className="flex flex-col">
          {downloadable.map((log, i) => (
            <a
              key={log.matchId}
              href={matchLogDownloadUrl(log.matchId)}
              download
              onClick={stop}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <FileDown size={13} strokeWidth={1.9} className="text-[color:var(--aqt-emerald)]" aria-hidden />
              <span className="truncate">
                {log.label ?? t("common.matchLogs.map", { index: i + 1 })}
              </span>
            </a>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default MatchLogIndicator;
