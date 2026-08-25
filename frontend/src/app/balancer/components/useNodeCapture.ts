"use client";

import { useCallback, useRef, useState } from "react";

import { notify } from "@/lib/notify";

import {
  capturePngBlob,
  copyImageBlob,
  downloadBlob,
  waitForImages,
  waitForLayout,
} from "./balance-image-capture";

/** Copy straight to the clipboard, or save a file. */
export type CaptureMode = "copy" | "download";

/** `Thursday scrim #12` -> `thursday-scrim-12`, for a sane download name. */
export function slugifyFilename(value: string, fallback = "export"): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback
  );
}

export interface NodeCapture {
  /** Attach to the element to rasterise. */
  ref: React.RefObject<HTMLDivElement | null>;
  /** The capture in flight, or `null`. Drives the spinner and re-entry guard. */
  capturing: CaptureMode | null;
  capture: (mode: CaptureMode) => Promise<void>;
}

/**
 * Rasterise a live DOM node to PNG, to the clipboard or to a file.
 *
 * For a surface that already looks like what a host wants to share — a matchup
 * card, the lobby board — this beats the off-screen export frame the tournament
 * balancer needs: no second layout to keep in sync, and the image is provably
 * the thing they were looking at. Mark anything that must not appear in the
 * image with `data-export-hide` and hide it while `capturing` is set; use
 * `invisible` rather than `hidden` so the capture measures the same box.
 *
 * Failure is reported and swallowed: a blocked clipboard or a tainted canvas
 * should cost the screenshot, not the screen.
 */
export function useNodeCapture(filename: string): NodeCapture {
  const ref = useRef<HTMLDivElement | null>(null);
  const [capturing, setCapturing] = useState<CaptureMode | null>(null);

  const capture = useCallback(
    async (mode: CaptureMode) => {
      const node = ref.current;
      // The guard reads state, so it is re-entrancy protection for a double
      // click, not for a concurrent call from elsewhere.
      if (node == null || capturing != null) return;

      setCapturing(mode);
      try {
        // One frame for the `data-export-hide` class to land, one for layout.
        await waitForLayout();
        await waitForImages(node);

        // `html-to-image` re-fetches every image to embed it as a data URL, and
        // a host that sends no `Access-Control-Allow-Origin` fails that fetch.
        // Division crests come from the asset CDN, so this is the normal case,
        // not an edge one: tolerate it and say so, rather than hand back nothing
        // because a decoration could not be read.
        const blockedImages = Array.from(node.querySelectorAll("img")).some(
          (image) =>
            image.src !== "" &&
            !image.src.startsWith("data:") &&
            !image.src.startsWith(`${window.location.origin}/`),
        );

        const blob = await capturePngBlob(node, { tolerateBlockedImages: blockedImages });
        const caveat = blockedImages ? " (without rank icons)" : "";

        if (mode === "copy") {
          await copyImageBlob(blob);
          notify.success(`Copied to the clipboard${caveat}`);
        } else {
          downloadBlob(blob, `${filename}.png`);
          notify.success(`Saved as PNG${caveat}`);
        }
      } catch {
        notify.error(
          mode === "copy" ? "Clipboard image copy unavailable" : "Could not render the image",
        );
      } finally {
        setCapturing(null);
      }
    },
    [capturing, filename],
  );

  return { ref, capturing, capture };
}
