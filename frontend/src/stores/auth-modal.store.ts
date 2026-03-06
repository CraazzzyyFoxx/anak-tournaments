import { create } from "zustand";

type AuthModalStore = {
  isOpen: boolean;
  nextPath: string;
  open: (nextPath?: string) => void;
  close: () => void;
};

function sanitizeNextPath(nextPath?: string): string {
  if (!nextPath) {
    return "/";
  }

  if (nextPath.startsWith("/")) {
    return nextPath;
  }

  return "/";
}

export const useAuthModalStore = create<AuthModalStore>((set) => ({
  isOpen: false,
  nextPath: "/",
  open: (nextPath) => set({ isOpen: true, nextPath: sanitizeNextPath(nextPath) }),
  close: () => set({ isOpen: false })
}));
