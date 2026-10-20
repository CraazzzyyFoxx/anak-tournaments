"use client";

import type { ReactNode } from "react";

import { useDisciplineMetadata, useDisciplines } from "@/hooks/useDisciplineMetadata";
import type { WorkspaceAxis } from "@/lib/site/discipline-scope";
import type { DisciplineDescriptor, DisciplineMetadata } from "@/types/discipline.types";

function GameMetadata({ axis, metadata }: Readonly<{ axis: WorkspaceAxis; metadata: DisciplineMetadata }>) {
  useDisciplineMetadata(axis, metadata.discipline.code, metadata);
  return null;
}

/**
 * The server's reads of the games, for every profile block below: the installed games (axis `all`, which name the
 * game cards and marks) and each game's metadata on the viewed axis (role names and hues, stats, modules). By the
 * time a block streams in and hydrates, the browser may hold them already — the scope pill reads the games, a block
 * its game's metadata — or be reading them; seeded here, before any block renders, a block's first browser render
 * reads what its server render read.
 */
export default function ProfileGameData({
  axis,
  games,
  metadata,
  children
}: Readonly<{
  axis: WorkspaceAxis;
  games: DisciplineDescriptor[] | null;
  metadata: DisciplineMetadata[];
  children: ReactNode;
}>) {
  useDisciplines("all", games ?? undefined);
  return (
    <>
      {metadata.map((entry) => (
        <GameMetadata key={entry.discipline.code} axis={axis} metadata={entry} />
      ))}
      {children}
    </>
  );
}
