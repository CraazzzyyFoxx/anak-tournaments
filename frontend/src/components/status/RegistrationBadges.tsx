import React from "react";
import {
  CheckCircle2,
  Circle,
  Clock,
  HeartCrack,
  HeartHandshake,
  Lock,
  Unlock,
  XCircle
} from "lucide-react";
import { useTranslations } from "next-intl";
import StatusMetaBadge from "@/components/status/StatusMetaBadge";
import { StatusIconBadge } from "@/components/status/StatusIconBadge";
import type {
  StatusMeta,
  SubscriptionOutcome,
  SubscriptionProviderVerdict
} from "@/types/registration.types";

interface StatusBadgeProps {
  status?: string | null;
  meta?: StatusMeta | null;
  className?: string;
  compact?: boolean;
}

export function RegistrationStatusBadge({ status, meta, className, compact }: StatusBadgeProps) {
  return (
    <StatusMetaBadge
      meta={meta}
      fallbackValue={status ?? undefined}
      className={className}
      compact={compact}
    />
  );
}

export function BalancerStatusBadge({ status, meta, className, compact }: StatusBadgeProps) {
  return (
    <StatusMetaBadge
      meta={meta}
      fallbackValue={status ?? "not_in_balancer"}
      className={className}
      compact={compact}
    />
  );
}

interface CheckInStatusBadgeProps {
  checkedIn: boolean | undefined | null;
  className?: string;
}

export function CheckInStatusBadge({ checkedIn, className }: CheckInStatusBadgeProps) {
  const t = useTranslations();
  const isCheckedIn = checkedIn === true;

  return (
    <StatusIconBadge
      icon={isCheckedIn ? CheckCircle2 : Circle}
      label={isCheckedIn ? t("common.checkedIn") : t("common.notCheckedIn")}
      tone={isCheckedIn ? "positive" : "neutral"}
      className={className}
    />
  );
}

interface AdmissionOptions {
  /** When the tournament requires open profiles, a confirmed-closed profile blocks admission. */
  requireOpenProfile?: boolean;
  /** True = public, False = closed, null/undefined = unknown (fails open). */
  profilesOpen?: boolean | null;
  /** When the tournament requires a subscription, a confirmed refusal blocks admission. */
  requireSubscription?: boolean;
  /**
   * Composed outcome as sent by the server. Deliberately NOT re-derived on the
   * client: under `any` mode one red per-provider chip next to a green one is
   * still a pass, so only the composed answer may drive admission.
   */
  subscriptionOutcome?: SubscriptionOutcome | null;
}

interface AdmissionStatusBadgeProps extends AdmissionOptions {
  registrationStatus: string;
  balancerStatus: string | undefined | null;
  checkedIn: boolean | undefined | null;
  className?: string;
}

export function isAdmitted(
  registrationStatus: string,
  balancerStatus: string | undefined | null,
  checkedIn: boolean | undefined | null,
  options?: AdmissionOptions
): boolean {
  if (registrationStatus !== "approved" || balancerStatus !== "ready" || checkedIn !== true) {
    return false;
  }
  // Open-profile requirement: only a *confirmed* closed profile blocks admission
  // (unknown fails open, matching the server-side check-in gate).
  if (options?.requireOpenProfile && options.profilesOpen === false) {
    return false;
  }
  // Subscription requirement: identical rule, one layer over — only a confirmed
  // refusal blocks. "undetermined" (provider outage, unlinked account, missing
  // scope) fails open exactly as the server gate does.
  if (options?.requireSubscription && options.subscriptionOutcome === "refused") {
    return false;
  }
  return true;
}

export function AdmissionStatusBadge({
  registrationStatus,
  balancerStatus,
  checkedIn,
  requireOpenProfile,
  profilesOpen,
  requireSubscription,
  subscriptionOutcome,
  className
}: AdmissionStatusBadgeProps) {
  const t = useTranslations();

  const isProfileClosed = requireOpenProfile && profilesOpen === false;
  const isSubscriptionRefused = requireSubscription && subscriptionOutcome === "refused";
  const isApprovedAndReady =
    registrationStatus === "approved" &&
    balancerStatus === "ready" &&
    !isProfileClosed &&
    !isSubscriptionRefused;

  if (!isApprovedAndReady) {
    return (
      <StatusIconBadge
        icon={XCircle}
        label={t("common.admissionStatus.notAdmitted")}
        tone="negative"
        className={className}
      />
    );
  }
  if (checkedIn === true) {
    return (
      <StatusIconBadge
        icon={CheckCircle2}
        label={t("common.admissionStatus.admitted")}
        tone="positive"
        className={className}
      />
    );
  }
  return (
    <StatusIconBadge
      icon={Clock}
      label={t("common.admissionStatus.pendingCheckIn")}
      tone="warning"
      className={className}
    />
  );
}

interface ProfileStatusBadgeProps {
  /** True = public, False = closed, null/undefined = unknown / not checked yet. */
  profilesOpen: boolean | null | undefined;
  className?: string;
}

export function ProfileStatusBadge({ profilesOpen, className }: ProfileStatusBadgeProps) {
  const t = useTranslations();

  if (profilesOpen === true) {
    return (
      <StatusIconBadge
        icon={Unlock}
        label={t("common.profileOpen")}
        tone="positive"
        className={className}
      />
    );
  }
  if (profilesOpen === false) {
    return (
      <StatusIconBadge
        icon={Lock}
        label={t("common.profileClosed")}
        tone="negative"
        className={className}
      />
    );
  }
  return (
    <StatusIconBadge
      icon={Circle}
      label={t("common.profileNotChecked")}
      tone="neutral"
      className={className}
    />
  );
}


interface SubscriptionStatusBadgeProps {
  /** Composed outcome from the server; null/undefined = not required or unknown. */
  outcome: SubscriptionOutcome | null | undefined;
  className?: string;
}

/**
 * The COMPOSED subscription verdict, for admin tables and the admission column.
 *
 * Renders three states, not two: an outage must be visually distinct from a
 * confirmed refusal, because only the latter blocks. Per-provider detail belongs
 * in the row detail (see `SubscriptionProviderBadge`) — one column per provider
 * would not scale, and under `any` mode a red provider cell beside a green one
 * reads as a failure when it is not.
 */
export function SubscriptionStatusBadge({ outcome, className }: SubscriptionStatusBadgeProps) {
  const t = useTranslations();

  if (outcome === "satisfied") {
    return (
      <StatusIconBadge
        icon={HeartHandshake}
        label={t("common.subscription.satisfied")}
        tone="positive"
        className={className}
      />
    );
  }
  if (outcome === "refused") {
    return (
      <StatusIconBadge
        icon={HeartCrack}
        label={t("common.subscription.refused")}
        tone="negative"
        className={className}
      />
    );
  }
  return (
    <StatusIconBadge
      icon={Circle}
      label={t("common.subscription.undetermined")}
      tone="neutral"
      className={className}
    />
  );
}

interface SubscriptionProviderBadgeProps {
  providerLabel: string;
  verdict: SubscriptionProviderVerdict | undefined;
  className?: string;
}

/**
 * One provider's verdict, for the registration form's account rows.
 *
 * Shows the provider's own tier label rather than the numeric rank: Boosty
 * "Уровень 2" and Twitch "Tier 2" are unrelated scales and a bare number would
 * imply they are comparable.
 */
export function SubscriptionProviderBadge({
  providerLabel,
  verdict,
  className
}: SubscriptionProviderBadgeProps) {
  const t = useTranslations();

  if (verdict?.state === "active") {
    return (
      <StatusIconBadge
        icon={HeartHandshake}
        label={verdict.tier_label ? `${providerLabel}: ${verdict.tier_label}` : providerLabel}
        tone="positive"
        className={className}
      />
    );
  }
  if (verdict?.state === "inactive") {
    return (
      <StatusIconBadge
        icon={HeartCrack}
        label={`${providerLabel}: ${t("common.subscription.none")}`}
        tone="negative"
        className={className}
      />
    );
  }
  return (
    <StatusIconBadge
      icon={Circle}
      label={`${providerLabel}: ${t("common.subscription.unchecked")}`}
      tone="neutral"
      className={className}
    />
  );
}