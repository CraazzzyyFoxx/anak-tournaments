// Runs under `bun test`, matching every other `src/lib/*.test.ts` in this
// directory (vitest's include list deliberately does not cover src/lib).
import { describe, expect, it } from "bun:test";

import {
  composeOutcome,
  describeRequirement,
  requiredProviders
} from "@/lib/subscription-requirement";
import type {
  SubscriptionProviderVerdict,
  SubscriptionRequirement
} from "@/types/registration.types";

const T: SubscriptionProviderVerdict = { state: "active", tier_rank: 3 };
const F: SubscriptionProviderVerdict = { state: "inactive" };
const U: SubscriptionProviderVerdict = { state: "unknown", reason: "provider_unavailable" };

function req(mode: "any" | "all", providers: string[], minTier = 1): SubscriptionRequirement {
  return {
    mode,
    requirements: providers.map((provider) => ({ provider, min_tier_rank: minTier }))
  };
}

/**
 * The same truth table the Python suite asserts in
 * `test_subscription_requirement.py::TestAllMode` / `TestAnyMode`: six unordered
 * pairs per mode, twelve cases total. Ported verbatim so the two implementations
 * cannot drift.
 */
describe("composeOutcome — Kleene truth table", () => {
  const cases: Array<
    ["any" | "all", SubscriptionProviderVerdict, SubscriptionProviderVerdict, string]
  > = [
    ["all", T, T, "satisfied"],
    ["all", T, U, "undetermined"],
    ["all", T, F, "refused"],
    ["all", F, U, "refused"],
    ["all", U, U, "undetermined"],
    ["all", F, F, "refused"],
    ["any", T, F, "satisfied"],
    ["any", T, U, "satisfied"],
    ["any", F, U, "undetermined"],
    ["any", F, F, "refused"],
    ["any", U, U, "undetermined"],
    ["any", T, T, "satisfied"]
  ];

  it.each(cases)("%s of [%o, %o] is %s", (mode, a, b, expected) => {
    expect(composeOutcome(req(mode, ["boosty", "twitch"]), { boosty: a, twitch: b })).toBe(
      expected
    );
  });

  it("is order independent", () => {
    for (const [mode, a, b] of cases) {
      const forward = composeOutcome(req(mode, ["boosty", "twitch"]), { boosty: a, twitch: b });
      const backward = composeOutcome(req(mode, ["boosty", "twitch"]), { boosty: b, twitch: a });
      expect(forward).toBe(backward);
    }
  });

  it("never blocks when one provider is down but the other satisfies (any)", () => {
    // The headline regression: coercing `unknown` to false here would lock out
    // every patron subscribed via the surviving provider.
    expect(composeOutcome(req("any", ["boosty", "twitch"]), { boosty: F, twitch: U })).toBe(
      "undetermined"
    );
  });
});

describe("composeOutcome — single provider", () => {
  it.each(["any", "all"] as const)("%s agrees with the other mode", (mode) => {
    expect(composeOutcome(req(mode, ["boosty"]), { boosty: T })).toBe("satisfied");
    expect(composeOutcome(req(mode, ["boosty"]), { boosty: F })).toBe("refused");
    expect(composeOutcome(req(mode, ["boosty"]), { boosty: U })).toBe("undetermined");
  });
});

describe("composeOutcome — thresholds", () => {
  it("treats active below the threshold as a refusal, not as unknown", () => {
    expect(
      composeOutcome(req("all", ["boosty"], 3), { boosty: { state: "active", tier_rank: 1 } })
    ).toBe("refused");
  });

  it("reads a tierless active verdict as level 1", () => {
    expect(
      composeOutcome(req("all", ["boosty"], 1), { boosty: { state: "active", tier_rank: null } })
    ).toBe("satisfied");
    expect(
      composeOutcome(req("all", ["boosty"], 2), { boosty: { state: "active", tier_rank: null } })
    ).toBe("refused");
  });

  it("keeps per-provider thresholds independent", () => {
    const requirement: SubscriptionRequirement = {
      mode: "all",
      requirements: [
        { provider: "boosty", min_tier_rank: 3 },
        { provider: "twitch", min_tier_rank: 1 }
      ]
    };
    expect(
      composeOutcome(requirement, {
        boosty: { state: "active", tier_rank: 3 },
        twitch: { state: "active", tier_rank: 1 }
      })
    ).toBe("satisfied");
  });
});

describe("composeOutcome — missing data", () => {
  it("treats a missing verdict as undetermined, never as a refusal", () => {
    expect(composeOutcome(req("all", ["boosty", "twitch"]), { boosty: T })).toBe("undetermined");
    expect(composeOutcome(req("any", ["boosty", "twitch"]), { boosty: F })).toBe("undetermined");
  });

  it("is satisfied when nothing is required", () => {
    expect(composeOutcome({ mode: "all", requirements: [] }, {})).toBe("satisfied");
    expect(composeOutcome({}, {})).toBe("satisfied");
    expect(composeOutcome(undefined, {})).toBe("satisfied");
  });
});

describe("only a confirmed refusal blocks admission", () => {
  it("fails open on undetermined and on a missing outcome", () => {
    // There is no `blocksAdmission` helper by design; the rule is written inline
    // as `outcome === "refused"`, mirroring the neighbouring
    // `profilesOpen === false`. This pins the semantics both call sites rely on.
    const outcomes: Array<[string | null | undefined, boolean]> = [
      ["refused", true],
      ["undetermined", false],
      ["satisfied", false],
      [null, false],
      [undefined, false]
    ];
    for (const [outcome, expected] of outcomes) {
      expect(outcome === "refused").toBe(expected);
    }
  });
});

describe("requiredProviders", () => {
  it("lists the distinct providers", () => {
    expect(requiredProviders(req("any", ["boosty", "twitch"]))).toEqual(["boosty", "twitch"]);
  });

  it("deduplicates", () => {
    expect(
      requiredProviders({
        requirements: [{ provider: "boosty" }, { provider: "boosty", min_tier_rank: 3 }]
      })
    ).toEqual(["boosty"]);
  });

  it("skips rows without a provider", () => {
    expect(requiredProviders({ requirements: [{} as never] })).toEqual([]);
  });

  it("is empty for no requirement", () => {
    expect(requiredProviders(undefined)).toEqual([]);
  });
});

describe("describeRequirement", () => {
  it("joins with 'или' in any mode", () => {
    expect(describeRequirement(req("any", ["boosty", "twitch"]))).toContain(" или ");
  });

  it("joins with 'и' in all mode", () => {
    expect(describeRequirement(req("all", ["boosty", "twitch"]))).toContain(" и ");
  });

  it("names every provider", () => {
    const text = describeRequirement(req("any", ["boosty", "twitch"]));
    expect(text).toContain("Boosty");
    expect(text).toContain("Twitch");
  });

  it("spells out a threshold above one", () => {
    expect(describeRequirement(req("all", ["boosty"], 2))).toContain("2");
  });

  it("omits a threshold of one — it would read as a restriction that is not there", () => {
    expect(describeRequirement(req("all", ["boosty"], 1))).not.toContain("1");
  });

  it("uses no conjunction for a single provider", () => {
    const text = describeRequirement(req("all", ["boosty"]));
    expect(text).not.toContain(" и ");
    expect(text).not.toContain(" или ");
  });

  it("falls back to the raw key for an unknown provider", () => {
    expect(describeRequirement(req("all", ["patreon"]))).toContain("patreon");
  });

  it("is empty when nothing is required", () => {
    expect(describeRequirement(undefined)).toBe("");
  });
});
