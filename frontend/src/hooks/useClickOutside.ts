"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Fires `onOutside` on the first `mousedown` outside `ref`'s element —
 * `mousedown` rather than `click` so a drag that starts inside and releases
 * outside doesn't count. Shared by every admin search combobox that closes
 * its dropdown on an outside click.
 */
export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onOutside: () => void
): void {
  const onOutsideRef = useRef(onOutside);
  useEffect(() => {
    onOutsideRef.current = onOutside;
  });

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onOutsideRef.current();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [ref]);
}
