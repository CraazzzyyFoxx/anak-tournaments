import { Hero } from "@/types/hero.types";

/** One native kill observation (hero = the hero at the moment of the kill). */
export interface KillFeedEntry {
  time: number;
  round: number;
  fight: number | null;
  ability: string | null;
  damage: number | null;
  is_critical_hit: boolean | null;
  is_environmental: boolean | null;
  killer_user_id: number | null;
  killer_team_id: number | null;
  killer_hero: Hero | null;
  victim_user_id: number | null;
  victim_team_id: number | null;
  victim_hero: Hero | null;
}

/** A native non-kill timeline observation (ultimate cast / resurrect). */
export interface MatchTimelineEvent {
  time: number;
  round: number;
  /** "ultimate_start" | "ultimate_end" | "mercy_rez" */
  name: string;
  user_id: number | null;
  team_id: number | null;
  hero: Hero | null;
  related_user_id: number | null;
  related_team_id: number | null;
}

export interface MatchKillFeed {
  match_id: number;
  kills: KillFeedEntry[];
  events: MatchTimelineEvent[];
}
