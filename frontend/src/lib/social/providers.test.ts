import { describe, expect, it } from "vitest";

import { displaySocialHandle, normalizeSocialHandle } from "./providers";

describe("Riot ID normalization", () => {
  it("keeps inner name spaces and collapses only the tag separator", () => {
    expect(displaySocialHandle("riot", "  Hide On Bush # KR1 ")).toBe("Hide On Bush#KR1");
    expect(normalizeSocialHandle("riot", "  Hide On Bush # KR1 ")).toBe("hide on bush#kr1");
    expect(normalizeSocialHandle("riot", "Hide  On Bush#KR1")).toBe("hide  on bush#kr1");
    expect(normalizeSocialHandle("battlenet", "  Hide On Bush # 1234 ")).toBe("hideonbush#1234");
  });
});
