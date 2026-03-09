"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OAuthConnection, OAuthProviderName } from "@/types/auth.types";
import { OAUTH_PROVIDERS_QUERY_KEY } from "@/hooks/use-oauth-providers";

const CONNECTIONS_QUERY_KEY = ["account", "connections"] as const;

async function fetchConnections(): Promise<OAuthConnection[]> {
  const response = await fetch("/api/account/connections", {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = payload && typeof payload.detail === "string" ? payload.detail : "Failed to load connections";
    throw new Error(detail);
  }

  return response.json();
}

async function unlinkConnection(provider: OAuthProviderName): Promise<void> {
  const response = await fetch(`/api/account/connections/${provider}`, {
    method: "DELETE"
  });

  if (!response.ok && response.status !== 204) {
    const payload = await response.json().catch(() => null);
    const detail = payload && typeof payload.detail === "string" ? payload.detail : "Failed to unlink account";
    throw new Error(detail);
  }
}

export function useConnectedAccounts() {
  return useQuery({
    queryKey: CONNECTIONS_QUERY_KEY,
    queryFn: fetchConnections,
    retry: false
  });
}

export function useUnlinkConnectedAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: unlinkConnection,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: OAUTH_PROVIDERS_QUERY_KEY });
    }
  });
}
