"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

// Hoisted to module scope because `useSyncExternalStore` keys on callback
// IDENTITY: arrow literals written at the call site would be new functions on
// every render, so React would tear down and re-subscribe on each pass.
const subscribeToMotionPreference = (onStoreChange: () => void) => {
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onStoreChange);
  return () => query.removeEventListener("change", onStoreChange);
};
const clientPreference = () => window.matchMedia(QUERY).matches;
// `false` on the server, i.e. "assume no preference". The alternative — assume
// reduce — would suppress motion in the SSR pass and then start it on
// hydration, which is the one behaviour a reduced-motion user must never get.
const serverPreference = () => false;

/**
 * Whether the viewer asked the OS to reduce motion.
 *
 * `globals.css` already flattens every CSS animation and transition under the
 * same query, so this hook is only for the decisions CSS cannot make: whether
 * to MOUNT something that moves. Reach for the stylesheet first; use this only
 * when the motion is a React subtree rather than a property.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeToMotionPreference, clientPreference, serverPreference);
}
