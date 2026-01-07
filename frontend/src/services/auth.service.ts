import type { AuthUser, LinkedPlayer, TokenPair } from "@/types/auth.types";
import { fetchWithAuth } from "@/lib/fetch-with-auth";

const AUTH_SERVICE_URL =
  process.env.NEXT_PUBLIC_AUTH_SERVICE_URL?.replace(/\/$/, "") || "http://localhost:8001";

type OAuthUrlResponse = {
  provider: string;
  url: string;
  state: string;
};

async function authFetch(
  path: string,
  init?: Parameters<typeof fetch>[1]
): Promise<Response> {
  const url = `${AUTH_SERVICE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    }
  });
}

async function authFetchWithAuth(
  path: string,
  init?: Parameters<typeof fetch>[1]
): Promise<Response> {
  const url = `${AUTH_SERVICE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
  return fetchWithAuth(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    }
  });
}

export const authService = {
  async getDiscordOAuthUrl(): Promise<OAuthUrlResponse> {
    const res = await authFetch("/auth/oauth/discord/url", { method: "GET" });
    if (!res.ok) throw new Error("Failed to get Discord OAuth URL");
    return res.json();
  },

  async exchangeDiscordCode(code: string, state: string): Promise<TokenPair> {
    const qs = new URLSearchParams({ code, state });
    const res = await authFetch(`/auth/oauth/discord/callback?${qs.toString()}`, {
      method: "GET"
    });
    if (!res.ok) throw new Error("Failed to complete Discord OAuth");
    return res.json();
  },

  async me(accessToken?: string): Promise<AuthUser> {
    const res = accessToken
      ? await authFetch("/auth/me", {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` }
        })
      : await authFetchWithAuth("/auth/me", { method: "GET" });
    if (!res.ok) throw new Error("Failed to fetch current user");
    return res.json();
  },

  async refresh(refreshToken: string): Promise<TokenPair> {
    const res = await authFetch("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    if (!res.ok) throw new Error("Failed to refresh token");
    return res.json();
  },

  async getLinkedPlayers(accessToken?: string): Promise<LinkedPlayer[]> {
    const res = accessToken
      ? await authFetch("/auth/player/linked", {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` }
        })
      : await authFetchWithAuth("/auth/player/linked", { method: "GET" });
    if (!res.ok) throw new Error("Failed to fetch linked players");
    return res.json();
  },

  async logout(accessToken?: string, refreshToken?: string): Promise<void> {
    const res = accessToken
      ? await authFetch("/auth/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: refreshToken ? JSON.stringify({ refresh_token: refreshToken }) : undefined
        })
      : await authFetchWithAuth("/auth/logout", { method: "POST" });

    // /auth/logout returns 204
    if (!res.ok && res.status !== 204) {
      throw new Error("Failed to logout");
    }
  }
};
