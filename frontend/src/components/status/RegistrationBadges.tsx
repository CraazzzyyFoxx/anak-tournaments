import React from "react";
import { CheckCircle2, Circle, Clock, Lock, Unlock, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import StatusMetaBadge from "@/components/status/StatusMetaBadge";
import { StatusIconBadge } from "@/components/status/StatusIconBadge";
import type { StatusMeta } from "@/types/registration.types";

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
  return true;
}

export function AdmissionStatusBadge({
  registrationStatus,
  balancerStatus,
  checkedIn,
  requireOpenProfile,
  profilesOpen,
  className
}: AdmissionStatusBadgeProps) {
  const t = useTranslations();

  const isProfileClosed = requireOpenProfile && profilesOpen === false;
  const isApprovedAndReady =
    registrationStatus === "approved" && balancerStatus === "ready" && !isProfileClosed;

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
