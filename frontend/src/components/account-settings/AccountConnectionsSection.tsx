"use client";

import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import AccountConnectionCard from "./AccountConnectionCard";
import { useConnectedAccounts, useUnlinkConnectedAccount } from "@/hooks/use-connected-accounts";
import { useOAuthProviders } from "@/hooks/use-oauth-providers";
import type { OAuthConnection, OAuthProviderName } from "@/types/auth.types";

const AccountConnectionsSection = () => {
  const { data, isLoading, isError, error, refetch } = useConnectedAccounts();
  const {
    data: providersData,
    isLoading: isProvidersLoading,
    isError: isProvidersError,
    error: providersError,
    refetch: refetchProviders
  } = useOAuthProviders();
  const { mutate: unlinkConnection, isPending, variables } = useUnlinkConnectedAccount();

  const connections = data ?? [];
  const providers = providersData?.map((item) => item.provider) ?? [];

  const getConnection = (provider: OAuthProviderName): OAuthConnection | null => {
    return connections.find((connection) => connection.provider === provider) ?? null;
  };

  if (isLoading || isProvidersLoading) {
    return (
      <div className="grid gap-4 w-full">
        {["discord", "twitch", "battlenet"].map((provider) => (
          <div key={provider} className="liquid-glass rounded-xl h-[88px] relative overflow-hidden" 
               style={{"--lg-a": "30 41 59", "--lg-b": "15 23 42", "--lg-c": "51 65 85"} as React.CSSProperties}>
            <Skeleton className="absolute inset-0 bg-transparent rounded-xl" />
          </div>
        ))}
      </div>
    );
  }

  if (isError || isProvidersError) {
    return (
      <div className="liquid-glass rounded-xl border border-red-500/30 p-4 text-sm bg-red-500/10 text-red-200">
        <p className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {error instanceof Error
            ? error.message
            : providersError instanceof Error
              ? providersError.message
              : "Failed to load account connections."}
        </p>
        <Button 
          variant="outline" 
          size="sm" 
          className="mt-3 border-red-500/50 hover:bg-red-500/20 hover:text-red-100" 
          onClick={() => {
            void refetch();
            void refetchProviders();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (providers.length === 0) {
    return (
      <div className="liquid-glass rounded-xl border border-white/10 p-4 text-sm text-slate-300/80">
        OAuth providers are currently unavailable.
      </div>
    );
  }

  return (
    <div className="grid gap-4 w-full">
      {providers.map((provider) => (
        <AccountConnectionCard
          key={provider}
          provider={provider}
          connection={getConnection(provider)}
          isUnlinking={isPending && variables === provider}
          onUnlink={(targetProvider) => unlinkConnection(targetProvider)}
        />
      ))}
    </div>
  );
};

export default AccountConnectionsSection;
