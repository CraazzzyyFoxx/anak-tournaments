"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type OverlayBarTone = "neutral" | "warn" | "active";

const TONE_BORDER: Record<OverlayBarTone, string> = {
  neutral: "border-[color:var(--aqt-border-2)]",
  warn: "border-[color:var(--aqt-warm)]/60",
  active: "border-[color:var(--aqt-teal)]/60",
};

interface OverlayBarProps {
  /** Border accent -- "warn" for a connectivity/attention problem, "active" for "you can act now". */
  tone?: OverlayBarTone;
  ariaLabel?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Fixed bottom-center overlay shell for a page's primary "act now" control
 * surface -- centered, width-capped, backdrop-blurred, safe-area-aware.
 * Shared so any room anchoring a live turn/command bar (e.g. the pick-ban
 * pregame room) gets the same positioning and chrome instead of duplicating it.
 *
 * Pair with bottom padding on the page's scroll container so the fixed bar
 * never overlaps trailing content.
 *
 * While mounted it publishes its height as `--overlay-bar-h` on `<html>`: the
 * corner docks (`ui/dock`) stand on top of it instead of covering the very
 * control the bar exists for. Their stack is a portal on `<body>`, never this
 * bar's subtree, so a CSS variable is the only channel both can read.
 */
export function OverlayBar({ tone = "neutral", ariaLabel, className, children }: Readonly<OverlayBarProps>) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const root = document.documentElement;
    // ponytail: one bar per page; a second one would overwrite the first's height.
    const publish = () => root.style.setProperty("--overlay-bar-h", `${node.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--overlay-bar-h");
    };
  }, []);

  return (
    <section
      ref={ref}
      className={cn(
        "fixed bottom-2 left-1/2 z-40 w-[min(1320px,94vw)] -translate-x-1/2 rounded-xl border bg-[color:var(--aqt-card)]/95 p-3 shadow-xl backdrop-blur transition-colors supports-[padding:max(0px)]:pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        TONE_BORDER[tone],
        className,
      )}
      aria-label={ariaLabel}
    >
      {children}
    </section>
  );
}
