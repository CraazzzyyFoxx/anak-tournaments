"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

export interface HoverIntentOptions {
  /** Delay before opening once the pointer settles on the trigger. */
  openDelay?: number;
  /** Grace period after the pointer leaves, so the cursor can cross the gap. */
  closeDelay?: number;
  /** Opening this instance immediately closes any other exclusive instance. */
  exclusive?: boolean;
}

export interface HoverIntent {
  open: boolean;
  /** Set the state immediately, bypassing any pending timer. */
  setOpen: Dispatch<SetStateAction<boolean>>;
  /** Drop a pending open/close — e.g. the pointer re-entered. */
  cancel: () => void;
  scheduleOpen: (delay?: number) => void;
  scheduleClose: (delay?: number) => void;
}

/**
 * Open/close state for a hover-revealed surface (popover, menu) behind a single
 * shared timer, so a pending open and a pending close can never race.
 *
 * `scheduleOpen`/`scheduleClose` accept a delay override for the cases that must
 * be immediate — e.g. blur, which should close without the grace period a
 * pointer-leave needs.
 */
type ExclusiveSlot = { close: () => void };
let exclusiveSlot: ExclusiveSlot | null = null;

export function useHoverIntent({
  openDelay = 0,
  closeDelay = 120,
  exclusive = false
}: HoverIntentOptions = {}): HoverIntent {
  const [open, setOpenState] = useState(false);
  const timer = useRef<number | null>(null);
  const self = useRef<ExclusiveSlot>({ close: () => {} });

  const cancel = useCallback(() => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const setOpen = useCallback<Dispatch<SetStateAction<boolean>>>(
    (update) => {
      setOpenState((prev) => {
        const next = typeof update === "function" ? update(prev) : update;
        if (next === prev) return prev;
        if (exclusive) {
          if (next) {
            const previous = exclusiveSlot;
            exclusiveSlot = self.current;
            if (previous && previous !== self.current) previous.close();
          } else if (exclusiveSlot === self.current) {
            exclusiveSlot = null;
          }
        }
        return next;
      });
    },
    [exclusive]
  );

  self.current.close = () => {
    cancel();
    setOpenState(false);
    if (exclusiveSlot === self.current) exclusiveSlot = null;
  };

  const schedule = useCallback(
    (next: boolean, delay: number) => {
      cancel();
      if (delay <= 0) {
        setOpen(next);
        return;
      }
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setOpen(next);
      }, delay);
    },
    [cancel, setOpen]
  );

  const scheduleOpen = useCallback((delay = openDelay) => schedule(true, delay), [schedule, openDelay]);

  const scheduleClose = useCallback((delay = closeDelay) => schedule(false, delay), [schedule, closeDelay]);

  useEffect(() => cancel, [cancel]);

  return { open, setOpen, cancel, scheduleOpen, scheduleClose };
}

export default useHoverIntent;
