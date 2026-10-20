import { useEffect } from "react";
import { create } from "zustand";

interface ScopePillState {
  /** Whether the scope pill's popover is open: the pill owns it, a filter hint can open it. */
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The current page's game-bound URL params: a game pick in the pill drops them (R5, spec §6.2). */
  gameBoundParams: readonly string[];
  setGameBoundParams: (params: readonly string[]) => void;
}

export const useScopePillOpen = create<ScopePillState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  gameBoundParams: [],
  setGameBoundParams: (gameBoundParams) => set({ gameBoundParams })
}));

/**
 * A page names the URL params that belong to one game (roles, maps, a tournament…) for as long as it
 * is mounted. Keyed by content, so a re-render's fresh array literal does not re-register.
 */
export function useGameBoundParams(params: readonly string[]): void {
  const key = JSON.stringify(params);
  useEffect(() => {
    const registered = JSON.parse(key) as string[];
    useScopePillOpen.getState().setGameBoundParams(registered);
    return () => {
      const state = useScopePillOpen.getState();
      if (state.gameBoundParams === registered) state.setGameBoundParams([]);
    };
  }, [key]);
}
