import { create } from "zustand";
import { fetchWithAuth } from "@/lib/fetch-with-auth";

export type AuthProfile = {
  username: string;
  avatarUrl?: string | null;
  roles: string[];
  permissions: string[];
  isSuperuser: boolean;
};

export type AuthProfileStatus = "idle" | "loading" | "authenticated" | "anonymous" | "error";

type AuthProfileState = {
  status: AuthProfileStatus;
  user?: AuthProfile;
  error?: string;

  fetchMe: (opts?: { force?: boolean }) => Promise<void>;
  clear: () => void;
};


export const useAuthProfileStore = create<AuthProfileState>((set, get) => ({
  status: "idle",
  user: undefined,
  error: undefined,

  clear: () => set({ status: "anonymous", user: undefined, error: undefined }),

  fetchMe: async (opts) => {
    const { status } = get();
    if (!opts?.force && (status === "loading" || status === "authenticated" || status === "anonymous")) {
      return;
    }

    set({ status: "loading", error: undefined });

    try {
      const res = await fetchWithAuth("/api/auth/me", { method: "GET" });

      if (res.status === 401) {
        set({ status: "anonymous", user: undefined, error: undefined });
        return;
      }

      if (!res.ok) {
        set({ status: "error", user: undefined, error: `Failed to fetch profile (${res.status})` });
        return;
      }

      const data: {
        username: string;
        avatar_url?: string | null;
        roles?: string[];
        permissions?: string[];
        is_superuser?: boolean;
      } = await res.json();
      set({
        status: "authenticated",
        user: {
          username: data.username,
          avatarUrl: data.avatar_url ?? null,
          roles: data.roles ?? [],
          permissions: data.permissions ?? [],
          isSuperuser: data.is_superuser ?? false
        },
        error: undefined
      });
    } catch (e) {
      set({
        status: "error",
        user: undefined,
        error: e instanceof Error ? e.message : "Failed to fetch profile"
      });
    }
  }
}));
