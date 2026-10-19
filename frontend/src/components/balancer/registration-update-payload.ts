import { roleOf, toRoleRef } from "@/lib/roster/role-ref";
import type {
  AdminRegistration,
  AdminRegistrationUpdateInput,
  BalancerPlayerUpdateInput
} from "@/types/balancer-admin.types";

/**
 * Editor payload -> registration patch. Pure: it is the one place that decides
 * which of the player-sheet's fields become a registration write, so the
 * balancer tool and the admin registrations table cannot disagree about it.
 *
 * Role entries are written in the owner game's rated dimension (`ratedDimension`,
 * from its ontology); a registration that already has roles may supply it while
 * the ontology is still loading. With neither known the write is refused rather
 * than guessed.
 */
export function buildRegistrationUpdateFromPlayerPayload(
  payload: BalancerPlayerUpdateInput,
  existingRoles: AdminRegistration["roles"] | undefined,
  ratedDimension: string | null
): AdminRegistrationUpdateInput {
  const registrationPatch: AdminRegistrationUpdateInput = {};

  if (payload.role_entries_json !== undefined) {
    // Registration preferences share the owner's rated role dimension.
    const roleDimension = ratedDimension ?? existingRoles?.[0]?.role.dimension;
    if (!roleDimension) {
      throw new Error("The game's rated role dimension is not known yet");
    }
    const existingRolesMap = new Map(
      existingRoles?.map((role) => [roleOf(role.role), role.top_characters ?? []]) ?? []
    );
    const sortedEntries = [...(payload.role_entries_json ?? [])].sort(
      (left, right) => left.priority - right.priority
    );
    registrationPatch.roles = sortedEntries.map((entry, index) => {
      const topCharacters = existingRolesMap.get(entry.role) ?? [];
      return {
        role: toRoleRef(
          entry.role,
          entry.subtype ? `${entry.role}_${entry.subtype}` : null,
          roleDimension
        ),
        priority: entry.priority,
        is_primary: payload.is_flex ? true : index === 0,
        rank_value: entry.rank_value,
        // The raw column is what a write sets: `is_active` on the entry is the
        // resolver's verdict, so sending it would echo a computed value back.
        is_active: entry.is_declared_active,
        ...(topCharacters.length > 0 ? { top_characters: topCharacters } : {})
      };
    });
  }

  if (payload.admin_notes !== undefined) {
    registrationPatch.admin_notes = payload.admin_notes;
  }
  if (payload.registration_status != null) {
    registrationPatch.status = payload.registration_status;
  }
  if (payload.registration_balancer_status != null) {
    registrationPatch.balancer_status = payload.registration_balancer_status;
  }
  if (payload.is_in_pool === false) {
    registrationPatch.balancer_status = "excluded";
    registrationPatch.exclude_reason = "manual_exclusion";
  }
  if (payload.pin) {
    registrationPatch.pin = true;
  }
  if (payload.clear_pin) {
    registrationPatch.clear_pin = true;
  }
  return registrationPatch;
}
