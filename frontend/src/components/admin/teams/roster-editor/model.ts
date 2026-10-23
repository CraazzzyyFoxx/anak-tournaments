import type { RoleOntology } from "@/lib/roster/ontology";
import { OPEN_SLOT_CODE } from "@/lib/roster/shape";
import { sortTeamPlayers } from "@/lib/player";
import type { Player } from "@/types/team.types";

/** A roster row being composed. `parentId` set means it replaces that player. */
export interface RosterDraft {
  parentId: number | null;
  userId: number;
  userName: string;
  name: string;
  role: string;
  /** `null` = no rank. */
  rank: number | null;
  subRole: string;
}

export function emptyDraft(parentId: number | null, role: string = OPEN_SLOT_CODE): RosterDraft {
  return { parentId, userId: 0, userName: "", name: "", role, rank: null, subRole: "" };
}

/**
 * Roster order (role, then rank, substitutes under the slot they cover) plus the
 * nesting depth each row renders at. Walks `related_player_id` upwards with a
 * seen-set so a corrupt cycle degrades to depth 0 instead of hanging.
 */
export function buildRosterRows(players: Player[], ontology: RoleOntology | null): Array<{ player: Player; depth: number }> {
  const byId = new Map(players.map((player) => [player.id, player]));

  const depthOf = (player: Player) => {
    const seen = new Set<number>([player.id]);
    let current = player;
    let depth = 0;

    while (current.is_substitution && current.related_player_id != null) {
      const parent = byId.get(current.related_player_id);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      depth += 1;
      current = parent;
    }

    return depth;
  };

  return sortTeamPlayers(players, ontology).map((player) => ({ player, depth: depthOf(player) }));
}
