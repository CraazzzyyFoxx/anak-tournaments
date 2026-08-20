import { Info } from "lucide-react";
import { useTranslations } from "next-intl";

import type { SubscriptionStatus } from "@/types/registration.types";

interface SubscriptionRuleNoticeProps {
  subscription?: SubscriptionStatus | null;
}

/**
 * States the tournament's subscription rule in one line, e.g.
 * *"Нужна активная подписка: Boosty уровень 2 или Twitch"*.
 *
 * This is not decoration. Under `any` mode a patron satisfying one of two
 * providers sees a green chip next to a red one; without the conjunction spelled
 * out, that reads as two independent failures and they will assume they are
 * blocked. The rule text comes from the server (`rule`) so it can never disagree
 * with what the gate actually enforces.
 */
export default function SubscriptionRuleNotice({ subscription }: Readonly<SubscriptionRuleNoticeProps>) {
  const t = useTranslations();

  if (!subscription?.required || !subscription.rule) return null;

  return (
    // border/overlay-1, not the control tokens: an informational line must not
    // carry the same surface weight as the inputs it precedes, or it reads as a
    // disabled field.
    <div className="flex items-start gap-2 rounded-lg border border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-1)] p-2.5">
      <Info className="mt-0.5 size-3.5 shrink-0 text-[color:var(--aqt-fg-muted)]" aria-hidden />
      <p className="text-xs leading-5 text-[color:var(--aqt-fg-dim)]">
        {subscription.mode === "any"
          ? t("common.subscription.requiredAny", { rule: subscription.rule })
          : t("common.subscription.requiredAll", { rule: subscription.rule })}
      </p>
    </div>
  );
}
