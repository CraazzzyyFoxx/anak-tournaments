"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

function canAnimate(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof document.startViewTransition === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * `value` as the screen shows it. A change is committed inside a view transition, so the browser morphs every element
 * with a `view-transition-name` from its old place to its new one (a pick flying pool → slot, a ban landing in its
 * team's row, the room's centre handing over to the next phase). Without the API, or under reduced motion, the change
 * lands in the same render.
 */
export function useViewTransitionState<T>(value: T): T {
  const [shown, setShown] = useState(value);
  const animate = canAnimate();
  // No transition to wait for: catch up during render, React's pattern for state that follows a prop.
  if (!animate && !Object.is(shown, value)) setShown(value);

  useEffect(() => {
    if (!animate || Object.is(shown, value)) return;
    // The old frame is what is on screen now; the callback renders the new one synchronously for the second capture.
    document.startViewTransition(() => {
      flushSync(() => setShown(value));
    });
  }, [animate, shown, value]);

  return animate ? shown : value;
}
