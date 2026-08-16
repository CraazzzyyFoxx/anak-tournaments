"use client";

import { useSyncExternalStore } from "react";

const MINUTE_MS = 60_000;

// Hoisted to module scope because `useSyncExternalStore` keys on callback
// IDENTITY: arrow literals written at the call site would be new functions on
// every render, so React would tear down and re-subscribe on each pass.
//
// The snapshot is FLOORED to the minute rather than returned raw. `getSnapshot`
// is called during render and must be stable between notifications — a raw
// `Date.now()` changes on every single call, which React treats as a store that
// never settles and re-renders in a loop. Floored, it returns the same number
// for the whole minute and changes exactly when the tick fires.
const subscribeToMinute = (onStoreChange: () => void) => {
  const id = setInterval(onStoreChange, MINUTE_MS);
  return () => clearInterval(id);
};
const clientMinute = () => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
const serverMinute = () => null;

/**
 * The current time, floored to the minute, or `null` on the server.
 *
 * For durations quoted in minutes ("on air for 3h 12m"). Two reasons it is not
 * a bare `Date.now()` in render:
 *
 *  - The server has a different instant than the client, so a duration rendered
 *    during SSR and re-rendered on hydration is a hydration mismatch. `null`
 *    means "do not render a duration yet", and the real value arrives on the
 *    client pass — same shape as `TwitchEmbed`'s hostname.
 *  - Reading the clock during render is impure, and React's compiler rejects
 *    it. An external store is what a clock actually is.
 *
 * The interval is unsynchronised with the wall clock, so a value can be up to
 * one minute stale. That is the correct precision for the thing being shown.
 */
export function useMinuteClock(): number | null {
  return useSyncExternalStore(subscribeToMinute, clientMinute, serverMinute);
}
