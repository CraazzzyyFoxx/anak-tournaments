"use client";

import { useBrowsingDiscipline, type BrowsingDisciplineState } from "@/hooks/useBrowsingDiscipline";
import { useWorkspaceStore } from "@/stores/workspace.store";

/**
 * Which of the workspace's games the achievement screen works on: the shared browsing
 * resolver (valid `?discipline=` over the saved choice over the first enabled game),
 * read for the page's own workspace — the same `currentWorkspaceId` its requests use,
 * whatever the public viewing scope. An unusable explicit value resolves `invalid` and
 * is shown, never replaced by another game.
 */
export function useAchievementDiscipline(): BrowsingDisciplineState & { discipline: string | null } {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const browsing = useBrowsingDiscipline({ allowsAll: false, axis: workspaceId ?? "all" });
  return { ...browsing, discipline: browsing.resolved?.kind === "concrete" ? browsing.resolved.code : null };
}
