import { describe, expect, it } from "vitest";

import { effectivePhases } from "./effective-phases";

describe("effectivePhases", () => {
  it("balancer tournament skips draft phase", () => {
    expect(effectivePhases({ teamFormation: "balancer" }).map((p) => p.key)).toEqual([
      "announcement",
      "registration",
      "check_in",
      "live",
      "playoffs",
      "completed",
    ]);
  });

  it("draft tournament keeps draft phase in canonical position", () => {
    expect(effectivePhases({ teamFormation: "draft" }).map((p) => p.key)).toEqual([
      "announcement",
      "registration",
      "check_in",
      "draft",
      "live",
      "playoffs",
      "completed",
    ]);
  });

  it("marks phases up to currentStatus as reached", () => {
    const phases = effectivePhases({ teamFormation: "balancer", currentStatus: "live" });
    expect(phases.map((p) => [p.key, p.reached])).toEqual([
      ["announcement", true],
      ["registration", true],
      ["check_in", true],
      ["live", true],
      ["playoffs", false],
      ["completed", false],
    ]);
  });

  it("marks nothing reached without currentStatus", () => {
    const phases = effectivePhases({ teamFormation: "balancer" });
    expect(phases.every((p) => !p.reached)).toBe(true);
  });

  it("drift status not in chain is appended as current", () => {
    // Force-transition: balancer tournament pushed into draft status.
    const phases = effectivePhases({ teamFormation: "balancer", currentStatus: "draft" });

    expect(phases.map((p) => p.key)).toEqual([
      "announcement",
      "registration",
      "check_in",
      "live",
      "playoffs",
      "completed",
      "draft",
    ]);
    const appended = phases[phases.length - 1];
    expect(appended.reached).toBe(true);
    // Canonical order still drives reached for the regular chain.
    expect(phases.find((p) => p.key === "registration")?.reached).toBe(true);
    expect(phases.find((p) => p.key === "check_in")?.reached).toBe(true);
    expect(phases.find((p) => p.key === "live")?.reached).toBe(false);
  });

  it("an archived tournament reads as completed, not as drift", () => {
    const phases = effectivePhases({ teamFormation: "balancer", currentStatus: "archived" });

    expect(phases.some((p) => p.key === "archived" || p.drifted)).toBe(false);
    expect(phases.every((p) => p.reached)).toBe(true);
  });
});
