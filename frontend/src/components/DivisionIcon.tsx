"use client";

import React from "react";
import Image from "next/image";

import { useDivisionGrid } from "@/hooks/useCurrentWorkspace";
import type { DivisionGridVersion } from "@/types/workspace.types";

export interface DivisionIconProps {
  division: number;
  tournamentGrid?: DivisionGridVersion | null;
  width?: number;
  height?: number;
  className?: string;
}

const DivisionIcon = ({
  division,
  tournamentGrid,
  width = 36,
  height = 36,
  className
}: DivisionIconProps) => {
  const workspaceGrid = useDivisionGrid();

  // Tournament grid takes priority over workspace grid
  const tier =
    (tournamentGrid?.tiers ?? []).find((t) => t.number === division) ??
    workspaceGrid.tiers.find((t) => t.number === division);

  const src =
    tier?.icon_url ??
    `https://minio.craazzzyyfoxx.me/aqt/assets/divisions/default-${division}.png`;
  const name = tier?.name ?? `Division ${division}`;

  return <Image src={src} alt={name} width={width} height={height} className={className} />;
};

export default DivisionIcon;
