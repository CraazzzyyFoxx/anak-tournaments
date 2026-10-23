import { useQuery } from "@tanstack/react-query";

import { tournamentQueryKeys } from "@/lib/tournament/query-keys";
import pickBanService from "@/services/pickBan.service";
import type { PickBanRulesCatalog } from "@/types/tournament.types";

/**
 * The presets a pickup mix may play (spec §8.1), in catalog order. The server decides (`mix_eligible`, the same
 * `pick_ban_rules` check the mix writer runs), so this never re-evaluates a ruleset.
 */
export function mixBanPresetIds(catalog: PickBanRulesCatalog | undefined): string[] {
  return (catalog?.presets ?? []).filter((preset) => preset.mix_eligible).map((preset) => preset.id);
}

/** One game's mix presets; empty while the game is unknown or its catalog loads. */
export function useHeroBanPresets(discipline: string | null | undefined): string[] {
  const query = useQuery({
    queryKey: tournamentQueryKeys.pickBanRulesCatalog(discipline),
    queryFn: ({ signal }) => pickBanService.getRulesCatalog(discipline as string, signal),
    enabled: Boolean(discipline),
    staleTime: Infinity,
  });
  return mixBanPresetIds(query.data);
}
