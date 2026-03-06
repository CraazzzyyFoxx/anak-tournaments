import type { AuthUser, LinkedPlayer, OAuthProviderAvailability, OAuthProviderName, TokenPair } from "@/types/auth.types";
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
  async getOAuthUrl(provider: OAuthProviderName): Promise<OAuthUrlResponse> {
    const res = await authFetch(`/oauth/${provider}/url`, { method: "GET" });
    if (!res.ok) throw new Error(`Failed to get ${provider} OAuth URL`);
    return res.json();
  },

  async getAvailableOAuthProviders(): Promise<OAuthProviderAvailability[]> {
    const res = await authFetch("/providers", { method: "GET" });
    if (!res.ok) throw new Error("Failed to load available OAuth providers");
    return res.json();
  },

  async exchangeOAuthCode(provider: OAuthProviderName, code: string, state: string): Promise<TokenPair> {
    const qs = new URLSearchParams({ code, state });
    const res = await authFetch(`/oauth/${provider}/callback?${qs.toString()}`, {
      method: "GET"
    });
    if (!res.ok) throw new Error(`Failed to complete ${provider} OAuth`);
    return res.json();
  },

  async linkOAuth(provider: OAuthProviderName, code: string, state: string, accessToken: string): Promise<void> {
    const res = await authFetch(`/oauth/${provider}/link`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ code, state })
    });

    if (!res.ok) {
      throw new Error(`Failed to link ${provider} OAuth account`);
    }
  },

  async me(accessToken?: string): Promise<AuthUser> {
    const res = accessToken
      ? await authFetch("/me", {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` }
        })
      : await authFetchWithAuth("/me", { method: "GET" });
    if (!res.ok) throw new Error("Failed to fetch current user");
    return res.json();
  },

  async refresh(refreshToken: string): Promise<TokenPair> {
    const res = await authFetch("/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    if (!res.ok) throw new Error("Failed to refresh token");
    return res.json();
  },

  async getLinkedPlayers(accessToken?: string): Promise<LinkedPlayer[]> {
    const res = accessToken
      ? await authFetch("/player/linked", {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` }
        })
      : await authFetchWithAuth("/player/linked", { method: "GET" });
    if (!res.ok) throw new Error("Failed to fetch linked players");
    return res.json();
  },

  async logout(accessToken?: string, refreshToken?: string): Promise<void> {
    const res = accessToken
      ? await authFetch("/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: refreshToken ? JSON.stringify({ refresh_token: refreshToken }) : undefined
        })
      : await authFetchWithAuth("/logout", { method: "POST" });

    // /logout returns 204
    if (!res.ok && res.status !== 204) {
      throw new Error("Failed to logout");
    }
  }
};
