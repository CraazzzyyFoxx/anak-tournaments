import type { AdminRegistration } from "@/types/balancer-admin.types";

export type RegistrationGroupingMode = "none" | "check_in" | "balancer_status" | "admission";

export interface RegistrationGroup {
  key: string;
  label: string;
  registrations: AdminRegistration[];
}

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

const isAdmitted = (registration: AdminRegistration): boolean =>
  registration.status === "approved" &&
  registration.balancer_status === "ready" &&
  registration.checked_in;

const humanizeStatusValue = (value: string): string =>
  value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const getGroupMeta = (
  registration: AdminRegistration,
  mode: RegistrationGroupingMode
): { key: string; label: string; sortOrder: number } => {
  if (mode === "check_in") {
    return registration.checked_in
      ? { key: "checked_in", label: "Checked in", sortOrder: 0 }
      : { key: "not_checked_in", label: "Not checked in", sortOrder: 1 };
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
    return isAdmitted(registration)
      ? { key: "admitted", label: "Admitted", sortOrder: 0 }
      : { key: "not_admitted", label: "Not admitted", sortOrder: 1 };
  }

  return { key: "all", label: "All registrations", sortOrder: 0 };
};

export const normalizeRegistrationGroupingMode = (
  value: string | null
): RegistrationGroupingMode =>
  GROUPING_MODES.has(value as RegistrationGroupingMode)
    ? (value as RegistrationGroupingMode)
    : "none";

export const groupRegistrations = (
  registrations: AdminRegistration[],
  mode: RegistrationGroupingMode
): RegistrationGroup[] => {
  if (mode === "none") {
    return [{ key: "all", label: "All registrations", registrations }];
  }

  const groups = new Map<
    string,
    RegistrationGroup & { sortOrder: number; firstSeenIndex: number }
  >();

  registrations.forEach((registration, index) => {
    const meta = getGroupMeta(registration, mode);
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
