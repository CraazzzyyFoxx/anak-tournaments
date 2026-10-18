"use client";

import { useState } from "react";

import { useWorkspaceStore } from "@/stores/workspace.store";

/** A stable empty list: a fresh `[]` per render would make every consumer's dependencies change. */
const NONE: string[] = [];

/**
 * Which of the workspace's games the achievement screen is working on. The
 * selection is the user's pick while it is still one of the workspace's enabled
 * games, and otherwise the first enabled one — switching workspace therefore
 * never leaves the screen on a game the new workspace does not run.
 *
 * The workspace object is selected inside the store selector (the same
 * `currentWorkspaceId` the page's requests use): the id can come from the cookie
 * before `workspaces` has loaded, and the hydration — or a changed
 * `disciplines_enabled` — must re-render the screen.
 */
export function useAchievementDiscipline() {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const enabled = useWorkspaceStore(
    (s) => s.workspaces.find((workspace) => workspace.id === s.currentWorkspaceId)?.disciplines_enabled
  );
  const disciplines = enabled ?? NONE;
  const [picked, setPicked] = useState<{ workspaceId: number | null; discipline: string } | null>(null);

  const selected =
    picked && picked.workspaceId === workspaceId && disciplines.includes(picked.discipline)
      ? picked.discipline
      : (disciplines[0] ?? null);

  return {
    discipline: selected,
    disciplines,
    select: (discipline: string) => setPicked({ workspaceId, discipline }),
  };
}
