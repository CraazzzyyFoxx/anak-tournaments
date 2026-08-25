// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const toBlob = vi.fn();
vi.mock("html-to-image", () => ({ toBlob: (...args: unknown[]) => toBlob(...args) }));

import { capturePngBlob } from "./image-capture";

/** What `toBlob` was told about placeholders on the last call. */
const lastPlaceholder = () =>
  (toBlob.mock.lastCall?.[1] as { imagePlaceholder?: string } | undefined)?.imagePlaceholder;

describe("capturePngBlob", () => {
  const blob = new Blob(["png"]);
  const node = document.createElement("div");

  beforeEach(() => {
    toBlob.mockReset();
    toBlob.mockResolvedValue(blob);
  });

  it("always hands the rasteriser a placeholder", async () => {
    // Measured against the live asset bucket while it still lacked CORS: without
    // one, an image the rasteriser cannot fetch turns into `src=""` and throws
    // away the whole capture. It also cannot be a retry — html-to-image memoises
    // the empty result per URL, so one placeholder-less attempt poisons every
    // later attempt on the page.
    await expect(capturePngBlob(node)).resolves.toBe(blob);

    expect(toBlob).toHaveBeenCalledOnce();
    expect(lastPlaceholder()).toMatch(/^data:image\/png;base64,/);
  });

  it("treats a null blob as a failed capture", async () => {
    toBlob.mockResolvedValue(null);

    await expect(capturePngBlob(node)).rejects.toThrow("Could not create PNG blob");
  });
});
