"use client";

import { useEffect, useState, type RefObject } from "react";

import { useMediaQuery } from "@/hooks/useMediaQuery";

import type { BalancerOperationStepId } from "./operation-steps";

export const EXPORT_TO_TOURNAMENT_STEPS: readonly BalancerOperationStepId[] = [
  "validate",
  "save",
  "export",
  "refresh"
];

export const IMPORT_JSON_STEPS: readonly BalancerOperationStepId[] = ["read", "load"];

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * The Balancing Pool sidebar only sits beside the balance editor at desktop
 * widths (Tailwind's `xl` breakpoint, 1280px); narrower viewports stack the
 * two panels in a single column instead. Defaults to `true` (desktop-first)
 * so the common case matches between server render and hydration.
 */
export function useIsWideBalancerLayout(): boolean {
  return useMediaQuery("(min-width: 1280px)", true);
}

/**
 * `react-resizable-panels` only speaks percentages, so every fixed width on this
 * page — the 56px collapsed rail, the width a sidebar row stops fitting at —
 * has to be converted against the live group width. A flat `collapsedSize={5}`
 * grew with the viewport: 78px at 1568px, wider still on a 4K monitor.
 */
export const RAIL_WIDTH_PX = 56;
/** Below this a sidebar row clips its own controls (measured at 200px: 4px over). */
export const SIDEBAR_MIN_PX = 260;

export function useGroupWidth(groupRef: RefObject<HTMLDivElement | null>): number {
  // Desktop-first seed, matching `useIsWideBalancerLayout`'s optimism, so the
  // first paint is close and the corrected value is a nudge rather than a jump.
  const [width, setWidth] = useState(1280);

  useEffect(() => {
    const element = groupRef.current;
    if (!element) return;

    const sync = () => {
      const next = element.getBoundingClientRect().width;
      if (next > 0) setWidth(next);
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => observer.disconnect();
  }, [groupRef]);

  return width;
}
