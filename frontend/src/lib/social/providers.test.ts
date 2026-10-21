import { describe, expect, it } from "vitest";

import { displaySocialHandle, getSocialProviderConfig, normalizeSocialHandle } from "./providers";

describe("Riot ID normalization", () => {
  it("keeps inner name spaces and collapses only the tag separator", () => {
    expect(displaySocialHandle("riot", "  Hide On Bush # KR1 ")).toBe("Hide On Bush#KR1");
    expect(normalizeSocialHandle("riot", "  Hide On Bush # KR1 ")).toBe("hide on bush#kr1");
    expect(normalizeSocialHandle("riot", "Hide  On Bush#KR1")).toBe("hide  on bush#kr1");
    expect(normalizeSocialHandle("battlenet", "  Hide On Bush # 1234 ")).toBe("hideonbush#1234");
  });
});

describe("riot", () => {
  it("is a verifiable game account with the Riot mark", () => {
    const riot = getSocialProviderConfig("riot");
    expect(riot.icon).toBe("/riot.png");
    expect(riot.canBeVerified).toBe(true);
    expect(riot.isGameProvider).toBe(true);
  });
});
