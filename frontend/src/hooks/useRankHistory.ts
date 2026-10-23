import { useQuery } from "@tanstack/react-query";

import rankService from "@/services/rank.service";
import { RankHistoryQuery } from "@/types/rank.types";
import { userQueryKeys } from "@/lib/users/query-keys";

const STALE_TIME = 60_000;

export function useUserRankHistory(userId: number, params: RankHistoryQuery) {
  return useQuery({
    queryKey: userQueryKeys.rankHistory(userId, params),
    queryFn: () => rankService.getUserRankHistory(userId, params),
    staleTime: STALE_TIME,
    enabled: Number.isFinite(userId)
  });
}
