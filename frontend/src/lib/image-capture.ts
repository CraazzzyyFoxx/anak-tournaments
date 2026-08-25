import { toBlob } from "html-to-image";

/**
 * Rasterising a DOM node to a PNG — the parts that are the same wherever the
 * capture happens.
 *
 * Two shapes use it. The tournament balancer's export dialog rasterises an
 * off-screen clone, because a balance is chunked into groups of ten teams and
 * so has an export layout nothing on screen matches. A mix has two teams and a
 * fullscreen board that IS the export layout, so `useNodeCapture` rasterises a
 * live node instead — same rasteriser, same clipboard rules, same
 * image-settling wait.
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

export interface CapturedPng {
  blob: Blob;
  /**
   * The PNG is missing at least one image the screen shows. Say so rather than
   * letting a host paste a card and notice the hole themselves.
   */
  degraded: boolean;
}

/**
 * Rasterise `node` to a PNG.
 *
 * `imagePlaceholder` is unconditional, and that is load-bearing rather than
 * defensive. `html-to-image` re-fetches every image to embed it as a data URL,
 * and the asset bucket serving division crests sends no
 * `Access-Control-Allow-Origin` — so that fetch always fails, and WITHOUT a
 * placeholder the failed resource becomes `src=""`, which makes the serialised
 * SVG itself fail to decode and throws away the whole capture. Measured against
 * the live bucket: no placeholder throws, placeholder yields the card minus the
 * crest. A crest beside a name and a rating is a decoration; the card is the
 * payload.
 *
 * It is also why the placeholder must not be applied conditionally or as a
 * retry: `html-to-image` memoises each resource's outcome per URL with the query
 * string stripped, so one placeholder-less attempt poisons every later attempt
 * in the same page with the empty result.
 */
export async function capturePngBlob(node: HTMLElement): Promise<CapturedPng> {
  const blob = await toBlob(node, {
    cacheBust: true,
    backgroundColor: EXPORT_BACKGROUND,
    pixelRatio: 2,
    imagePlaceholder: TRANSPARENT_PIXEL,
  });

  if (!blob) {
    throw new Error("Could not create PNG blob");
  }

  return { blob, degraded: hasUnembeddableImage(node) };
}

/**
 * True when `node` shows an image the rasteriser provably cannot embed.
 *
 * A plain `<img>` renders cross-origin content without CORS; `fetch` does not,
 * and the rasteriser goes through `fetch`. So "cross-origin" really does mean
 * "will be missing from the PNG" here — but only as something to TELL the host.
 * The capture config itself must never branch on it: this used to gate the
 * placeholder, which made the outcome depend on a guess about a host.
 */
function hasUnembeddableImage(node: HTMLElement): boolean {
  return Array.from(node.querySelectorAll("img")).some(
    (image) =>
      image.src !== "" &&
      !image.src.startsWith("data:") &&
      !image.src.startsWith(`${window.location.origin}/`),
  );
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
