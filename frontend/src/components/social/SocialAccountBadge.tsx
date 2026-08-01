import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { getSocialProviderConfig, socialProfileUrl } from "@/lib/social-providers";
import { hexToRgba } from "@/lib/utils";
import type { SocialAccount } from "@/types/user.types";

import { SocialIcon } from "./SocialIcon";

interface SocialAccountBadgeProps {
  account: SocialAccount;
  /** Wrap in a link to the provider profile when one is derivable (default true). */
  linkify?: boolean;
}

/** A single social identity rendered as a provider-tinted badge with a verified mark. */
export function SocialAccountBadge({ account, linkify = true }: SocialAccountBadgeProps) {
  const t = useTranslations();
  const config = getSocialProviderConfig(account.provider);
  const url = linkify ? socialProfileUrl(account) : null;

  // The tints used to be built by hex-string concatenation (`${color}10`),
  // which silently emits invalid CSS for any provider color that is not a
  // 6-digit hex. `hexToRgba` returns null instead, and we fall back to no tint.
  const surface = hexToRgba(config.color, 0.0625);
  const border = hexToRgba(config.color, 0.25);

  const badge = (
    <span
      className="inline-flex items-center gap-1.5 rounded-[7px] border px-2 py-1 text-[12.5px] font-medium"
      style={{
        background: surface ?? undefined,
        borderColor: border ?? "var(--aqt-border-2)",
        color: config.color
      }}
      title={
        account.is_verified
          ? `${config.label} · ${t("registration.accounts.verified")}`
          : config.label
      }
    >
      <SocialIcon provider={account.provider} size={12} />
      <span>{account.username}</span>
      {account.is_verified ? (
        <Check size={12} aria-label={t("registration.accounts.verified")} />
      ) : null}
    </span>
  );

  if (!url) {
    return badge;
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="no-underline">
      {badge}
    </a>
  );
}
