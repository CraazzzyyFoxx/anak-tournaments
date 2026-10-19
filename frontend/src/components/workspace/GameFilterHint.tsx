"use client";

import { Gamepad2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { useScopePillOpen } from "@/components/workspace/scope-pill-store";
import { cn } from "@/lib/utils";

/** Stands in for the game-bound filters under "all games" (spec §6.2); opens the scope pill. */
export function GameFilterHint({ className }: Readonly<{ className?: string }>) {
  const t = useTranslations("common.discipline");
  const setOpen = useScopePillOpen((state) => state.setOpen);

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-[color:var(--aqt-border-2)] px-3",
        "text-caption text-[color:var(--aqt-fg-muted)] transition-colors hover:bg-[color:var(--aqt-overlay-2)]",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      <Gamepad2 className="size-3.5 shrink-0" aria-hidden />
      {t("filterHint")}
    </button>
  );
}
