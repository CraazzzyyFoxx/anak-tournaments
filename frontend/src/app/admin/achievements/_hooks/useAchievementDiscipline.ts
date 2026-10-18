"use client";

import { useState } from "react";

import { useWorkspaceStore } from "@/stores/workspace.store";

/**
 * Which of the workspace's games the achievement screen is working on. The
 * selection is the user's pick while it is still one of the workspace's enabled
 * games, and otherwise the first enabled one — switching workspace therefore
 * never leaves the screen on a game the new workspace does not run.
 */
export function useAchievementDiscipline() {
  const getCurrentWorkspace = useWorkspaceStore((s) => s.getCurrentWorkspace);
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const disciplines = getCurrentWorkspace()?.disciplines_enabled ?? [];
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
