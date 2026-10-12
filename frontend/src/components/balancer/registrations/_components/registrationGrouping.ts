import { ADMISSION_ORDER } from "@/lib/registration/admission";
import type { AdminRegistration } from "@/types/balancer-admin.types";
import type { AdmissionDecision } from "@/types/registration.types";

export type RegistrationGroupingMode = "none" | "check_in" | "balancer_status" | "admission";

export interface RegistrationGroup {
  key: string;
  label: string;
  registrations: AdminRegistration[];
}
/** Group headers, named by the caller in its own language (the `grouping` messages). */
export type RegistrationGroupLabelKey =
  | "all"
  | "checkedIn"
  | "notCheckedIn"
  | "admitted"
  | "checkInPending"
  | "notAdmitted";

type GroupTranslator = (key: RegistrationGroupLabelKey) => string;

const GROUPING_MODES = new Set<RegistrationGroupingMode>([
  "none",
  "check_in",
  "balancer_status",
  "admission"
]);

const BALANCER_STATUS_ORDER = new Map<string, number>([
  ["ready", 0],
  ["incomplete", 1],
  ["not_in_balancer", 2]
]);

/** Group headers for the admission modes, keyed by the server's decision.
 *
 *  This replaced a local re-derivation of admission from four raw fields, which
 *  mirrored a second copy in `RegistrationBadges` by hand and had already
 *  drifted from the two in the column builder. `sortOrder` reuses
 *  `ADMISSION_ORDER` so the group order and the column's sort cannot disagree. */
const ADMISSION_GROUP_LABELS: Record<AdmissionDecision, RegistrationGroupLabelKey> = {
  admitted: "admitted",
  pending_check_in: "checkInPending",
  not_admitted: "notAdmitted"
};

const humanizeStatusValue = (value: string): string =>
  value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const getGroupMeta = (
  registration: AdminRegistration,
  mode: RegistrationGroupingMode,
  t: GroupTranslator
): { key: string; label: string; sortOrder: number } => {
  if (mode === "check_in") {
    return registration.checked_in
      ? { key: "checked_in", label: t("checkedIn"), sortOrder: 0 }
      : { key: "not_checked_in", label: t("notCheckedIn"), sortOrder: 1 };
  }

  if (mode === "balancer_status") {
    const key = registration.balancer_status || "unknown";
    return {
      key,
      label: registration.balancer_status_meta?.name ?? humanizeStatusValue(key),
      sortOrder: BALANCER_STATUS_ORDER.get(key) ?? 100
    };
  }

  if (mode === "admission") {
    const decision = registration.admission.decision;
    return {
      key: decision,
      label: t(ADMISSION_GROUP_LABELS[decision]),
      // Descending: admitted first, the rows needing attention last — the order
      // organizers already read these groups in.
      sortOrder: -ADMISSION_ORDER[decision]
    };
  }

  return { key: "all", label: t("all"), sortOrder: 0 };
};

export const normalizeRegistrationGroupingMode = (
  value: string | null
): RegistrationGroupingMode =>
  GROUPING_MODES.has(value as RegistrationGroupingMode)
    ? (value as RegistrationGroupingMode)
    : "none";

export const groupRegistrations = (
  registrations: AdminRegistration[],
  mode: RegistrationGroupingMode,
  t: GroupTranslator
): RegistrationGroup[] => {
  if (mode === "none") {
    return [{ key: "all", label: t("all"), registrations }];
  }

  const groups = new Map<
    string,
    RegistrationGroup & { sortOrder: number; firstSeenIndex: number }
  >();

  registrations.forEach((registration, index) => {
    const meta = getGroupMeta(registration, mode, t);
    const existingGroup = groups.get(meta.key);

    if (existingGroup) {
      existingGroup.registrations.push(registration);
      return;
    }

    groups.set(meta.key, {
      key: meta.key,
      label: meta.label,
      registrations: [registration],
      sortOrder: meta.sortOrder,
      firstSeenIndex: index
    });
  });

  return Array.from(groups.values())
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.firstSeenIndex - right.firstSeenIndex
    )
    .map(({ sortOrder: _sortOrder, firstSeenIndex: _firstSeenIndex, ...group }) => group);
};
