/**
 * The achievement engine's half of the condition builder: leaf labels, the
 * one-line parameter summary and the palette.
 *
 * The tree ↔ flow-graph conversion, layout and canvas live in
 * `@/components/rule-builder`, which the pick-ban constructor shares. This file
 * is the registry that turns that generic canvas into the achievement editor.
 *
 * Pure: no React, so it stays out of the editor's lazily loaded chunk boundary
 * and can be unit-tested without a canvas.
 */
import { LOGICAL_COLORS, type RulePaletteGroup } from "@/components/rule-builder";

// ─── Constants ───────────────────────────────────────────────────────────────

export const OPERATORS = ["==", "!=", ">=", ">", "<=", "<"];
export const STATS = [
  "Eliminations", "FinalBlows", "Deaths", "AllDamageDealt", "HeroDamageDealt",
  "HealingDealt", "DamageTaken", "DamageBlocked", "EnvironmentalKills",
  "EnvironmentalDeaths", "ScopedCriticalHitKills", "SoloKills", "CriticalHits",
  "HeroTimePlayed", "UltimatesEarned", "Performance", "KD", "KDA",
];

// ─── Palette ─────────────────────────────────────────────────────────────────

export const SIDEBAR_GROUPS: RulePaletteGroup[] = [
  {
    label: "Logic",
    items: [
      { type: "logical", logicalOp: "AND", label: "AND", color: LOGICAL_COLORS.AND },
      { type: "logical", logicalOp: "OR", label: "OR", color: LOGICAL_COLORS.OR },
      { type: "logical", logicalOp: "NOT", label: "NOT", color: LOGICAL_COLORS.NOT },
    ],
  },
  {
    label: "Match",
    items: [
      { type: "leaf", leafType: "stat_threshold", label: "Stat threshold" },
      { type: "leaf", leafType: "match_criteria", label: "Match criteria" },
      { type: "leaf", leafType: "match_win", label: "Match win" },
      { type: "leaf", leafType: "hero_stat", label: "Hero stat" },
      { type: "leaf", leafType: "match_mvp_check", label: "MVP check" },
    ],
  },
  {
    label: "Tournament",
    items: [
      { type: "leaf", leafType: "standing_position", label: "Position" },
      { type: "leaf", leafType: "standing_record", label: "Record" },
      { type: "leaf", leafType: "div_change", label: "Division change" },
      { type: "leaf", leafType: "div_level", label: "Division level" },
      { type: "leaf", leafType: "is_captain", label: "Is captain" },
      { type: "leaf", leafType: "is_newcomer", label: "Is newcomer" },
      { type: "leaf", leafType: "tournament_type", label: "Tournament type" },
      { type: "leaf", leafType: "hero_kd_best", label: "Hero K/D best" },
      { type: "leaf", leafType: "team_players_match", label: "Team players" },
      { type: "leaf", leafType: "captain_property", label: "Captain property" },
      { type: "leaf", leafType: "encounter_score", label: "Encounter score" },
      { type: "leaf", leafType: "encounter_revenge", label: "Encounter revenge" },
      { type: "leaf", leafType: "bracket_path", label: "Bracket path" },
      { type: "leaf", leafType: "tournament_format", label: "Format" },
      { type: "leaf", leafType: "stage_completed", label: "Stage completed" },
    ],
  },
  {
    label: "Global",
    items: [
      { type: "leaf", leafType: "global_stat_sum", label: "Global stat sum" },
      { type: "leaf", leafType: "tournament_count", label: "Tournament count" },
      { type: "leaf", leafType: "global_winrate", label: "Global winrate" },
      { type: "leaf", leafType: "distinct_count", label: "Distinct count" },
      { type: "leaf", leafType: "consecutive", label: "Consecutive" },
      { type: "leaf", leafType: "stable_streak", label: "Stable streak" },
    ],
  },
];
