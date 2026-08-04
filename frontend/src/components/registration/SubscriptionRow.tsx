"use client";

import { useState } from "react";
import { ArrowRight, Link2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { SubscriptionProviderBadge } from "@/components/status/RegistrationBadges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SubscriptionStatus } from "@/types/registration.types";

interface SubscriptionRowProps {
  provider: string;
  providerLabel: string;
  subscription?: SubscriptionStatus | null;
  /** Opens profile settings so the user can link a Discord/Twitch account. */
  onLinkAccounts?: () => void;
  /** Only wired for providers that support a challenge code (Boosty). */
  onRedeemCode?: (code: string) => Promise<void>;
}

/**
 * One provider's subscription chip plus the action that can fix it.
 *
 * The call to action is chosen from the verdict's `reason`, which is exactly why
 * the server sends it: a patron reading "no subscription" needs to know whether
 * to link Discord, reconnect Twitch, or paste a code. Renders nothing when the
 * tournament does not require this provider.
 */
export default function SubscriptionRow({
  provider,
  providerLabel,
  subscription,
  onLinkAccounts,
  onRedeemCode
}: SubscriptionRowProps) {
  const t = useTranslations();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!subscription?.required) return null;
  const verdict = subscription.verdicts?.[provider];
  if (!verdict) return null;

  const reason = verdict.reason ?? null;
  const showLinkDiscord = reason === "no_linked_discord_account" && Boolean(onLinkAccounts);
  const showReconnectTwitch = reason === "missing_scope" && Boolean(onLinkAccounts);
  // Two independent reasons a code is pointless here: the provider is already
  // satisfied, or this tournament does not verify by code at all — in which case
  // the server answers 400 and offering the input is a trap.
  const showCodeInput =
    Boolean(onRedeemCode) && verdict.state !== "active" && verdict.code_accepted === true;

  const submit = async () => {
    if (!onRedeemCode || !code.trim()) return;
    setPending(true);
    setError(null);
    try {
      await onRedeemCode(code.trim());
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-2 rounded-lg border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-2)] p-2.5">
      <SubscriptionProviderBadge providerLabel={providerLabel} verdict={verdict} />

      {showLinkDiscord && (
        <button
          type="button"
          onClick={onLinkAccounts}
          className="inline-flex items-center gap-1.5 text-left text-xs font-medium text-[color:var(--aqt-fg)] underline-offset-2 hover:underline"
        >
          <Link2 className="size-3.5 shrink-0" aria-hidden />
          {t("common.subscription.linkDiscordCta")}
          <ArrowRight className="size-3" aria-hidden />
        </button>
      )}

      {showReconnectTwitch && (
        <button
          type="button"
          onClick={onLinkAccounts}
          className="inline-flex items-center gap-1.5 text-left text-xs font-medium text-[color:var(--aqt-fg)] underline-offset-2 hover:underline"
        >
          <Link2 className="size-3.5 shrink-0" aria-hidden />
          {t("common.subscription.reconnectTwitchCta")}
          <ArrowRight className="size-3" aria-hidden />
        </button>
      )}

      {showCodeInput && (
        <div className="grid gap-1.5">
          <label
            htmlFor={`subscription-code-${provider}`}
            className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--aqt-fg-muted)]"
          >
            {t("common.subscription.codeLabel")}
          </label>
          <div className="flex gap-2">
            <Input
              id={`subscription-code-${provider}`}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder={t("common.subscription.codePlaceholder")}
              autoComplete="off"
              disabled={pending}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={submit}
              disabled={pending || !code.trim()}
            >
              {pending && (
                <Loader2
                  className="mr-1 size-3 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              )}
              {t("common.subscription.codeSubmit")}
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-[color:var(--aqt-rose)]">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
