"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether `query` matches. `serverDefault` is the SSR/hydration answer: pick the
 * common case so the first paint agrees with what most clients will compute.
 */
export function useMediaQuery(query: string, serverDefault = false): boolean {
  // Memoized because `useSyncExternalStore` re-subscribes whenever the
  // subscribe callback's identity changes.
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverDefault
  );
}
