"use client";

import { useLayoutEffect } from "react";
import { useWorkspaceStore } from "@/stores/workspace.store";

/**
 * An opened object's owner is runtime context, not a saved viewing filter: its community and its
 * game (which locks the scope pill, spec §3.5) are held while it is open and cleared after.
 */
export function useEntityWorkspace(workspaceId: number | null | undefined, discipline?: string | null): void {
  useLayoutEffect(() => {
    if (workspaceId == null) return;
    useWorkspaceStore.getState().setEntityWorkspace(workspaceId);
    return () => {
      const state = useWorkspaceStore.getState();
      if (state.entityWorkspaceId === workspaceId) state.setEntityWorkspace(null);
    };
  }, [workspaceId]);
  useLayoutEffect(() => {
    if (discipline == null) return;
    useWorkspaceStore.getState().setEntityDiscipline(discipline);
    return () => {
      const state = useWorkspaceStore.getState();
      if (state.entityDiscipline === discipline) state.setEntityDiscipline(null);
    };
  }, [discipline]);
}
