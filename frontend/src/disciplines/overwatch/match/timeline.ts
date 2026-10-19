import type { CatalogEntityRead } from "@/types/catalog.types";
import type { MatchEvent } from "@/types/killfeed.types";

/** The module's event types: one kill observation, and the non-kill marks worth a row in the timeline. */
const KILL = "kill";
const MARKS: readonly string[] = ["ultimate_start", "ultimate_end", "mercy_rez"];

/** A kill: `fight`, `ability`, `damage` and the flags are the Overwatch event's own `data`. */
export interface TimelineKill {
  time: number;
  /** The segment (round) the kill belongs to; 0 is the lead-up before the first round marker. */
  round: number;
  fight: number | null;
  ability: string | null;
  damage: number | null;
  is_critical_hit: boolean | null;
  is_environmental: boolean | null;
  killer_member_id: number | null;
  /** `encounter_team_id` of the killer's participation. */
  killer_team_id: number | null;
  killer_entity: CatalogEntityRead | null;
  victim_member_id: number | null;
  victim_team_id: number | null;
  victim_entity: CatalogEntityRead | null;
}

/** An ultimate cast / resurrect. */
export interface TimelineMark {
  time: number;
  round: number;
  /** "ultimate_start" | "ultimate_end" | "mercy_rez" */
  name: string;
  member_id: number | null;
  team_id: number | null;
  entity: CatalogEntityRead | null;
  related_member_id: number | null;
  related_team_id: number | null;
}

const num = (value: unknown): number | null => (typeof value === "number" ? value : null);
const flag = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);

/**
 * Split a native event timeline into kills and marks, in the order served (`segment`, `t`, `id`). Event types the
 * module does not draw are dropped; an entity the event names but `entities` lacks reads as no character.
 */
export function readTimeline(
  events: readonly MatchEvent[],
  entities: readonly CatalogEntityRead[]
): { kills: TimelineKill[]; marks: TimelineMark[] } {
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const entity = (id: number | null) => (id == null ? null : (entityById.get(id) ?? null));
  const kills: TimelineKill[] = [];
  const marks: TimelineMark[] = [];
  for (const event of events) {
    if (event.type === KILL) {
      const data = event.data ?? {};
      kills.push({
        time: event.t,
        round: event.segment,
        fight: num(data.fight),
        ability: typeof data.ability === "string" ? data.ability : null,
        damage: num(data.damage),
        is_critical_hit: flag(data.is_critical_hit),
        is_environmental: flag(data.is_environmental),
        killer_member_id: event.actor_member_id,
        killer_team_id: event.actor_team_id,
        killer_entity: entity(event.entity_id),
        victim_member_id: event.target_member_id,
        victim_team_id: event.target_team_id,
        victim_entity: entity(event.related_entity_id)
      });
    } else if (MARKS.includes(event.type)) {
      marks.push({
        time: event.t,
        round: event.segment,
        name: event.type,
        member_id: event.actor_member_id,
        team_id: event.actor_team_id,
        entity: entity(event.entity_id),
        related_member_id: event.target_member_id,
        related_team_id: event.target_team_id
      });
    }
  }
  return { kills, marks };
}
