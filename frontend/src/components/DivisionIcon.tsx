"use client";

import Image from "next/image";

import { useDivisionGrid } from "@/hooks/useCurrentWorkspace";
import { getDivisionIconSrc, getDivisionLabel } from "@/lib/divisions/grid";
import type { DivisionGrid, DivisionGridVersion } from "@/types/workspace.types";

interface DivisionIconProps {
  division: number;
  tournamentGrid?: DivisionGridVersion | DivisionGrid | null;
  discipline?: string;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Rank crest for a division number. Nothing is rendered when the grid has no
 * icon for it — a broken image glyph is worse than no crest.
 */
const DivisionIcon = ({
  division,
  tournamentGrid,
  discipline,
  width = 36,
  height = 36,
  className
}: DivisionIconProps) => {
  const workspaceGrid = useDivisionGrid(discipline);
  const preferredGrid = tournamentGrid ?? workspaceGrid;
  const src = getDivisionIconSrc(preferredGrid, division);
  const name = getDivisionLabel(preferredGrid, division);

  if (!src) return null;

  return (
    <Image
      src={src}
      alt={name ?? `Division ${division}`}
      width={width}
      height={height}
      className={className}
      loading="lazy"
      decoding="async"
    />
  );
};

export default DivisionIcon;
