"use client";

import { useQuery } from "@tanstack/react-query";

import { encounterQueryKeys } from "@/lib/encounters/query-keys";
import captainService from "@/services/captain.service";
import { useAuthProfileStore } from "@/stores/auth-profile.store";

/**
 * The viewer's seat in an encounter: the participation they captain, or both fields null. Only a signed-in account
 * can captain anything, so nobody else is asked -- for them the read is a 401 and the answer is already "no seat".
 */
export function useMyEncounterRole(encounterId: number, enabled = true) {
  const signedIn = useAuthProfileStore((state) => state.status === "authenticated");
  return useQuery({
    queryKey: encounterQueryKeys.myRole(encounterId),
    queryFn: () => captainService.getMyRole(encounterId),
    enabled: enabled && signedIn,
    retry: false
  });
}
