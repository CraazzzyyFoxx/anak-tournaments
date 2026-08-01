import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import Github from "@/components/icons/Github";
import { SITE_NAME } from "@/config/site";

export function Footer() {
  const t = useTranslations();
  return (
    <footer className="py-8 text-[color:var(--aqt-fg)]">
      <div className="flex gap-8 justify-between px-4">
        <div className="col-span-3">
          <p className="text-xl font-bold mb-4">{SITE_NAME}</p>
          <p className="text-sm text-[color:var(--aqt-fg-muted)]">
            {t("common.footer.disclaimer", { siteName: SITE_NAME })}
          </p>
        </div>
        {/* The icon is `aria-hidden` and inherits `currentColor`, so the link is
            the only place the accessible name can live. */}
        <Link
          href="https://github.com/CraazzzyyFoxx/anak-tournaments"
          aria-label={t("common.sourceOnGithub")}
          className="shrink-0 self-start rounded-md text-[color:var(--aqt-fg-muted)] transition-colors hover:text-[color:var(--aqt-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Github />
        </Link>
      </div>
    </footer>
  );
}
