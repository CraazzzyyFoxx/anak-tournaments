import { Info } from "lucide-react";
import { useTranslations } from "next-intl";

import { useRequirementDescription } from "@/components/registration/useRequirementDescription";
import type { SubscriptionRequirement, SubscriptionStatus } from "@/types/registration.types";

interface SubscriptionRuleNoticeProps {
  subscription?: SubscriptionStatus | null;
  /** The workspace rule as the form read carries it (`subscription_requirement_json`). */
  requirement?: SubscriptionRequirement | null;
}

/**
 * States the tournament's subscription rule in one line, e.g.
 * *"An active subscription is required: Boosty level 2 or Twitch"*.
 *
 * This is not decoration. Under `any` mode a patron satisfying one of two
 * providers sees a green chip next to a red one; without the conjunction spelled
 * out, that reads as two independent failures and they will assume they are
 * blocked. The rule is the server's own requirement (the form read resolves it
 * from the workspace, the same row the gate enforces), worded here so it follows
 * the reader's locale.
 */
export default function SubscriptionRuleNotice({ subscription, requirement }: Readonly<SubscriptionRuleNoticeProps>) {
  const t = useTranslations();
  const rule = useRequirementDescription(requirement);

  if (!subscription?.required || !rule) return null;

  return (
    // border/overlay-1, not the control tokens: an informational line must not
    // carry the same surface weight as the inputs it precedes, or it reads as a
    // disabled field.
    <div className="flex items-start gap-2 rounded-lg border border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-1)] p-2.5">
      <Info className="mt-0.5 size-3.5 shrink-0 text-[color:var(--aqt-fg-muted)]" aria-hidden />
      <p className="text-xs leading-5 text-[color:var(--aqt-fg-dim)]">
        {subscription.mode === "any"
          ? t("common.subscription.requiredAny", { rule })
          : t("common.subscription.requiredAll", { rule })}
      </p>
    </div>
  );
}
