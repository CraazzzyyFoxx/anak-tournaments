import { describe, expect, it } from "vitest";

import { isAdmitted } from "@/components/status/RegistrationBadges";

/**
 * `isAdmitted` is the client mirror of the server's admission rule. The property
 * that matters: only a *confirmed* refusal blocks. An outage, an unlinked
 * account, or a token missing the new Twitch scope all resolve to
 * `undetermined`, and must fail open exactly as the check-in gate does — a
 * provider going down mid-tournament cannot be allowed to un-admit players.
 */
const APPROVED = ["approved", "ready", true] as const;

describe("isAdmitted — baseline", () => {
  it("requires approved + ready + checked in", () => {
    expect(isAdmitted(...APPROVED)).toBe(true);
    expect(isAdmitted("pending", "ready", true)).toBe(false);
    expect(isAdmitted("approved", "incomplete", true)).toBe(false);
    expect(isAdmitted("approved", "ready", false)).toBe(false);
  });
});

describe("isAdmitted — subscription requirement", () => {
  it("blocks only a confirmed refusal", () => {
    expect(
      isAdmitted(...APPROVED, { requireSubscription: true, subscriptionOutcome: "refused" })
    ).toBe(false);
  });

  it("admits a satisfied outcome", () => {
    expect(
      isAdmitted(...APPROVED, { requireSubscription: true, subscriptionOutcome: "satisfied" })
    ).toBe(true);
  });

  it("fails open on undetermined", () => {
    expect(
      isAdmitted(...APPROVED, { requireSubscription: true, subscriptionOutcome: "undetermined" })
    ).toBe(true);
  });

  it("fails open on a missing outcome", () => {
    expect(isAdmitted(...APPROVED, { requireSubscription: true })).toBe(true);
    expect(
      isAdmitted(...APPROVED, { requireSubscription: true, subscriptionOutcome: null })
    ).toBe(true);
  });

  it("ignores the outcome entirely when the tournament does not require one", () => {
    expect(
      isAdmitted(...APPROVED, { requireSubscription: false, subscriptionOutcome: "refused" })
    ).toBe(true);
    expect(isAdmitted(...APPROVED, { subscriptionOutcome: "refused" })).toBe(true);
  });
});

describe("isAdmitted — the two gates are independent", () => {
  it("blocks when only the profile gate fails", () => {
    expect(
      isAdmitted(...APPROVED, {
        requireOpenProfile: true,
        profilesOpen: false,
        requireSubscription: true,
        subscriptionOutcome: "satisfied"
      })
    ).toBe(false);
  });

  it("blocks when only the subscription gate fails", () => {
    expect(
      isAdmitted(...APPROVED, {
        requireOpenProfile: true,
        profilesOpen: true,
        requireSubscription: true,
        subscriptionOutcome: "refused"
      })
    ).toBe(false);
  });

  it("admits when both gates pass", () => {
    expect(
      isAdmitted(...APPROVED, {
        requireOpenProfile: true,
        profilesOpen: true,
        requireSubscription: true,
        subscriptionOutcome: "satisfied"
      })
    ).toBe(true);
  });

  it("admits when both are merely undetermined", () => {
    expect(
      isAdmitted(...APPROVED, {
        requireOpenProfile: true,
        profilesOpen: null,
        requireSubscription: true,
        subscriptionOutcome: "undetermined"
      })
    ).toBe(true);
  });
});
