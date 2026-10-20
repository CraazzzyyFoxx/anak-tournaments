"use client";

import type { ReactNode } from "react";

import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import type { WorkspaceAxis } from "@/lib/site/discipline-scope";
import type { DisciplineMetadata } from "@/types/discipline.types";

function GameMetadata({ axis, metadata }: Readonly<{ axis: WorkspaceAxis; metadata: DisciplineMetadata }>) {
  useDisciplineMetadata(axis, metadata.discipline.code, metadata);
  return null;
}

/**
 * The server's reads of each game's metadata on the viewed axis (role names and hues, stats, modules), for every
 * profile block below. By the time a block streams in and hydrates, the browser may hold one already — a game card
 * or another block reads it — or be reading it; seeded here, before any block renders, a block's first browser
 * render reads what its server render read. The installed games are the site layout's (`InstalledGames`).
 */
export default function ProfileGameData({
  axis,
  metadata,
  children
}: Readonly<{
  axis: WorkspaceAxis;
  metadata: DisciplineMetadata[];
  children: ReactNode;
}>) {
  return (
    <>
      {metadata.map((entry) => (
        <GameMetadata key={entry.discipline.code} axis={axis} metadata={entry} />
      ))}
      {children}
    </>
  );
}
