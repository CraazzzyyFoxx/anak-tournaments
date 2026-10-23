import { beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: toastError }) }));

import { ApiError } from "@/lib/api/error";
import { notify } from "@/lib/notify";

const storageDown = new ApiError(503, [
  { msg: "File storage is unavailable. Try again in a few minutes.", code: "storage_unavailable" }
]);

describe("notify.apiError", () => {
  beforeEach(() => toastError.mockClear());

  it("keeps the server's reason under a caller's own heading", () => {
    notify.apiError(storageDown, { title: "Could not upload the icon" });

    expect(toastError).toHaveBeenCalledWith(
      "Could not upload the icon",
      expect.objectContaining({ description: "File storage is unavailable. Try again in a few minutes." })
    );
  });

  it("uses the server's reason as the heading when the caller gives none", () => {
    notify.apiError(storageDown);

    expect(toastError).toHaveBeenCalledWith(
      "File storage is unavailable. Try again in a few minutes.",
      expect.objectContaining({ description: undefined })
    );
  });
});
