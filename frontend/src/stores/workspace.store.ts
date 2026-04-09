import Cookies from "js-cookie";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Workspace } from "@/types/workspace.types";
import workspaceService from "@/services/workspace.service";

const WORKSPACE_COOKIE = "aqt-workspace-id";

type WorkspaceState = {
  workspaces: Workspace[];
  currentWorkspaceId: number | null;
  isLoading: boolean;

  fetchWorkspaces: () => Promise<void>;
  setCurrentWorkspace: (id: number) => void;
  getCurrentWorkspace: () => Workspace | undefined;
};

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspaces: [],
      currentWorkspaceId: null,
      isLoading: false,

      fetchWorkspaces: async () => {
        if (get().isLoading) return;
        set({ isLoading: true });
        try {
          const workspaces = await workspaceService.getAll();
          const current = get().currentWorkspaceId;
          const validCurrent =
            current && workspaces.some((w) => w.id === current);
          const nextId = validCurrent ? current : workspaces[0]?.id ?? null;
          if (nextId !== null) {
            Cookies.set(WORKSPACE_COOKIE, String(nextId), { sameSite: "lax" });
          }
          set({
            workspaces,
            currentWorkspaceId: nextId,
            isLoading: false,
          });
        } catch {
          set({ isLoading: false });
        }
      },

      setCurrentWorkspace: (id: number) => {
        Cookies.set(WORKSPACE_COOKIE, String(id), { sameSite: "lax" });
        set({ currentWorkspaceId: id });
      },

      getCurrentWorkspace: () => {
        const { workspaces, currentWorkspaceId } = get();
        return workspaces.find((w) => w.id === currentWorkspaceId);
      },
    }),
    {
      name: "aqt-workspace",
      partialize: (state) => ({ currentWorkspaceId: state.currentWorkspaceId }),
    }
  )
);
