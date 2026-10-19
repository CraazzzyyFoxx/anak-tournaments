import type { CharacterStat } from "@/types/user.types";
import { LogStatsName } from "@/types/stats.types";

/** The three stats `HeroUserStatsPopover` renders — nothing else is read. */
const POPOVER_STATS: readonly string[] = [
  LogStatsName.Winrate,
  LogStatsName.KDA,
  LogStatsName.HeroDamageDealt
];

export type HeroPopoverStat = Pick<CharacterStat, "name" | "avg_10">;

/**
 * Narrows a per-character stats array to what the popover actually shows.
 *
 * The full array carries `best`/`best_all` records (tournament names, map
 * image paths, player names) for every stat, and the profile overview renders
 * one popover per character row — server-side that whole payload lands in the RSC
 * stream (~139 KB of a 496 KB payload for 7 rows). Keep the two fields the
 * popover reads and drop the rest.
 *
 * Lives outside any `"use client"` module so server components can call it.
 */
export const heroPopoverStats = (stats: CharacterStat[] | undefined): HeroPopoverStat[] | undefined =>
  stats
    ?.filter((stat) => POPOVER_STATS.includes(stat.name))
    .map(({ name, avg_10 }) => ({ name, avg_10 }));
