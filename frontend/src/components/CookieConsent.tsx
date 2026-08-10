"use client";

import Link from "next/link";
import { useState } from "react";
import { GoogleAnalytics } from "@next/third-parties/google";
import Cookies from "js-cookie";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { SITE_NAME } from "@/config/site";
import {
  COOKIE_CONSENT_COOKIE,
  COOKIE_CONSENT_TTL_DAYS,
  type CookieConsentValue
} from "@/lib/cookie-consent";

// `--ring` resolves to `--primary`, so the shared Button's 1px ring is
// invisible on a filled primary button. Offsetting it against the card surface
// restores the indicator, the way the footer links already do.
const CHOICE_CLASS =
  "focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--aqt-card)]";

type CookieConsentProps = {
  /** Decision read from the request cookie server-side; `null` = undecided. */
  initial: CookieConsentValue | null;
  /** Google Analytics measurement id, mounted only once analytics are accepted. */
  gaId: string;
};

/**
 * Analytics-consent notice plus the analytics tag it gates.
 *
 * Deliberately a labelled region and not a `Dialog`: consent is not a task the
 * visitor started, so it must not trap focus, dim the page, or block reading
 * the site. Both answers are equally reachable buttons and there is no dismiss
 * affordance — a decision is what stops the notice from coming back.
 */
export default function CookieConsent({ initial, gaId }: CookieConsentProps) {
  const t = useTranslations();
  const [consent, setConsent] = useState<CookieConsentValue | null>(initial);

  function decide(value: CookieConsentValue) {
    Cookies.set(COOKIE_CONSENT_COOKIE, value, {
      sameSite: "lax",
      expires: COOKIE_CONSENT_TTL_DAYS
    });
    setConsent(value);
  }

  return (
    <>
      {consent === "accepted" && <GoogleAnalytics gaId={gaId} />}

      {consent === null && (
        // Pinned to the inline end on wide viewports so it never covers the
        // page's own content column; inset within the layout margins (and the
        // safe area) on narrow ones, matching the floating command bars.
        <section
          aria-labelledby="cookie-consent-title"
          className="fixed bottom-4 start-4 end-4 z-50 max-w-md rounded-xl border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-card)]/95 p-4 shadow-xl backdrop-blur animate-in fade-in slide-in-from-bottom-4 duration-300 motion-reduce:animate-none supports-[padding:max(0px)]:pb-[max(1rem,env(safe-area-inset-bottom))] sm:start-auto"
        >
          <h2
            id="cookie-consent-title"
            className="text-sm font-semibold text-[color:var(--aqt-fg)]"
          >
            {t("legal.cookieConsent.title")}
          </h2>

          <p className="mt-1.5 text-pretty text-[13px] leading-relaxed text-[color:var(--aqt-fg-dim)]">
            {t.rich("legal.cookieConsent.body", {
              siteName: SITE_NAME,
              privacy: (chunks) => (
                <Link
                  href="/privacy"
                  className="font-medium text-[color:var(--aqt-fg-muted)] underline underline-offset-2 hover:text-[color:var(--aqt-fg)]"
                >
                  {chunks}
                </Link>
              )
            })}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" className={CHOICE_CLASS} onClick={() => decide("accepted")}>
              {t("legal.cookieConsent.accept")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className={CHOICE_CLASS}
              onClick={() => decide("declined")}
            >
              {t("legal.cookieConsent.decline")}
            </Button>
          </div>
        </section>
      )}
    </>
  );
}
