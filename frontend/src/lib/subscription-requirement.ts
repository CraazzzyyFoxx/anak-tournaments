import type {
  SubscriptionOutcome,
  SubscriptionProviderVerdict,
  SubscriptionRequirement
} from "@/types/registration.types";

/**
 * TypeScript port of `shared/services/subscriptions/requirement.py`.
 *
 * IMPORTANT: this is NOT the source of truth for admission. The server sends the
 * composed `subscription_outcome`, and `isAdmitted` uses that. This port exists
 * only for rendering — the per-provider chips and the rule summary line, which
 * the admin form must preview before anything is saved and the registration form
 * needs when it explains *why* a patron is refused.
 *
 * Composition is Kleene three-valued logic, and `unknown` must never be coerced
 * to a boolean before combining. Coercing it to false makes
 * `any[refused, unknown]` block, so one provider's outage locks out every patron
 * subscribed via the other. Coercing it to true makes `all[refused, unknown]`
 * pass, admitting a confirmed non-subscriber. The truth table is asserted in
 * `subscription-requirement.test.ts` with the same twelve cases the Python suite
 * uses, so the two implementations cannot drift.
 */

/** Brand names, never translated; an unknown key renders as itself. */
export const PROVIDER_LABELS: Record<string, string> = {
  boosty: "Boosty",
  twitch: "Twitch"
};

/** Distinct providers a requirement needs resolved, in declaration order. */
export function requiredProviders(requirement: SubscriptionRequirement | undefined | null): string[] {
  const seen = new Set<string>();
  for (const row of requirement?.requirements ?? []) {
    const provider = (row?.provider ?? "").trim();
    if (provider) seen.add(provider);
  }
  return [...seen];
}

function evaluateOne(
  minTierRank: number,
  verdict: SubscriptionProviderVerdict | undefined
): SubscriptionOutcome {
  // A missing verdict means the provider is unconfigured, disabled, or was not
  // resolved. That is the organizer's problem and must never read as "not
  // subscribed".
  if (!verdict || verdict.state === "unknown") return "undetermined";
  if (verdict.state !== "active") return "refused";
  // `null` tier means "subscribed, level unknown", which counts as level 1.
  return (verdict.tier_rank ?? 1) >= minTierRank ? "satisfied" : "refused";
}

export function composeOutcome(
  requirement: SubscriptionRequirement | undefined | null,
  verdicts: Record<string, SubscriptionProviderVerdict>
): SubscriptionOutcome {
  const rows = (requirement?.requirements ?? []).filter((row) => (row?.provider ?? "").trim());
  if (rows.length === 0) return "satisfied";

  const outcomes = rows.map((row) =>
    evaluateOne(Math.max(row.min_tier_rank ?? 1, 1), verdicts[row.provider])
  );

  if ((requirement?.mode ?? "all") === "all") {
    // Kleene AND: refusal dominates, then undetermined.
    if (outcomes.includes("refused")) return "refused";
    if (outcomes.includes("undetermined")) return "undetermined";
    return "satisfied";
  }

  // Kleene OR: satisfaction dominates, then undetermined.
  if (outcomes.includes("satisfied")) return "satisfied";
  if (outcomes.includes("undetermined")) return "undetermined";
  return "refused";
}

/**
 * The rule as structure, one clause per requirement row in declaration order.
 *
 * Wording and the conjunction between clauses are locale-dependent and live in
 * `useRequirementDescription`; this module stays pure so the Kleene table above
 * can be tested without a translation runtime.
 *
 * The conjunction is load-bearing: without it an `any` requirement reads as two
 * independent failures, and a patron who satisfies one provider sees a red chip
 * on the other and assumes they are blocked.
 *
 * There is deliberately no `blocksAdmission` helper: the rule is simply
 * `outcome === "refused"`, written inline at its call sites the same way the
 * neighbouring open-profile gate writes `profilesOpen === false`.
 */
export function requirementClauses(
  requirement: SubscriptionRequirement | undefined | null
): Array<{ provider: string; minTier: number | null }> {
  return (requirement?.requirements ?? [])
    .filter((row) => (row?.provider ?? "").trim())
    .map((row) => {
      const minTier = Math.max(row.min_tier_rank ?? 1, 1);
      // A threshold of 1 means "any paid tier"; spelling it out reads like a
      // restriction that is not there, so it is dropped rather than rendered.
      return { provider: row.provider, minTier: minTier > 1 ? minTier : null };
    });
}
