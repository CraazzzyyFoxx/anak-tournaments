import type { ComponentType, LazyExoticComponent } from "react";

import type { CatalogEntityRead } from "@/types/catalog.types";
import type {
  DisciplineCapabilities,
  DisciplineMetadata,
  NativeTier
} from "@/types/discipline.types";
import type { MatchWithStats } from "@/types/encounter.types";
import type { MatchWithUserStats } from "@/types/user.types";

import type { WorkspaceAxis } from "@/lib/site/discipline-scope";

export type { DisciplineCapabilities };

/** A run of native ranks as indices into the discipline's native ladder (0 = top rank), `from <= to`. */
export type NativeRankRange = { from: number; to: number };

/** One side of a two-player comparison (§7 leaves the body to the compare owner; the player is the stable part). */
export type CompareSide = { userId: number };

export type SlotProps = {
  characterPopover: { entity: CatalogEntityRead; userId: number | null; axis: WorkspaceAxis };
  characterStats: { userId: number; axis: WorkspaceAxis; metadata: DisciplineMetadata };
  characterCompare: {
    left: CompareSide;
    right: CompareSide;
    axis: WorkspaceAxis;
    metadata: DisciplineMetadata;
  };
  matchStats: { match: MatchWithStats; metadata: DisciplineMetadata };
  seriesStats: { matches: MatchWithStats[]; metadata: DisciplineMetadata };
  matchRowBadge: { match: MatchWithUserStats; metadata: DisciplineMetadata };
  analytics: { tournamentId: number; workspaceId: number; metadata: DisciplineMetadata };
  nativeRankEditor: {
    ladder: NativeTier[];
    value: NativeRankRange | null;
    onChange(value: NativeRankRange | null): void;
    disabled?: boolean;
    /** Per ladder rank, the name of the division that already holds it (`null` = unlinked). Display only. */
    owners?: readonly (string | null)[];
    /** Accessible name of the division being edited. */
    label?: string;
  };
  rankHistory: { userId: number; axis: WorkspaceAxis };
  pregameCharacterBans: { encounterId: number; metadata: DisciplineMetadata };
  /** The collector's rank-value mapping panel (`native_rank_collection` disciplines only); slice 6a's addition to §7. */
  rankMapping: Record<string, never>;
};

export type DisciplineSlot = keyof SlotProps;

export interface DisciplineUI {
  code: string;
  slots: Partial<{ [K in DisciplineSlot]: LazyExoticComponent<ComponentType<SlotProps[K]>> }>;
}
