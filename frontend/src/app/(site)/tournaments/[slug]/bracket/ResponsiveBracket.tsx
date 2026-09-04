"use client";

import { BracketView } from "@/components/BracketView";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Encounter } from "@/types/encounter.types";
import type { StreamEntry } from "@/types/stream.types";
import type { StageType } from "@/types/tournament.types";

import { MobileBracket } from "./MobileBracket";

type ResponsiveBracketProps = {
  encounters: Encounter[];
  type: StageType;
  onEdit?: (encounter: Encounter) => void;
  onReport?: (encounter: Encounter) => void;
  canEdit?: (encounter: Encounter) => boolean;
  canReport?: (encounter: Encounter) => boolean;
  liveTeamStreams?: ReadonlyMap<number, StreamEntry>;
  highlightMatchId?: number | null;
};

/**
 * The tree at ≥768px, a one-round-at-a-time list below it. `useIsMobile` is
 * `false` until its effect runs, so SSR and the first client render agree on
 * the tree; phones swap to the list one frame later, before paint settles.
 */
export function ResponsiveBracket(props: Readonly<ResponsiveBracketProps>) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <MobileBracket
        encounters={props.encounters}
        type={props.type}
        highlightMatchId={props.highlightMatchId}
      />
    );
  }
  return <BracketView {...props} />;
}
