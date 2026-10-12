import Image from "next/image";
import { Globe } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { OAuthProvider } from "@/types/rbac.types";

export const PROVIDER_META: Record<
  OAuthProvider,
  { labelKey: "providerDiscord" | "providerTwitch" | "providerBattleNet" | "providerGoogle" | "providerGitHub"; icon: string | null; iconClass?: string }
> = {
  discord: { labelKey: "providerDiscord", icon: "/discord.png" },
  twitch: { labelKey: "providerTwitch", icon: "/twitch.png" },
  battlenet: { labelKey: "providerBattleNet", icon: "/battlenet.svg", iconClass: "invert grayscale" },
  google: { labelKey: "providerGoogle", icon: null },
  github: { labelKey: "providerGitHub", icon: null }
};

/**
 * Brand colour per provider, entirely from `globals.css`'s `--aqt-brand-*` block —
 * which exists precisely so brand hues stop being "raw hex sprinkled through cards".
 *
 * Two tokens each, not one plus a derivation. The mark keeps the exact brand hue;
 * the *label* needs a lighter one, because raw brand hues fail WCAG AA as small
 * text on our dark surfaces (Discord 4.04:1, Twitch 4.01:1 — measured in
 * `SocialAccountBadge`, which solves the same problem). That lighter value is a
 * contrast-tuned hue/saturation shift, not a white mix, so it is a token of its
 * own rather than something computed here.
 */
const PROVIDER_COLOR: Record<OAuthProvider, { hue: string; label: string }> = {
  discord: { hue: "var(--aqt-brand-discord)", label: "var(--aqt-brand-discord-fg)" },
  twitch: { hue: "var(--aqt-brand-twitch)", label: "var(--aqt-brand-twitch-fg)" },
  battlenet: { hue: "var(--aqt-brand-battlenet)", label: "var(--aqt-brand-battlenet-fg)" },
  google: { hue: "var(--aqt-brand-google)", label: "var(--aqt-brand-google-fg)" },
  github: { hue: "var(--aqt-brand-github)", label: "var(--aqt-brand-github-fg)" }
};

export function ProviderBadge({ provider }: Readonly<{ provider: OAuthProvider }>) {
  const t = useTranslations("adminAccess.common");
  const meta = PROVIDER_META[provider];
  const color = PROVIDER_COLOR[provider];
  const label = meta ? t(meta.labelKey) : provider;
  return (
    <Badge
      variant="outline"
      className="gap-1.5"
      style={{
        // Surface and edge are alpha tints of the base token, so they follow it.
        background: `color-mix(in srgb, ${color.hue} 15%, transparent)`,
        borderColor: `color-mix(in srgb, ${color.hue} 30%, transparent)`,
        color: color.label
      }}
    >
      {meta?.icon ? (
        <Image
          src={meta.icon}
          alt={label}
          width={14}
          height={14}
          className={meta.iconClass ?? ""}
        />
      ) : (
        <Globe aria-hidden className="h-3.5 w-3.5" />
      )}
      {label}
    </Badge>
  );
}
