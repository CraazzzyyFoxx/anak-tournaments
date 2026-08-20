import type { OAuthProviderName } from "@/types/auth.types";

export const OAUTH_PROVIDER_META: Record<OAuthProviderName, { title: string; icon: string }> = {
  discord: { title: "Discord", icon: "/discord.png" },
  twitch: { title: "Twitch", icon: "/twitch.png" },
  battlenet: { title: "Battle.net", icon: "/battlenet.svg" }
};
