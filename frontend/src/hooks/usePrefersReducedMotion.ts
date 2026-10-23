"use client";

import { useMediaQuery } from "@/hooks/useMediaQuery";

/**
 * Whether the viewer asked the OS to reduce motion.
 *
 * `globals.css` already flattens every CSS animation and transition under the
 * same query, so this hook is only for the decisions CSS cannot make: whether
 * to MOUNT something that moves. Reach for the stylesheet first; use this only
 * when the motion is a React subtree rather than a property.
 *
 * `false` on the server, i.e. "assume no preference". The alternative — assume
 * reduce — would suppress motion in the SSR pass and then start it on
 * hydration, which is the one behaviour a reduced-motion user must never get.
 */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
