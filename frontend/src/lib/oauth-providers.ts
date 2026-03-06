import type { OAuthProviderName } from "@/types/auth.types";

export const OAUTH_PROVIDER_META: Record<OAuthProviderName, { title: string; icon: string }> = {
  discord: { title: "Discord", icon: "/discord.png" },
  twitch: { title: "Twitch", icon: "/twitch.png" },
  battlenet: { title: "Battle.net", icon: "/battlenet.svg" }
};

export const OAUTH_PROVIDER_BUTTON_STYLES: Record<OAuthProviderName, string> = {
  discord:
    "border-[#5865F2]/30 hover:border-[#5865F2] hover:shadow-[0_0_20px_rgba(88,101,242,0.4)] text-[#5865F2] hover:text-white hover:bg-[#5865F2]/20",
  twitch:
    "border-[#9146FF]/30 hover:border-[#9146FF] hover:shadow-[0_0_20px_rgba(145,70,255,0.4)] text-[#9146FF] hover:text-white hover:bg-[#9146FF]/20",
  battlenet:
    "border-[#148EFF]/30 hover:border-[#148EFF] hover:shadow-[0_0_20px_rgba(20,142,255,0.4)] text-[#148EFF] hover:text-white hover:bg-[#148EFF]/20"
};
