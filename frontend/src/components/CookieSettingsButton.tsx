"use client";

import { useTranslations } from "next-intl";

import { useCookieConsentStore } from "@/stores/cookie-consent.store";

/**
 * Reopens the cookie notice so an existing choice can be changed. A button and
 * not a link: it acts on this page instead of navigating anywhere.
 */
export default function CookieSettingsButton({ className }: Readonly<{ className?: string }>) {
  const t = useTranslations();
  const reopen = useCookieConsentStore((state) => state.reopen);

  return (
    <button type="button" className={className} onClick={reopen}>
      {t("legal.cookieConsent.manage")}
    </button>
  );
}
