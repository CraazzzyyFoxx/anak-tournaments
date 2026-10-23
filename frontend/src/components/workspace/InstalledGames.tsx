"use client";

import type { ReactNode } from "react";

import { useDisciplines } from "@/hooks/useDisciplineMetadata";
import type { DisciplineDescriptor } from "@/types/discipline.types";

/**
 * The server's read of the installed games (axis `all`: what `useGameDescriptors` names rows and marks from), seeded
 * before anything below renders. A block that streams in after the scope pill's browser read has landed then renders
 * the same games on both sides. `null` (a failed read) seeds nothing: the browser reads them itself.
 */
export function InstalledGames({
  games,
  children
}: Readonly<{ games: DisciplineDescriptor[] | null; children: ReactNode }>) {
  useDisciplines("all", games ?? undefined);
  return children;
}
