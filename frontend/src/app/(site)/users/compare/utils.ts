import type { CatalogEntityRead } from "@/types/catalog.types";
import { ratedDimension, registrationRoles, type RoleOntology } from "@/lib/roster/ontology";
import type { RoleRef } from "@/lib/roster/role-ref";
import { CompareScope } from "@/app/(site)/users/compare/types";

export const parseOptionalInt = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
};

/**
 * A cohort `?role=` as the reads' filter: one of the browsed game's rated roles (never the open slot). `undefined`
 * for no role, an unknown code, or while the game's metadata loads.
 */
export const compareRoleFilter = (ontology: RoleOntology | null, code: string | undefined): RoleRef | undefined => {
  const rated = ontology ? ratedDimension(ontology) : null;
  if (!ontology || !rated || !code) return undefined;
  return registrationRoles(ontology).some((role) => role.code === code) ? { dimension: rated.code, role: code } : undefined;
};

export const parseScope = (value: string | null): CompareScope => {
  if (value === "hero") return "hero";
  return "overall";
};

export const normalizeNumber = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export interface DurationUnits {
  h: string;
  m: string;
  s: string;
}

export const formatDuration = (
  secondsRaw: number,
  units: DurationUnits = { h: "h", m: "m", s: "s" }
): string => {
  const seconds = Math.max(0, Math.floor(secondsRaw));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) return `${h}${units.h} ${m}${units.m} ${s}${units.s}`;
  if (m > 0) return `${m}${units.m} ${s}${units.s}`;
  return `${s}${units.s}`;
};

export const formatMetricValue = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  if (Number.isInteger(value)) {
    return value.toString();
  }

  return value.toFixed(2);
};

export const formatPercent = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  return `${value.toFixed(2)}%`;
};

export const getMapIconSrc = (map?: CatalogEntityRead | null): string | null => {
  const candidate = map?.image_path || map?.parent?.image_path;
  if (!candidate) return null;
  if (candidate.trim().length === 0) return null;
  return candidate;
};
