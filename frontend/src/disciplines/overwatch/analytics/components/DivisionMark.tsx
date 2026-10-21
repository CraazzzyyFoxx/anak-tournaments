"use client";

import DivisionIcon from "@/components/DivisionIcon";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { useDivisionGrid } from "@/hooks/useCurrentWorkspace";
import { getDivisionLabel } from "@/lib/divisions/grid";
import type { DivisionGridVersion } from "@/types/workspace.types";

interface DivisionMarkProps {
  division: number;
  tournamentGrid?: DivisionGridVersion | null;
  /** Crest edge in px. */
  size?: number;
  className?: string;
}

/** A division crest, its name in the tooltip and the accessible name (DESIGN.md §11: divisions are icon only). */
export default function DivisionMark({ division, tournamentGrid, size = 26, className }: Readonly<DivisionMarkProps>) {
  const workspaceGrid = useDivisionGrid();
  const label = getDivisionLabel(tournamentGrid ?? workspaceGrid, division) ?? String(division);
  return (
    <IconTooltip label={label} className={className ?? "shrink-0"}>
      <DivisionIcon division={division} tournamentGrid={tournamentGrid} width={size} height={size} />
    </IconTooltip>
  );
}
