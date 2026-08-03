"use client";

import {
  createElement,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  Search,
  ShieldBan,
  X,
  XCircle,
  Tv,
  ChevronDown,
  ChevronUp
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { FilterChip } from "@/components/ui/filter-chip";
import { cn, hexToRgba } from "@/lib/utils";
import { isPhaseWindowActive } from "@/lib/tournament-status";
import { useAuthProfile } from "@/hooks/useAuthProfile";
import { tournamentQueryKeys } from "@/lib/tournament-query-keys";
import registrationService from "@/services/registration.service";
import type { Tournament } from "@/types/tournament.types";
import type { Registration, RegistrationStatus } from "@/types/registration.types";

import ColumnPicker from "./_components/ColumnPicker";
import { buildParticipantColumns } from "./_components/participantsColumns";
import {
  PARTICIPANT_SEARCH_MAX_LENGTH,
  isMandatoryParticipantColumnId,
  parseStoredParticipantColumnIds,
  participantColumnsStorageKey,
  participantDefaultColumnIds,
  participantResultsScrollTarget,
  participantResultsTransitionSignature,
  readParticipantUrlState,
  shouldScrollParticipantResults,
  subscribeParticipantColumnsStorage,
  updateParticipantUrlState,
  writeStoredParticipantColumnIds,
  type ParticipantUrlUpdate
} from "./_components/participants-url-state";
import { useParticipantSearchInput } from "./_components/useParticipantSearchInput";
import VirtualParticipantsList from "./_components/VirtualParticipantsList";
import { useTranslations, useLocale } from "next-intl";
import { useDivisionGrid } from "@/hooks/useCurrentWorkspace";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { getStatusIcon } from "@/lib/status-icons";
import { formatSubroleSlug } from "@/lib/roles";
import { TournamentParticipantsSkeleton } from "../_components/TournamentSkeletons";
import { TournamentPageState } from "../_components/TournamentPageState";
import { useTournamentQuery } from "../_hooks/useTournamentClientData";
import styles from "../TournamentDetail.module.css";

// ---------------------------------------------------------------------------
// My registration status bar / card configs
// ---------------------------------------------------------------------------

// Every pill below follows one tint recipe — solid token text over a 10% wash
// with a 20% border — written out literally because Tailwind only emits
// arbitrary values it can see verbatim in the source.
const STATUS_BAR_CONFIG: Record<RegistrationStatus, { icon: typeof Clock; color: string }> = {
  pending: {
    icon: Clock,
    color:
      "text-[color:var(--aqt-amber)] border-[color:color-mix(in_srgb,var(--aqt-amber)_20%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-amber)_10%,transparent)]"
  },
  approved: {
    icon: CheckCircle2,
    color:
      "text-[color:var(--aqt-emerald)] border-[color:color-mix(in_srgb,var(--aqt-emerald)_20%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-emerald)_10%,transparent)]"
  },
  rejected: {
    icon: XCircle,
    color:
      "text-[color:var(--aqt-rose)] border-[color:color-mix(in_srgb,var(--aqt-rose)_20%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-rose)_10%,transparent)]"
  },
  withdrawn: {
    icon: XCircle,
    color:
      "text-[color:var(--aqt-fg-dim)] border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-3)]"
  },
  banned: {
    icon: ShieldBan,
    color:
      "text-[color:var(--aqt-rose)] border-[color:color-mix(in_srgb,var(--aqt-rose)_20%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-rose)_10%,transparent)]"
  },
  insufficient_data: {
    icon: AlertTriangle,
    color:
      "text-[color:var(--aqt-damage)] border-[color:color-mix(in_srgb,var(--aqt-damage)_20%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-damage)_10%,transparent)]"
  }
};

const ROLE_ACCENT_CLASSES: Record<string, { bg: string; text: string; border: string }> = {
  tank: {
    bg: "bg-[color:color-mix(in_srgb,var(--aqt-tank)_10%,transparent)]",
    text: "text-[color:var(--aqt-tank)]",
    border: "border-[color:color-mix(in_srgb,var(--aqt-tank)_20%,transparent)]"
  },
  dps: {
    bg: "bg-[color:color-mix(in_srgb,var(--aqt-damage)_10%,transparent)]",
    text: "text-[color:var(--aqt-damage)]",
    border: "border-[color:color-mix(in_srgb,var(--aqt-damage)_20%,transparent)]"
  },
  support: {
    bg: "bg-[color:color-mix(in_srgb,var(--aqt-support)_10%,transparent)]",
    text: "text-[color:var(--aqt-support)]",
    border: "border-[color:color-mix(in_srgb,var(--aqt-support)_20%,transparent)]"
  },
  flex: {
    bg: "bg-[color:color-mix(in_srgb,var(--aqt-violet)_10%,transparent)]",
    text: "text-[color:var(--aqt-violet)]",
    border: "border-[color:color-mix(in_srgb,var(--aqt-violet)_20%,transparent)]"
  }
};

const ROLE_TO_ICON: Record<string, string> = {
  tank: "Tank",
  dps: "Damage",
  support: "Support",
  flex: "Flex"
};

function getRoleLabel(role: string, t: ReturnType<typeof useTranslations<never>>): string {
  switch (role.toLowerCase()) {
    case "tank":
      return t("common.roles.tank");
    case "dps":
      return t("common.roles.dps");
    case "support":
      return t("common.roles.support");
    case "flex":
      return t("common.roles.flex");
    default:
      return role.charAt(0).toUpperCase() + role.slice(1);
  }
}

const DiscordIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 127.14 96.36" fill="currentColor" {...props}>
    <path d="M107.7,8.07A105.15,105.15,0,0,0,77.26,0a77.19,77.19,0,0,0-3.3,6.83A96.67,96.67,0,0,0,53.22,6.83,77.19,77.19,0,0,0,49.88,0,105.15,105.15,0,0,0,19.44,8.07C3.66,31.58-1.86,54.65,1,77.53A105.73,105.73,0,0,0,32,96.36a77.7,77.7,0,0,0,6.63-10.85,68.43,68.43,0,0,1-10.5-5c.87-.64,1.72-1.31,2.53-2a75.76,75.76,0,0,0,73,0c.81.69,1.66,1.36,2.53,2a68.43,68.43,0,0,1-10.5,5,77.7,77.7,0,0,0,6.63,10.85,105.73,105.73,0,0,0,31-18.83C129.86,49.2,123.63,26.54,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53S36.18,40.36,42.45,40.36,53.83,46,53.83,53,48.72,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.24,60,73.24,53S78.41,40.36,84.69,40.36,96.07,46,96.07,53,91,65.69,84.69,65.69Z" />
  </svg>
);

// lucide 1.x dropped brand icons; same local-SVG treatment as DiscordIcon above.
const TwitchIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
  </svg>
);

const STATUS_FILTER_META: Record<RegistrationStatus, { dot: string }> = {
  approved: { dot: "var(--aqt-emerald)" },
  pending: { dot: "var(--aqt-amber)" },
  insufficient_data: { dot: "var(--aqt-amber)" },
  rejected: { dot: "var(--aqt-rose)" },
  banned: { dot: "var(--aqt-rose)" },
  withdrawn: { dot: "var(--aqt-fg-dim)" }
};

const STATUS_FILTER_ORDER: RegistrationStatus[] = [
  "approved",
  "pending",
  "insufficient_data",
  "rejected",
  "banned",
  "withdrawn"
];

// localeKeyMap removed to support DB status names without hardcoded translation

type StatusFilter = "all" | RegistrationStatus;

type RegistrationStepTone = "done" | "active" | "failed" | "idle";

interface RegistrationStep {
  key: string;
  label: string;
  tone: RegistrationStepTone;
}

/** Statuses that permanently take the registration out of the tournament. */
const TERMINAL_REGISTRATION_STATUSES = new Set<string>(["rejected", "banned", "withdrawn"]);

const CHECK_IN_OVER_TOURNAMENT_STATUSES = new Set<string>([
  "live",
  "playoffs",
  "completed",
  "archived"
]);

function RegistrationStepMarker({ tone }: { tone: RegistrationStepTone }) {
  switch (tone) {
    case "done":
      return (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-[color:color-mix(in_srgb,var(--aqt-emerald)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-emerald)_15%,transparent)] text-[color:var(--aqt-emerald)]">
          <Check className="size-3.5" strokeWidth={3} aria-hidden />
        </span>
      );
    case "failed":
      return (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-[color:color-mix(in_srgb,var(--aqt-rose)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-rose)_15%,transparent)] text-[color:var(--aqt-rose)]">
          <X className="size-3.5" strokeWidth={3} aria-hidden />
        </span>
      );
    case "active":
      return (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-[color:color-mix(in_srgb,var(--aqt-amber)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-amber)_10%,transparent)]">
          <span
            aria-hidden
            className="size-2 animate-pulse rounded-full bg-[color:var(--aqt-amber)] motion-reduce:animate-none"
          />
        </span>
      );
    default:
      return (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-3)]">
          <span aria-hidden className="size-1.5 rounded-full bg-[color:var(--aqt-fg-dim)]" />
        </span>
      );
  }
}

function RegistrationRoleChip({
  role,
  showPrimaryMark,
  t
}: {
  role: Registration["roles"][number];
  showPrimaryMark: boolean;
  t: ReturnType<typeof useTranslations<never>>;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        ROLE_ACCENT_CLASSES[role.role]?.bg,
        ROLE_ACCENT_CLASSES[role.role]?.border,
        ROLE_ACCENT_CLASSES[role.role]?.text
      )}
    >
      <PlayerRoleIcon role={ROLE_TO_ICON[role.role] ?? role.role} size={12} decorative />
      <span>{getRoleLabel(role.role, t)}</span>
      {role.subrole && (
        <span className="text-[10px] opacity-60">({formatSubroleSlug(role.subrole)})</span>
      )}
      {showPrimaryMark && (
        <span className="text-[10px] uppercase tracking-wide opacity-70">
          · {t("registration.myCard.primaryRole")}
        </span>
      )}
    </div>
  );
}

function MyRegistrationCard({
  registration,
  canCheckIn,
  onCheckIn,
  onWithdraw,
  isCheckingIn,
  isWithdrawing,
  tournament,
  requireOpenProfile,
  requireSubscription
}: {
  registration: Registration;
  canCheckIn: boolean;
  onCheckIn: () => void;
  onWithdraw: () => void;
  isCheckingIn: boolean;
  isWithdrawing: boolean;
  tournament: Tournament;
  requireOpenProfile: boolean;
  requireSubscription: boolean;
}) {
  const t = useTranslations();
  const [isExpanded, setIsExpanded] = useState(false);

  const primaryRole = registration.roles.find((r) => r.is_primary);
  const secondaryRoles = registration.roles
    .filter((r) => !r.is_primary)
    .sort((a, b) => a.priority - b.priority);

  const statusConfig = STATUS_BAR_CONFIG[registration.status] ?? STATUS_BAR_CONFIG.pending;

  const statusMeta = registration.status_meta;
  const statusName =
    statusMeta?.name ??
    registration.status.charAt(0).toUpperCase() + registration.status.slice(1).replace(/_/g, " ");

  let StatusIcon = statusConfig.icon ?? Clock;
  if (statusMeta?.icon_slug) {
    try {
      StatusIcon = getStatusIcon(statusMeta.icon_slug);
    } catch {
      StatusIcon = statusConfig.icon ?? Clock;
    }
  }

  // Custom statuses carry their own accent color; builtin ones use the
  // Tailwind classes from STATUS_BAR_CONFIG.
  let statusChipStyle: React.CSSProperties | undefined = undefined;
  if (statusMeta?.icon_color) {
    const color = statusMeta.icon_color;
    statusChipStyle = {
      color: color,
      borderColor: hexToRgba(color, 0.35) ?? color,
      backgroundColor: hexToRgba(color, 0.12) ?? "transparent"
    };
  }

  const isCheckedIn = registration.checked_in === true;
  const isApproved = registration.status === "approved";
  const isTerminal = TERMINAL_REGISTRATION_STATUSES.has(registration.status);
  const checkInPhaseOver =
    !isCheckedIn && !canCheckIn && CHECK_IN_OVER_TOURNAMENT_STATUSES.has(tournament.status);
  const canWithdraw = registration.status === "pending" || registration.status === "approved";
  // "ready" is the terminal balancer state: the organizers added the player to
  // the pool and assigned a rank. Anything else (not_in_balancer, incomplete,
  // custom slugs, missing field) means the rank is still pending.
  const balancerReady = registration.balancer_status === "ready";

  // Registration journey: submitted -> review/approved -> profile visibility
  // (when required) -> balancing (rank assignment) -> check-in.
  const profileStep: RegistrationStep | null = requireOpenProfile
    ? {
        key: "profile",
        label:
          registration.profiles_open === true
            ? t("common.profileOpen")
            : registration.profiles_open === false
              ? t("common.profileClosed")
              : t("common.profileNotChecked"),
        tone:
          registration.profiles_open === true
            ? "done"
            : registration.profiles_open === false
              ? "failed"
              : isTerminal
                ? "idle"
                : "active"
      }
    : null;

  // Subscription step: only a CONFIRMED refusal is a failure. An undetermined
  // verdict shows as still-pending, matching the gate that fails open.
  const subscriptionStep: RegistrationStep | null = requireSubscription
    ? {
        key: "subscription",
        label:
          registration.subscription_outcome === "satisfied"
            ? t("common.subscription.satisfied")
            : registration.subscription_outcome === "refused"
              ? t("common.subscription.refused")
              : t("common.subscription.undetermined"),
        tone:
          registration.subscription_outcome === "satisfied"
            ? "done"
            : registration.subscription_outcome === "refused"
              ? "failed"
              : isTerminal
                ? "idle"
                : "active"
      }
    : null;

  const steps: RegistrationStep[] = [
    {
      key: "submitted",
      label: t("registration.myCard.steps.submitted"),
      tone: "done"
    },
    {
      key: "review",
      label:
        isApproved || isCheckedIn
          ? t("registration.myCard.steps.approved")
          : isTerminal
            ? statusName
            : t("registration.myCard.steps.review"),
      tone: isApproved || isCheckedIn ? "done" : isTerminal ? "failed" : "active"
    },
    ...(profileStep ? [profileStep] : []),
    ...(subscriptionStep ? [subscriptionStep] : []),
    {
      key: "balancing",
      label: t("registration.myCard.steps.balancing"),
      tone: balancerReady
        ? "done"
        : isTerminal
          ? "idle"
          : isApproved || isCheckedIn
            ? "active"
            : "idle"
    },
    {
      key: "checkIn",
      label: t("registration.myCard.steps.checkIn"),
      tone: isCheckedIn
        ? "done"
        : isTerminal
          ? "idle"
          : canCheckIn
            ? "active"
            : checkInPhaseOver
              ? "failed"
              : "idle"
    }
  ];

  // Single "what happens next" line next to the actions.
  let hintText: string;
  let hintClass = "text-[color:var(--aqt-fg-muted)]";
  if (isCheckedIn) {
    hintText = t("registration.myCard.checkInSuccess");
    hintClass = "font-medium text-[color:var(--aqt-emerald)]";
  } else if (canCheckIn) {
    hintText = t("registration.myCard.checkInOpenDesc");
    hintClass = "font-medium text-[color:var(--aqt-amber)]";
  } else if (isTerminal) {
    hintText = statusMeta?.description || t("registration.myCard.inactiveDesc");
    hintClass = "text-[color:var(--aqt-fg-dim)]";
  } else if (isApproved && checkInPhaseOver) {
    hintText = t("registration.myCard.checkInClosedDesc");
    hintClass = "text-[color:var(--aqt-rose)]";
  } else if (isApproved && !balancerReady) {
    hintText = t("registration.myCard.balancerWaitingDesc");
  } else if (isApproved) {
    hintText = t("registration.myCard.pendingCheckInDesc");
  } else {
    hintText = statusMeta?.description || t("registration.myCard.pendingReviewDesc");
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-1)] shadow-md backdrop-blur-md">
      {/* Decorative gradient blurs */}
      <div
        aria-hidden
        className="absolute -right-16 -top-16 -z-10 size-32 rounded-full bg-[color:color-mix(in_srgb,var(--aqt-blue)_5%,transparent)] blur-2xl"
      />
      <div
        aria-hidden
        className="absolute -bottom-16 -left-16 -z-10 size-32 rounded-full bg-[color:color-mix(in_srgb,var(--aqt-violet)_5%,transparent)] blur-2xl"
      />

      {/* Hero header: big status icon, headline, next-step hint, actions */}
      <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <span
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-xl border",
              statusChipStyle ? undefined : statusConfig.color
            )}
            style={statusChipStyle}
          >
            {createElement(StatusIcon, { className: "size-5", "aria-hidden": true })}
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--aqt-fg-dim)]">
              {t("registration.myCard.title")}
            </p>
            <h3 className="mt-0.5 text-lg font-bold leading-tight text-[color:var(--aqt-fg)]">
              {statusName}
            </h3>
            <p className={cn("mt-0.5 text-xs", hintClass)}>{hintText}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canCheckIn && (
            <button
              type="button"
              onClick={onCheckIn}
              disabled={isCheckingIn}
              className="inline-flex items-center justify-center gap-1 rounded-md bg-[color:var(--aqt-emerald)] px-3 py-1.5 text-xs font-semibold text-[color:var(--aqt-bg)] transition-all hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
            >
              {isCheckingIn && (
                <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
              )}
              {isCheckingIn ? t("common.checkingIn") : t("common.checkIn")}
            </button>
          )}
          {canWithdraw && (
            <button
              type="button"
              onClick={onWithdraw}
              disabled={isWithdrawing || isCheckingIn}
              className="inline-flex items-center justify-center rounded-md border border-[color:color-mix(in_srgb,var(--aqt-rose)_20%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-rose)_5%,transparent)] px-2.5 py-1.5 text-[11px] font-semibold text-[color:var(--aqt-rose)] transition-all hover:border-[color:color-mix(in_srgb,var(--aqt-rose)_40%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--aqt-rose)_10%,transparent)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
            >
              {isWithdrawing && (
                <Loader2 className="mr-1 size-3 animate-spin motion-reduce:animate-none" aria-hidden />
              )}
              {isWithdrawing ? t("common.withdrawing") : t("common.withdraw")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-expanded={isExpanded}
            aria-label={
              isExpanded
                ? t("registration.myCard.hideDetails")
                : t("registration.myCard.showDetails")
            }
            title={
              isExpanded
                ? t("registration.myCard.hideDetails")
                : t("registration.myCard.showDetails")
            }
            className="flex size-8 shrink-0 items-center justify-center text-[color:var(--aqt-fg-dim)] transition-colors hover:text-[color:var(--aqt-fg)]"
          >
            {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        </div>
      </div>

      {/* Progress stepper */}
      <div className="flex items-start px-4 pb-4 sm:px-6">
        {steps.map((step, index) => (
          <Fragment key={step.key}>
            {index > 0 && (
              <div
                aria-hidden="true"
                className={cn(
                  "mx-2 mt-3 h-px flex-1",
                  steps[index - 1].tone === "done"
                    ? "bg-[color:color-mix(in_srgb,var(--aqt-emerald)_40%,transparent)]"
                    : "bg-[color:var(--aqt-border-2)]"
                )}
              />
            )}
            <div className="flex min-w-0 max-w-40 flex-col items-center gap-1.5 text-center">
              <RegistrationStepMarker tone={step.tone} />
              <span
                className={cn(
                  "text-[11px] leading-tight",
                  step.tone === "done" && "text-[color:var(--aqt-emerald)]",
                  step.tone === "active" && "font-medium text-[color:var(--aqt-amber)]",
                  step.tone === "failed" && "text-[color:var(--aqt-rose)]",
                  step.tone === "idle" && "text-[color:var(--aqt-fg-dim)]"
                )}
              >
                {step.label}
              </span>
            </div>
          </Fragment>
        ))}
      </div>

      {/* Expanded details: even groups in one row, notes as a quote below */}
      {isExpanded && (
        <div className="border-t border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-1)] p-4 sm:px-5">
          <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--aqt-fg-dim)]">
                {t("common.rolesList")}
              </h4>
              {primaryRole || secondaryRoles.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {primaryRole && <RegistrationRoleChip role={primaryRole} showPrimaryMark t={t} />}
                  {secondaryRoles.map((r) => (
                    <RegistrationRoleChip
                      key={`${r.role}-${r.subrole ?? "base"}-${r.priority}`}
                      role={r}
                      showPrimaryMark={false}
                      t={t}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs italic text-[color:var(--aqt-fg-dim)]">
                  {t("registration.myCard.noSecondaryRoles")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--aqt-fg-dim)]">
                {t("registration.myCard.accounts")}
              </h4>
              <div className="flex flex-wrap gap-1.5 text-xs">
                {registration.battle_tag && (
                  <div className="flex items-center gap-1.5 rounded-md border border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-1)] px-2 py-1">
                    {/* eslint-disable-next-line @next/next/no-img-element -- small static asset from /public */}
                    <img alt="Battle.net" className="size-3.5" src="/battlenet.svg" />
                    <span className="font-semibold text-[color:var(--aqt-fg)]">
                      {registration.battle_tag}
                    </span>
                  </div>
                )}
                {registration.discord_nick && (
                  <div className="flex items-center gap-1.5 rounded-md border border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-1)] px-2 py-1">
                    <DiscordIcon aria-hidden className="size-3.5 text-[color:var(--aqt-brand-discord)]" />
                    <span className="text-[color:var(--aqt-fg-muted)]">
                      {registration.discord_nick}
                    </span>
                  </div>
                )}
                {registration.twitch_nick && (
                  <div className="flex items-center gap-1.5 rounded-md border border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-1)] px-2 py-1">
                    <TwitchIcon aria-hidden className="size-3.5 text-[color:var(--aqt-brand-twitch)]" />
                    <span className="text-[color:var(--aqt-fg-muted)]">
                      {registration.twitch_nick}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--aqt-fg-dim)]">
                {t("registration.details.streamPov")}
              </h4>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium",
                  registration.stream_pov
                    ? "border-[color:color-mix(in_srgb,var(--aqt-emerald)_20%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-emerald)_10%,transparent)] text-[color:var(--aqt-emerald)]"
                    : "border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-1)] text-[color:var(--aqt-fg-dim)]"
                )}
              >
                <Tv className="size-3.5" aria-hidden />
                {registration.stream_pov
                  ? t("registration.myCard.streamPovActive")
                  : t("registration.myCard.streamPovInactive")}
              </span>
            </div>
          </div>

          {registration.notes ? (
            <div className="mt-4 space-y-1.5">
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--aqt-fg-dim)]">
                {t("registration.details.notes")}
              </h4>
              <p className="border-l-2 border-[color:var(--aqt-border-2)] pl-3 text-xs italic leading-relaxed text-[color:var(--aqt-fg-muted)]">
                &ldquo;{registration.notes}&rdquo;
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function isCheckInWindowActive(tournament: Tournament) {
  return isPhaseWindowActive(tournament, "check_in");
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function TournamentParticipantsView({ tournament }: { tournament: Tournament }) {
  const t = useTranslations();
  const locale = useLocale();
  const { user, status: authStatus } = useAuthProfile();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const resultsHeadingRef = useRef<HTMLDivElement>(null);
  const previousResultsSignatureRef = useRef<string | null>(null);
  const [isWithdrawDialogOpen, setIsWithdrawDialogOpen] = useState(false);
  const [isCheckInDialogOpen, setIsCheckInDialogOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const toggleExpanded = (registrationId: number) =>
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(registrationId)) {
        next.delete(registrationId);
      } else {
        next.add(registrationId);
      }
      return next;
    });

  const isAuthenticated = authStatus === "authenticated" && user !== null;

  const myRegQuery = useQuery({
    queryKey: tournamentQueryKeys.registration(tournament.workspace_id, tournament.id),
    queryFn: () => registrationService.getMyRegistration(tournament.id),
    enabled: isAuthenticated
  });

  const listQuery = useQuery({
    queryKey: tournamentQueryKeys.registrationsList(tournament.workspace_id, tournament.id),
    queryFn: () => registrationService.listRegistrations(tournament.id)
  });

  const formQuery = useQuery({
    queryKey: tournamentQueryKeys.registrationForm(tournament.workspace_id, tournament.id),
    queryFn: () => registrationService.getForm(tournament.id)
  });

  const withdrawMutation = useMutation({
    mutationFn: () => registrationService.withdrawMyRegistration(tournament.id),
    onSuccess: async () => {
      setIsWithdrawDialogOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: tournamentQueryKeys.registration(tournament.workspace_id, tournament.id)
        }),
        queryClient.invalidateQueries({
          queryKey: tournamentQueryKeys.registrationsList(tournament.workspace_id, tournament.id)
        }),
        queryClient.invalidateQueries({
          queryKey: tournamentQueryKeys.registrationForm(tournament.workspace_id, tournament.id)
        })
      ]);
    }
  });

  const checkInMutation = useMutation({
    mutationFn: () => registrationService.checkInMyRegistration(tournament.id),
    onSuccess: (updated) => {
      setIsCheckInDialogOpen(false);
      // The response IS the updated registration: write it into the cache
      // instead of refetching. The list refetch is fire-and-forget — our own
      // commit just invalidated the gateway entry, so awaiting it kept the
      // button spinning through the post-invalidation rebuild (and the WS
      // structure_changed event refreshes the list anyway).
      queryClient.setQueryData(
        tournamentQueryKeys.registration(tournament.workspace_id, tournament.id),
        updated
      );
      void queryClient.invalidateQueries({
        queryKey: tournamentQueryKeys.registrationsList(tournament.workspace_id, tournament.id)
      });
    }
  });

  const registrations = listQuery.data ?? [];
  const myRegistration = myRegQuery.data;
  const form = formQuery.data ?? null;
  const canCheckIn =
    Boolean(myRegistration) &&
    myRegistration?.status === "approved" &&
    myRegistration.checked_in !== true &&
    isCheckInWindowActive(tournament);

  const divisionGrid = useDivisionGrid();

  // Dynamic columns
  const allColumns = useMemo(
    () => buildParticipantColumns(form, t, locale, divisionGrid),
    [form, t, locale, divisionGrid]
  );

  // Status counts + chips present in the data.
  const statusCounts = useMemo(() => {
    const counts: Partial<Record<RegistrationStatus, number>> = {};
    for (const reg of registrations) {
      counts[reg.status] = (counts[reg.status] ?? 0) + 1;
    }
    return counts;
  }, [registrations]);

  const presentStatuses = useMemo(() => {
    // Collect all unique statuses actually present in registrations
    const uniqueStatuses = Array.from(new Set(registrations.map((r) => r.status)));

    // Sort them so that built-in ones in STATUS_FILTER_ORDER come first, and any others (custom) come after
    return uniqueStatuses.sort((a, b) => {
      const idxA = STATUS_FILTER_ORDER.indexOf(a);
      const idxB = STATUS_FILTER_ORDER.indexOf(b);

      if (idxA !== -1 && idxB !== -1) {
        return idxA - idxB;
      }
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;

      // Both are custom, sort alphabetically
      return a.localeCompare(b);
    });
  }, [registrations]);
  const allowedStatuses = useMemo(
    () => Array.from(new Set([...STATUS_FILTER_ORDER, ...presentStatuses])),
    [presentStatuses]
  );

  const statusMetaMap = useMemo(() => {
    const map: Record<string, { name: string; dot: string }> = {};
    for (const reg of registrations) {
      if (!map[reg.status]) {
        // Resolve name: prefer status_meta.name, fallback to humanized value
        let name = reg.status_meta?.name ?? reg.status;
        if (name === reg.status) {
          name = name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, " ");
        }

        // Resolve dot color: prefer status_meta.icon_color, fallback to STATUS_FILTER_META, fallback to gray
        let dot = reg.status_meta?.icon_color ?? "";
        if (!dot) {
          dot = STATUS_FILTER_META[reg.status as RegistrationStatus]?.dot ?? "var(--aqt-fg-dim)";
        }

        map[reg.status] = { name, dot };
      }
    }
    return map;
  }, [registrations]);

  const defaultColumnIds = useMemo(() => participantDefaultColumnIds(allColumns), [allColumns]);
  // Optional column ids persisted per tournament. localStorage is an external
  // store: the raw entry is read via useSyncExternalStore (server snapshot is
  // null, so SSR/hydration never touches it) and writers notify subscribers.
  const storedColumnsRaw = useSyncExternalStore(
    subscribeParticipantColumnsStorage,
    () => {
      try {
        return window.localStorage.getItem(participantColumnsStorageKey(tournament.id));
      } catch {
        return null;
      }
    },
    () => null
  );
  const storedColumnIds = useMemo(
    () => parseStoredParticipantColumnIds(storedColumnsRaw),
    [storedColumnsRaw]
  );
  const persistColumns = useCallback(
    (visibleIds: readonly string[]) => {
      writeStoredParticipantColumnIds(
        typeof window === "undefined" ? null : window.localStorage,
        tournament.id,
        visibleIds,
        defaultColumnIds
      );
    },
    [defaultColumnIds, tournament.id]
  );
  const participantUrl = useMemo(
    () =>
      readParticipantUrlState(
        new URLSearchParams(searchParamsString),
        allowedStatuses,
        allColumns,
        storedColumnIds
      ),
    [allColumns, allowedStatuses, searchParamsString, storedColumnIds]
  );
  const latestParamsRef = useRef(searchParamsString);
  const searchQuery = participantUrl.state.search;
  const statusFilter = participantUrl.state.status as StatusFilter;
  const displayedStatuses = useMemo(
    () =>
      statusFilter !== "all" && !presentStatuses.includes(statusFilter)
        ? [...presentStatuses, statusFilter]
        : presentStatuses,
    [presentStatuses, statusFilter]
  );
  const visibleColumnIds = participantUrl.state.visibleColumnIds;
  const visibleColumnIdSet = useMemo(() => new Set(visibleColumnIds), [visibleColumnIds]);
  const visibleColumns = useMemo(
    () => allColumns.filter((column) => visibleColumnIdSet.has(column.id)),
    [allColumns, visibleColumnIdSet]
  );
  const visibility = useMemo(
    () =>
      Object.fromEntries(
        allColumns.map((column) => [column.id, visibleColumnIdSet.has(column.id)])
      ),
    [allColumns, visibleColumnIdSet]
  );

  useEffect(() => {
    latestParamsRef.current = searchParamsString;
  }, [searchParamsString]);

  const navigateParticipantUrl = useCallback(
    (update: ParticipantUrlUpdate) => {
      const result = updateParticipantUrlState(
        new URLSearchParams(latestParamsRef.current),
        update
      );
      const query = result.params.toString();
      const href = query ? `${pathname}?${query}` : pathname;
      latestParamsRef.current = query;
      if (result.history === "replace") router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [pathname, router]
  );
  const commitSearch = useCallback(
    (value: string) => navigateParticipantUrl({ type: "search", value }),
    [navigateParticipantUrl]
  );
  const { inputRef: participantSearchInputRef, onChange: handleParticipantSearchChange } =
    useParticipantSearchInput({
      canonicalSearch: searchQuery,
      canonicalUrl: searchParamsString,
      onCommit: commitSearch
    });

  useEffect(() => {
    if (!listQuery.isFetched || !formQuery.isFetched || !participantUrl.needsNormalization) {
      return;
    }
    const query = participantUrl.params.toString();
    const href = query ? `${pathname}?${query}` : pathname;
    latestParamsRef.current = query;
    router.replace(href, { scroll: false });
  }, [
    formQuery.isFetched,
    listQuery.isFetched,
    participantUrl.needsNormalization,
    participantUrl.params,
    pathname,
    router
  ]);

  const toggleColumn = useCallback(
    (columnId: string) => {
      if (isMandatoryParticipantColumnId(columnId)) return;
      const nextIds = visibleColumnIdSet.has(columnId)
        ? visibleColumnIds.filter((id) => id !== columnId)
        : allColumns
            .filter((column) => column.id === columnId || visibleColumnIdSet.has(column.id))
            .map((column) => column.id);
      persistColumns(nextIds);
      navigateParticipantUrl({
        type: "columns",
        value: nextIds,
        defaultValue: defaultColumnIds
      });
    },
    [
      allColumns,
      defaultColumnIds,
      navigateParticipantUrl,
      persistColumns,
      visibleColumnIdSet,
      visibleColumnIds
    ]
  );
  const resetToDefaults = useCallback(() => {
    persistColumns(defaultColumnIds);
    navigateParticipantUrl({
      type: "columns",
      value: defaultColumnIds,
      defaultValue: defaultColumnIds
    });
  }, [defaultColumnIds, navigateParticipantUrl, persistColumns]);

  // Status filter + dynamic search across all searchable columns.
  const filtered = useMemo(() => {
    const byStatus =
      statusFilter === "all"
        ? registrations
        : registrations.filter((r) => r.status === statusFilter);

    if (!searchQuery.trim()) return byStatus;
    const q = searchQuery.trim().toLowerCase();
    return byStatus.filter((r) =>
      visibleColumns.some((col) => {
        if (!col.searchValue) return false;
        const val = col.searchValue(r);
        return val?.toLowerCase().includes(q) ?? false;
      })
    );
  }, [registrations, searchQuery, statusFilter, visibleColumns]);

  const resultsSignature = useMemo(
    () =>
      participantResultsTransitionSignature({
        search: searchQuery,
        status: statusFilter,
        visibleColumnIds
      }),
    [searchQuery, statusFilter, visibleColumnIds]
  );
  useEffect(() => {
    if (previousResultsSignatureRef.current === null) {
      previousResultsSignatureRef.current = resultsSignature;
      return;
    }
    if (previousResultsSignatureRef.current === resultsSignature) return;
    previousResultsSignatureRef.current = resultsSignature;

    const frame = window.requestAnimationFrame(() => {
      const heading = resultsHeadingRef.current;
      if (!heading) return;
      const headingDocumentTop = heading.getBoundingClientRect().top + window.scrollY;
      const stickyOffset = 112;
      if (
        shouldScrollParticipantResults({
          scrollY: window.scrollY,
          headingDocumentTop,
          stickyOffset
        })
      ) {
        window.scrollTo({
          top: participantResultsScrollTarget(headingDocumentTop, stickyOffset),
          behavior: "auto"
        });
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [resultsSignature]);

  const trueEmpty = listQuery.data !== undefined && registrations.length === 0;
  const filteredEmpty = !trueEmpty && filtered.length === 0;

  if (listQuery.isPending && listQuery.data === undefined) {
    return <TournamentParticipantsSkeleton />;
  }

  if (listQuery.isError && listQuery.data === undefined) {
    return <TournamentPageState state="initial-error" onRetry={() => void listQuery.refetch()} />;
  }

  return (
    <div className="space-y-5" data-participant-layout="true">
      {/* My registration status */}
      {myRegistration && (
        <MyRegistrationCard
          registration={myRegistration}
          canCheckIn={canCheckIn}
          onCheckIn={() => setIsCheckInDialogOpen(true)}
          onWithdraw={() => setIsWithdrawDialogOpen(true)}
          isCheckingIn={checkInMutation.isPending}
          isWithdrawing={withdrawMutation.isPending}
          tournament={tournament}
          requireOpenProfile={formQuery.data?.require_open_profile ?? false}
          requireSubscription={formQuery.data?.require_subscription ?? false}
        />
      )}

      <AlertDialog open={isCheckInDialogOpen} onOpenChange={setIsCheckInDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.confirmCheckIn")}</AlertDialogTitle>
            <AlertDialogDescription>{t("common.checkInDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={checkInMutation.isPending}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                checkInMutation.mutate();
              }}
              disabled={checkInMutation.isPending}
              className="border border-[color:color-mix(in_srgb,var(--aqt-emerald)_30%,transparent)] bg-[color:var(--aqt-emerald)] text-[color:var(--aqt-bg)] hover:brightness-110"
            >
              {checkInMutation.isPending ? t("common.checkingIn") : t("common.checkIn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isWithdrawDialogOpen} onOpenChange={setIsWithdrawDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.withdrawReg")}</AlertDialogTitle>
            <AlertDialogDescription>{t("common.withdrawDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={withdrawMutation.isPending}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                withdrawMutation.mutate();
              }}
              disabled={withdrawMutation.isPending}
              className="bg-[color:var(--aqt-rose)] text-[color:var(--aqt-bg)] hover:brightness-110"
            >
              {withdrawMutation.isPending ? t("common.withdrawing") : t("common.confirmWithdraw")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <p aria-atomic="true" aria-live="polite" className="sr-only">
        {t("tournamentDetail.participants.resultCount", { count: filtered.length })}
      </p>

      {/* Status filter chips + search + column picker */}
      {!trueEmpty && (
        <div className="filters" role="group" aria-label={t("common.filters")} ref={resultsHeadingRef}>
          <FilterChip
            active={statusFilter === "all"}
            count={registrations.length}
            onClick={() => navigateParticipantUrl({ type: "status", value: "all" })}
          >
            {t("common.all")}
          </FilterChip>
          {displayedStatuses.map((status) => {
            const meta = statusMetaMap[status];
            return (
              <FilterChip
                key={status}
                active={statusFilter === status}
                count={statusCounts[status] ?? 0}
                dotColor={meta?.dot ?? "var(--aqt-fg-dim)"}
                onClick={() =>
                  navigateParticipantUrl({
                    type: "status",
                    value: statusFilter === status ? "all" : status
                  })
                }
              >
                {meta?.name ?? status}
              </FilterChip>
            );
          })}
          <div className="filter-search">
            <Search size={13} aria-hidden />
            <input
              aria-label={t("common.searchParticipants")}
              defaultValue={searchQuery}
              maxLength={PARTICIPANT_SEARCH_MAX_LENGTH}
              onChange={handleParticipantSearchChange}
              placeholder={t("common.searchParticipants")}
              ref={participantSearchInputRef}
            />
          </div>
          <ColumnPicker
            columns={allColumns}
            visibility={visibility}
            onToggle={toggleColumn}
            onReset={resetToDefaults}
          />
        </div>
      )}

      {/* Participants list */}
      {filtered.length > 0 ? (
        <VirtualParticipantsList
          allColumns={allColumns}
          expandedIds={expandedIds}
          onToggleExpanded={toggleExpanded}
          registrations={filtered}
          visibleColumns={visibleColumns}
        />
      ) : filteredEmpty ? (
        <TournamentPageState
          state="filtered-empty"
          onReset={() => {
            persistColumns(defaultColumnIds);
            navigateParticipantUrl({ type: "reset" });
          }}
        />
      ) : (
        <TournamentPageState
          state="empty"
          title={t("tournamentDetail.participants.empty.title")}
          description={t("tournamentDetail.participants.empty.description")}
        />
      )}

      {listQuery.isError && listQuery.data !== undefined ? (
        <div className={styles.refreshMessage} role="alert">
          <span>
            <strong>{t("tournamentDetail.pageState.refreshError.title")}</strong>
            {" — "}
            {t("tournamentDetail.pageState.refreshError.description")}
          </span>
          <button
            className={styles.stateAction}
            onClick={() => void listQuery.refetch()}
            type="button"
          >
            {t("tournamentDetail.pageState.retry")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Resolves the shared tournament overview so the route file stays a one-line
 * delegation, matching every other tournament sub-route. The overview is
 * already primed by the layout, so this is a cache read in practice — the
 * guards below only fire if that layout contract ever changes.
 */
export default function TournamentParticipantsPage({ tournamentId }: { tournamentId: number }) {
  const tournamentQuery = useTournamentQuery(tournamentId);

  if (!tournamentQuery.data) {
    if (tournamentQuery.isError) {
      return (
        <TournamentPageState state="initial-error" onRetry={() => void tournamentQuery.refetch()} />
      );
    }
    return <TournamentParticipantsSkeleton />;
  }

  return <TournamentParticipantsView tournament={tournamentQuery.data} />;
}
