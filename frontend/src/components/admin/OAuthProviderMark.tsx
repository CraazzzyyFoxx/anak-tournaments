import Image from "@/components/ui/image";
import { Globe } from "lucide-react";
import { useTranslations } from "next-intl";

import type { OAuthProvider } from "@/types/rbac.types";

export const PROVIDER_META: Record<
  OAuthProvider,
  { labelKey: "providerDiscord" | "providerTwitch" | "providerBattleNet" | "providerRiot" | "providerGoogle" | "providerGitHub"; icon: string | null; iconClass?: string }
> = {
  discord: { labelKey: "providerDiscord", icon: "/discord.png" },
  twitch: { labelKey: "providerTwitch", icon: "/twitch.png" },
  battlenet: { labelKey: "providerBattleNet", icon: "/battlenet.svg", iconClass: "invert grayscale" },
  riot: { labelKey: "providerRiot", icon: "/riot.png" },
  google: { labelKey: "providerGoogle", icon: null },
  github: { labelKey: "providerGitHub", icon: null }
};

/** A provider is a category: brand mark + plain label, no chip. */
export function ProviderMark({ provider }: Readonly<{ provider: OAuthProvider }>) {
  const t = useTranslations("adminAccess.common");
  const meta = PROVIDER_META[provider];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      {meta?.icon ? (
        <Image src={meta.icon} alt="" width={14} height={14} className={meta.iconClass} />
      ) : (
        <Globe aria-hidden className="size-3.5 text-muted-foreground" />
      )}
      {meta ? t(meta.labelKey) : provider}
    </span>
  );
}
