import type { DraftFormatSettings, DraftSession } from "@/types/draft.types";

import type { DraftCaptainSetup, DraftSetupConfig } from "./setup-types";

export function configFromSession(session: DraftSession | null): DraftSetupConfig {
  const teamCount = session?.settings_json?.team_count;
  return {
    teamCount: typeof teamCount === "number" ? teamCount : null,
    pickTimeSeconds: session?.pick_time_seconds ?? 45,
    overtimeSeconds: session?.overtime_seconds ?? 0,
    autopickStrategy: session?.autopick_strategy ?? "best_fit",
    allowAdminOverride: session?.allow_admin_override ?? true
  };
}

/** The snapshot a created session drafts with — the server copied it from the tournament. */
export function formatFromSession(session: DraftSession): DraftFormatSettings {
  const roundRules = session.settings_json?.round_rules;
  return {
    format: session.format,
    round_rules: Array.isArray(roundRules) ? roundRules.map(String) : [],
    avg_tie_seed_reverse: session.settings_json?.avg_tie_seed_reverse === true
  };
}

export function createEmptyCaptainSetup(): DraftCaptainSetup {
  return {
    ids: [],
    teamNames: {},
    roles: {},
    order: "weakest_first",
    randomSeed: Math.floor(Math.random() * 2_147_483_647)
  };
}
