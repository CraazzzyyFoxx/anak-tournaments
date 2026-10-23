import { describe, expect, it } from "vitest";

import { RELEASE_CARD_DAYS, RELEASES, releaseForCard, releaseForVersion } from "./releases";

const latest = RELEASES[0];
const DAY_MS = 86_400_000;
const start = Date.parse(latest.date);

describe("releaseForCard", () => {
  it("announces the newest release until its window closes", () => {
    expect(releaseForCard(undefined, start)).toBe(latest);
    expect(releaseForCard(undefined, start + RELEASE_CARD_DAYS * DAY_MS - 1)).toBe(latest);
    expect(releaseForCard(undefined, start + RELEASE_CARD_DAYS * DAY_MS)).toBeNull();
  });

  it("stays quiet once this browser has seen that version, but not an older one", () => {
    expect(releaseForCard(latest.version, start)).toBeNull();
    expect(releaseForCard("1.0.0", start)).toBe(latest);
  });
});

describe("releaseForVersion", () => {
  it("opens the newest entry at or below the running version", () => {
    expect(releaseForVersion(`v${latest.version}`)).toBe(latest);
    // A patch release has no entry of its own.
    const [major, minor, patch] = latest.version.split(".").map(Number);
    expect(releaseForVersion(`v${major}.${minor}.${patch + 1}`)).toBe(latest);
  });

  it("has no entry for a version older than every release, or for a dev build", () => {
    expect(releaseForVersion("v0.0.1")).toBeNull();
    expect(releaseForVersion("dev")).toBeNull();
    expect(releaseForVersion(undefined)).toBeNull();
  });
});
