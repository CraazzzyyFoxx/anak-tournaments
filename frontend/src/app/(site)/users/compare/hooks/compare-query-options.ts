import type { UserCompareBaselineMode, UserRoleType } from "@/types/user.types";
import { userQueryKeys } from "@/lib/users/query-keys";

interface QueryContext {
  signal: AbortSignal;
}

interface CompareFilters {
  baseline: UserCompareBaselineMode;
  targetUserId?: number;
  role?: UserRoleType;
  divMin?: number;
  divMax?: number;
  tournamentId?: number;
  /** A community id scopes grid and population to it; "all" or absent is global. */
  workspaceId?: number | "all";
}

interface OverallCompareRequest extends CompareFilters {
  discipline: string;
  signal?: AbortSignal;
}

interface CharacterCompareRequest extends CompareFilters {
  discipline: string;
  leftEntityId?: number;
  rightEntityId?: number;
  mapId?: number;
  stats: string[];
  signal?: AbortSignal;
}

interface OverallOptions<TData> extends CompareFilters {
  isHeroScope: boolean;
  subjectUserId?: number;
  /** The browsed game; `null` (unresolved or invalid) reads nothing. */
  discipline: string | null;
  fetchCompare: (userId: number, request: OverallCompareRequest) => Promise<TData>;
}

interface CharacterOptions<TData> extends CompareFilters {
  isHeroScope: boolean;
  subjectUserId?: number;
  discipline: string | null;
  leftEntityId?: number;
  rightEntityId?: number;
  mapId?: number;
  stats: string[];
  fetchCompare: (userId: number, request: CharacterCompareRequest) => Promise<TData>;
}

/** Keeps the previous result on screen while a filter changes — never one of another game (key position 3). */
export const keepPreviousCompareData =
  <TData>(discipline: string | null) =>
  (previous: TData | undefined, previousQuery?: { queryKey: readonly unknown[] }) =>
    previousQuery?.queryKey[3] === discipline ? previous : undefined;

export const shouldLoadHeroCatalogs = (isHeroScope: boolean) => isHeroScope;

export const getCompareActivity = ({
  isLoading,
  isFetching
}: {
  isLoading: boolean;
  isFetching: boolean;
}) => ({
  isInitialLoading: isLoading,
  isRefreshing: isFetching && !isLoading
});

export const buildOverallCompareQueryOptions = <TData>({
  isHeroScope,
  subjectUserId,
  discipline,
  baseline,
  targetUserId,
  role,
  divMin,
  divMax,
  tournamentId,
  workspaceId,
  fetchCompare
}: OverallOptions<TData>) => ({
  queryKey: userQueryKeys.compare(subjectUserId, workspaceId ?? "all", discipline ?? "", {
    baseline,
    targetUserId,
    role,
    divMin,
    divMax,
    tournamentId
  }),
  enabled: !isHeroScope && subjectUserId !== undefined && discipline !== null,
  placeholderData: keepPreviousCompareData<TData>(discipline),
  queryFn: ({ signal }: QueryContext) =>
    fetchCompare(subjectUserId!, {
      discipline: discipline!,
      baseline,
      targetUserId,
      role,
      divMin,
      divMax,
      tournamentId,
      workspaceId,
      signal
    })
});

export const buildHeroCompareQueryOptions = <TData>({
  isHeroScope,
  subjectUserId,
  discipline,
  baseline,
  targetUserId,
  role,
  divMin,
  divMax,
  tournamentId,
  workspaceId,
  leftEntityId,
  rightEntityId,
  mapId,
  stats,
  fetchCompare
}: CharacterOptions<TData>) => ({
  queryKey: userQueryKeys.characterCompare(subjectUserId, workspaceId ?? "all", discipline ?? "", {
    baseline,
    targetUserId,
    role,
    divMin,
    divMax,
    tournamentId,
    leftEntityId,
    rightEntityId,
    mapId
  }),
  enabled: isHeroScope && subjectUserId !== undefined && discipline !== null,
  placeholderData: keepPreviousCompareData<TData>(discipline),
  queryFn: ({ signal }: QueryContext) =>
    fetchCompare(subjectUserId!, {
      discipline: discipline!,
      baseline,
      targetUserId,
      leftEntityId,
      rightEntityId,
      mapId,
      role,
      divMin,
      divMax,
      tournamentId,
      workspaceId,
      stats,
      signal
    })
});
