import { UserCompareBaselineMode } from "@/types/user.types";

export type CompareScope = "overall" | "hero";

export interface CompareRow {
  key: string;
  label: string;
  subjectValue: number | null;
  baselineValue: number | null;
  delta: number | null;
  deltaPercent: number | null;
  percentile: number | null;
  betterWorse?: "better" | "worse" | "equal" | null;
  higherIsBetter?: boolean;
}

export interface ParsedCompareParams {
  subjectUserId?: number;
  targetUserId?: number;
  /** A rated role code of the browsed game (`?role=`), as typed; resolved against its metadata before any read. */
  role?: string;
  divMin?: number;
  divMax?: number;
  tournamentId?: number;
  leftHeroId?: number;
  rightHeroId?: number;
  mapId?: number;
  scope: CompareScope;
}

export interface CompareBaselineState {
  isHeroScope: boolean;
  isTargetBaseline: boolean;
  hasCohortFilters: boolean;
  effectiveBaseline: UserCompareBaselineMode;
}
