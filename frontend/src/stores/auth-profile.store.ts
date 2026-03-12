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
  lastFetchedAt?: number;

  fetchMe: (opts?: { force?: boolean; staleMs?: number }) => Promise<void>;
  clear: () => void;
};


export const useAuthProfileStore = create<AuthProfileState>((set, get) => ({
  status: "idle",
  user: undefined,
  error: undefined,
  lastFetchedAt: undefined,

  clear: () => set({ status: "anonymous", user: undefined, error: undefined, lastFetchedAt: Date.now() }),

  fetchMe: async (opts) => {
    const { status, lastFetchedAt } = get();
    if (status === "loading") {
      return;
    }

    const isFresh =
      typeof opts?.staleMs === "number" &&
      typeof lastFetchedAt === "number" &&
      Date.now() - lastFetchedAt < opts.staleMs;

    if (!opts?.force && isFresh && (status === "authenticated" || status === "anonymous")) {
      return;
    }

    if (!opts?.force && status === "authenticated" && typeof opts?.staleMs !== "number") {
      return;
    }

    set({ status: "loading", error: undefined });

    try {
      const res = await fetchWithAuth("/api/auth/me", { method: "GET" });
      const fetchedAt = Date.now();

      if (res.status === 401) {
        set({ status: "anonymous", user: undefined, error: undefined, lastFetchedAt: fetchedAt });
        return;
      }

      if (!res.ok) {
        set({
          status: "error",
          user: undefined,
          error: `Failed to fetch profile (${res.status})`,
          lastFetchedAt: fetchedAt
        });
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
        error: undefined,
        lastFetchedAt: fetchedAt
      });
    } catch (e) {
      set({
        status: "error",
        user: undefined,
        error: e instanceof Error ? e.message : "Failed to fetch profile",
        lastFetchedAt: Date.now()
      });
    }
  }
}));
