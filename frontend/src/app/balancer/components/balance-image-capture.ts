import { toBlob } from "html-to-image";

/**
 * Rasterising a balance to PNG — the parts that are the same wherever the
 * capture happens.
 *
 * These lived inside `BalanceImageExportDialog`, which needs an off-screen
 * clone because a tournament balance is chunked into groups of ten teams and so
 * has an export layout nothing on screen matches. A mix has two teams and a
 * fullscreen board that IS the export layout, so it captures a live node
 * instead — same rasteriser, same clipboard rules, same image-settling wait.
 */

/**
 * Canvas flood colour for the rasterised PNG. `html-to-image` hands this
 * straight to the canvas, so it must be a literal colour — a `var()` reference
 * has no element to resolve against there. Mirrors `--aqt-bg`; the captured DOM
 * itself uses the token, which resolves because the clone inherits computed
 * styles from the live document.
 */
export const EXPORT_BACKGROUND = "#090a10";

/**
 * A 1x1 fully transparent RGBA PNG, substituted for an image the rasteriser
 * cannot read. Verified transparent: an opaque or tinted pixel here paints a
 * coloured box where the crest was, which reads as a bug rather than an
 * omission.
 */
const TRANSPARENT_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==";

export async function capturePngBlob(
  node: HTMLElement,
  options: { tolerateBlockedImages?: boolean } = {},
): Promise<Blob> {
  const blob = await toBlob(node, {
    cacheBust: true,
    backgroundColor: EXPORT_BACKGROUND,
    pixelRatio: 2,
    // Without this a single unreadable image throws and the host gets nothing.
    // With it they get the card minus that image, which for a crest beside a
    // name and a rating is a decoration, not the payload.
    ...(options.tolerateBlockedImages ? { imagePlaceholder: TRANSPARENT_PIXEL } : {}),
  });

  if (!blob) {
    throw new Error("Could not create PNG blob");
  }

  return blob;
}

export async function copyImageBlob(blob: Blob): Promise<void> {
  if (
    !navigator.clipboard ||
    typeof navigator.clipboard.write !== "function" ||
    typeof ClipboardItem === "undefined"
  ) {
    throw new Error("Clipboard image copy is not supported");
  }

  await navigator.clipboard.write([
    new ClipboardItem({
      "image/png": blob,
    }),
  ]);
}

/** Two frames: one to flush the mutation, one to let layout settle on it. */
export async function waitForLayout(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Resolve once every `<img>` under `node` has settled. `error` resolves too —
 * a missing crest should cost that one glyph, not the whole capture.
 */
export async function waitForImages(node: HTMLElement): Promise<void> {
  const imageElements = Array.from(node.querySelectorAll("img"));

  await Promise.all(
    imageElements.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }

          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
}

/** Save a blob under `filename` through a synthetic anchor click. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revoking synchronously can beat the download in some browsers; one turn is
  // enough for the click to have been dispatched.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
