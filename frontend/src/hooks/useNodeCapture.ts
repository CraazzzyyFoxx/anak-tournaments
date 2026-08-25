"use client";

import { useCallback, useRef, useState } from "react";

import {
  capturePngBlob,
  copyImageBlob,
  waitForImages,
  waitForLayout,
} from "@/lib/image-capture";
import { notify } from "@/lib/notify";

export interface NodeCapture {
  /** Attach to the element to rasterise. */
  ref: React.RefObject<HTMLDivElement | null>;
  /** A capture is in flight. Drives the spinner and the re-entry guard. */
  capturing: boolean;
  capture: () => Promise<void>;
}

/**
 * Rasterise a live DOM node to a PNG on the clipboard.
 *
 * For a surface that already looks like what a host wants to share — a matchup
 * card, the lobby board — this beats the off-screen export frame the tournament
 * balancer needs: no second layout to keep in sync, and the image is provably
 * the thing they were looking at. Mark anything that must not appear in the
 * image with `data-export-hide` and hide it while `capturing` is set; use
 * `invisible` rather than `hidden` so the capture measures the same box.
 *
 * The clipboard is the only destination. A saved file was the wrong shape for
 * the only thing anyone did with it — paste the teams into the Discord channel
 * the lobby is sitting in — and cost a trip through the download tray to get
 * there. Every other image export in the balancer already copies, so there is
 * no longer a second answer to "where did my screenshot go".
 *
 * Failure is reported and swallowed: a blocked clipboard or a tainted canvas
 * should cost the screenshot, not the screen.
 */
export function useNodeCapture(): NodeCapture {
  const ref = useRef<HTMLDivElement | null>(null);
  const [capturing, setCapturing] = useState(false);

  const capture = useCallback(async () => {
    const node = ref.current;
    // The guard reads state, so it is re-entrancy protection for a double
    // click, not for a concurrent call from elsewhere.
    if (node == null || capturing) return;

    setCapturing(true);
    try {
      // One frame for the `data-export-hide` class to land, one for layout.
      await waitForLayout();
      await waitForImages(node);

      const { blob, degraded } = await capturePngBlob(node);
      await copyImageBlob(blob);
      notify.success(`Copied to the clipboard${degraded ? " (without rank icons)" : ""}`);
    } catch {
      notify.error("Clipboard image copy unavailable");
    } finally {
      setCapturing(false);
    }
  }, [capturing]);

  return { ref, capturing, capture };
}
