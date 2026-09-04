import type { AdminRegistration } from "@/types/balancer-admin.types";
import type {
  DraftAutopickStrategy,
  DraftCaptainOrder,
  DraftFormat,
  DraftRole
} from "@/types/draft.types";

/** The roster shape is NOT here: it belongs to the tournament, not the wizard. */
export interface DraftSetupConfig {
  teamCount: number;
  pickTimeSeconds: number;
  format: DraftFormat;
  autopickStrategy: DraftAutopickStrategy;
  allowAdminOverride: boolean;
  roundRules: string[];
}

export interface DraftCaptainSetup {
  ids: number[];
  teamNames: Record<number, string>;
  order: DraftCaptainOrder;
  randomSeed: number;
}

interface DraftRegistrationSummary {
  roles: DraftRole[];
  /** `null` when no role is playable — the seed will reject this registration. */
  rank: number | null;
}

export function isInDraftPool(registration: AdminRegistration): boolean {
  return !registration.deleted_at && !registration.balancer_status_meta.excludes_from_balancer;
}

/**
 * The registration's playable roles and the rank of its leading one, read
 * straight off the rows the server already resolved: `is_active` IS "playable"
 * and `rank_value` IS the resolved rank (roster engine,
 * `shared.services.roster`). Nothing is recomputed here — no flex mode, no max
 * across roles, no default role.
 */
export function poolRegistrationSummary(registration: AdminRegistration): DraftRegistrationSummary {
  const playable = (registration.roles ?? [])
    .filter((entry) => entry.is_active)
    .sort((left, right) => left.priority - right.priority);
  const lead = playable.find((entry) => entry.is_primary) ?? playable[0] ?? null;
  return {
    roles: Array.from(new Set(playable.map((entry) => entry.role))) as DraftRole[],
    rank: lead?.rank_value ?? null
  };
}

export function registrationLabel(registration: AdminRegistration): string {
  return registration.battle_tag || registration.display_name || `#${registration.id}`;
}

