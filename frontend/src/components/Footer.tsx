import React from "react";
import Link from "next/link";
import Image from "next/image";
import { useTranslations } from "next-intl";
import Github from "@/components/icons/Github";
import CookieSettingsButton from "@/components/CookieSettingsButton";
import { SITE_NAME, SITE_ICON } from "@/config/site";

const FOOTER_LINK_CLASS =
  "text-sm text-[color:var(--aqt-fg-muted)] transition-colors hover:text-[color:var(--aqt-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// Faint token (not muted-foreground/50): the opacity hack measured 2.7:1 on
// the page background, well under the 4.5:1 text floor. --aqt-fg-faint is the
// project's own low-emphasis-but-readable role, already verified elsewhere.
const COLUMN_HEADING_CLASS =
  "mb-4 text-[11px] font-semibold tracking-[0.14em] uppercase text-[color:var(--aqt-fg-faint)]";

// The bottom meta bar's own emphasis (xs, faint), distinct from the section
// links above it — shared so the three items stay pixel-identical.
const FOOTER_META_CLASS =
  "transition-colors hover:text-[color:var(--aqt-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function Footer() {
  const t = useTranslations();
  const year = new Date().getFullYear();

  return (
    <footer className="py-10 text-[color:var(--aqt-fg)]">
      {/* No extra horizontal padding here: the parent (site)/layout.tsx
          wrapper already supplies px-4 md:px-6 xl:px-10, the same edge
          <main> renders against. A second px-4 on this div (the previous
          implementation) inset the footer 16px further than the page
          content above it. */}
      <div className="grid grid-cols-1 gap-x-12 gap-y-10 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div className="max-w-sm">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Image src={SITE_ICON} alt="" width={28} height={28} className="size-7 rounded-md" />
            <span className="font-display text-lg uppercase tracking-wide text-foreground">
              {SITE_NAME}
            </span>
          </Link>
          <p className="mt-4 text-sm text-[color:var(--aqt-fg-muted)]">
            {t("common.footer.disclaimer", { siteName: SITE_NAME })}
          </p>
        </div>

        <div>
          <p className={COLUMN_HEADING_CLASS}>{t("common.footer.sectionsHeading")}</p>
          <div className="flex flex-col gap-2.5">
            <Link href="/tournaments" className={FOOTER_LINK_CLASS}>
              {t("nav.items.tournaments.title")}
            </Link>
            <Link href="/teams" className={FOOTER_LINK_CLASS}>
              {t("nav.items.teams.title")}
            </Link>
            <Link href="/users" className={FOOTER_LINK_CLASS}>
              {t("nav.items.users.title")}
            </Link>
            <Link href="/matches" className={FOOTER_LINK_CLASS}>
              {t("nav.items.matches.title")}
            </Link>
            <Link href="/achievements" className={FOOTER_LINK_CLASS}>
              {t("nav.items.achievements.title")}
            </Link>
          </div>
        </div>

        <div>
          <p className={COLUMN_HEADING_CLASS}>{t("common.footer.resourcesHeading")}</p>
          <div className="flex flex-col gap-2.5">
            {/* Same host, any tenant: the gateway registers /api/docs
                unconditionally regardless of which workspace domain served
                the request, so a relative link needs no per-host origin. */}
            <Link href="/api/docs" className={FOOTER_LINK_CLASS}>
              {t("common.footer.apiDocs")}
            </Link>
            <Link href="/get-workspace" className={FOOTER_LINK_CLASS}>
              {t("common.footer.getWorkspace")}
            </Link>
            <Link
              href="https://github.com/CraazzzyyFoxx/anak-tournaments"
              className={`${FOOTER_LINK_CLASS} inline-flex items-center gap-1.5`}
            >
              <Github width={14} height={14} />
              {t("common.sourceOnGithub")}
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-8 flex flex-col gap-3 text-xs text-[color:var(--aqt-fg-faint)] sm:flex-row sm:items-center sm:justify-between">
        <span>{t("common.footer.copyright", { year, siteName: SITE_NAME })}</span>
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/terms" className={FOOTER_META_CLASS}>
            {t("legal.terms.title")}
          </Link>
          <Link href="/privacy" className={FOOTER_META_CLASS}>
            {t("legal.privacy.title")}
          </Link>
          <CookieSettingsButton className={FOOTER_META_CLASS} />
        </div>
      </div>
    </footer>
  );
}
