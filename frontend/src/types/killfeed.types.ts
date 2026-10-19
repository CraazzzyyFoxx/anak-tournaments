import type { Schema } from "@/types/api";
import type { CatalogEntityRead } from "@/types/catalog.types";

/**
 * One native event observation. `actor_member_id`/`target_member_id` are workspace-member ids and
 * `actor_team_id`/`target_team_id` are `encounter_team_id`s: resolve names and sides through the match's
 * `statistics.members` and `participants`. `type` is the discipline's declared event type; what `data` holds is
 * that discipline's own contract.
 */
export type MatchEvent = Schema<"tournament.NativeMatchEvent">;

/** `GET /api/v1/matches/{id}/kill-feed`: the whole timeline, `segment`/`t`/`id` ordered, with the entities it names. */
export interface MatchEvents {
  match_id: number;
  discipline: string;
  events: MatchEvent[];
  entities: CatalogEntityRead[];
}
