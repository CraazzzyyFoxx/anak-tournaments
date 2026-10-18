"use client";

import { useQuery } from "@tanstack/react-query";

import { tournamentQueryKeys } from "@/lib/tournament/query-keys";
import pickBanService from "@/services/pickBan.service";
import type { PickBanRulesCatalog } from "@/types/tournament.types";

/**
 * The engine's leaf/constraint specs plus the item groups and presets of the tournament's own discipline (§10).
 *
 * The discipline is the owner's explicit scope: it is in the key and the request, a superseded read is aborted,
 * and another game's catalog never stands in while this one loads. No session-wide cache — a game's map-group
 * vocabulary is catalog data an admin edits, so it follows the normal staleness rules.
 */
export function useRulesCatalog(discipline: string) {
  return useQuery<PickBanRulesCatalog>({
    queryKey: tournamentQueryKeys.pickBanRulesCatalog(discipline),
    queryFn: ({ signal }) => pickBanService.getRulesCatalog(discipline, signal),
  });
}
