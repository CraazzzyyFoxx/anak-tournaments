import type { ComponentType, LazyExoticComponent, ReactNode } from "react";

import type { PickBanClassGroup, PickBanClassItem } from "@/components/pick-ban/pick-ban-model";
import type { PickBanItemLike } from "@/components/pick-ban/PickBanGrid";
import type { CatalogEntityRead } from "@/types/catalog.types";
import type {
  DisciplineCapabilities,
  DisciplineMetadata,
  NativeTier
} from "@/types/discipline.types";
import type { EncounterTeam, MatchWithStats } from "@/types/encounter.types";
import type { MatchWithUserStats } from "@/types/user.types";

import type { WorkspaceAxis } from "@/lib/site/discipline-scope";

export type { DisciplineCapabilities };

/** A run of native ranks as indices into the discipline's native ladder (0 = top rank), `from <= to`. */
export type NativeRankRange = { from: number; to: number };

/** One side of a two-player comparison (§7 leaves the body to the compare owner; the player is the stable part). */
export type CompareSide = { userId: number };

/** One committed action of a round's character-ban phase, resolved against the catalog. */
export interface PregameCharacterAction {
  itemId: number;
  /** Catalog name, or the room's `#id` fallback while it loads. */
  name: string;
  /** Undefined until the character catalog resolves — the thumb falls back to initials. */
  item: PickBanItemLike | undefined;
  /** The character's class (`attrs.class`), only used to order a team's rows; null when the catalog knows none. */
  group: string | null;
  action: "ban" | "protect";
  /** The participation (`EncounterTeam.id`) that committed it. */
  teamId: number;
  /**
   * The earlier map this ban was spent on, when its `lifetime` still covers
   * this one. Nobody acted on it here, so it is badged with its origin rather
   * than read as a ban of this round.
   */
  carriedFromRound: number | null;
}

/** One character off on a map, as the final bans list shows it. */
export interface PregameBannedCharacter extends PickBanClassItem {
  /** Undefined until the character catalog resolves — the thumb falls back to initials. */
  item: PickBanItemLike | undefined;
}

/** One map's character board: who banned what, and the final bans. */
export interface PregameCharacterBoard {
  /** Null for a flat (round-less) pool: one set of bans covered every map. */
  round: number | null;
  actions: PregameCharacterAction[];
  /** Every ban in force on this map, class-grouped — what the lobby disables. */
  banned: PickBanClassGroup<PregameBannedCharacter>[];
}

/** One map's worth of character actions, for replaying a finished series. */
export interface PregameCharacterRound extends PregameCharacterBoard {
  /** Null alongside a null round — there is no single map to name. */
  mapName: string | null;
  /** The map's catalog entry, for its still. Undefined until the catalog loads. */
  mapItem: PickBanItemLike | undefined;
}

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
  /**
   * The room's character bans for one map (or the whole series when the pool is flat). Class order comes
   * from `metadata.discipline.character_classes`.
   */
  pregameCharacterBans: {
    encounterId: number;
    metadata: DisciplineMetadata;
    board: PregameCharacterBoard;
    /** The encounter's live seats: a column each, with the source team's logo when the read carried it. */
    teams: EncounterTeam[];
    /** Replaces the default caption; `null` drops it (the closing screen captions each row itself). */
    eyebrow?: ReactNode | null;
    /** Replaces the lobby-setup hint; `null` drops it (it only applies before a map is played). */
    hint?: string | null;
  };
  /** The collector's rank-value mapping panel (`native_rank_collection` disciplines only); slice 6a's addition to §7. */
  rankMapping: Record<string, never>;
};

export type DisciplineSlot = keyof SlotProps;

/**
 * Slot families. Each family has its own registry and module entrypoint, so a host reaches (and its i18n zone
 * ships) only the code of the slots it can render. A slot's owner adds it to exactly one family; never to a
 * catch-all one.
 */
export type RankSlot = "rankHistory";
export type PregameSlot = "pregameCharacterBans";
export type AdminSlot = "nativeRankEditor" | "rankMapping";

/** One module's lazy renderers for the slots of family `S`. */
export interface DisciplineUI<S extends DisciplineSlot = DisciplineSlot> {
  code: string;
  slots: Partial<{ [K in S]: LazyExoticComponent<ComponentType<SlotProps[K]>> }>;
}
