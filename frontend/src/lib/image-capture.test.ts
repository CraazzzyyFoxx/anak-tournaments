// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const toBlob = vi.fn();
vi.mock("html-to-image", () => ({ toBlob: (...args: unknown[]) => toBlob(...args) }));

import { capturePngBlob } from "./image-capture";

/** What `toBlob` was told about placeholders on the last call. */
const lastPlaceholder = () =>
  (toBlob.mock.lastCall?.[1] as { imagePlaceholder?: string } | undefined)?.imagePlaceholder;

function nodeWithImage(src: string): HTMLElement {
  const node = document.createElement("div");
  const image = document.createElement("img");
  image.src = src;
  node.appendChild(image);
  return node;
}

describe("capturePngBlob", () => {
  const blob = new Blob(["png"]);

  beforeEach(() => {
    toBlob.mockReset();
    toBlob.mockResolvedValue(blob);
  });

  it("always hands the rasteriser a placeholder", async () => {
    // Measured against the live asset bucket: without one, a crest the rasteriser
    // cannot fetch turns into `src=""` and throws away the whole capture. It also
    // cannot be a retry — html-to-image memoises the empty result per URL, so one
    // placeholder-less attempt poisons every later attempt on the page.
    await capturePngBlob(nodeWithImage(`${window.location.origin}/divisions/11.png`));

    expect(toBlob).toHaveBeenCalledOnce();
    expect(lastPlaceholder()).toMatch(/^data:image\/png;base64,/);
  });

  it("reports a clean capture when every image is embeddable", async () => {
    const node = nodeWithImage(`${window.location.origin}/divisions/11.png`);

    await expect(capturePngBlob(node)).resolves.toEqual({ blob, degraded: false });
  });

  it("reports a cross-origin image as missing from the PNG", async () => {
    // A plain `<img>` renders this; `fetch` cannot read it, and the rasteriser
    // goes through `fetch`. So the host is told, rather than left to spot the hole.
    const node = nodeWithImage("https://static.nl.example/aqt/assets/divisions/master-1.png");

    await expect(capturePngBlob(node)).resolves.toEqual({ blob, degraded: true });
  });

  it("treats a null blob as a failed capture", async () => {
    toBlob.mockResolvedValue(null);

    await expect(capturePngBlob(nodeWithImage(""))).rejects.toThrow("Could not create PNG blob");
  });
});
