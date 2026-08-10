import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import Github from "@/components/icons/Github";
import { SITE_NAME } from "@/config/site";

const FOOTER_LINK_CLASS =
  "text-sm text-[color:var(--aqt-fg-muted)] transition-colors hover:text-[color:var(--aqt-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const COLUMN_HEADING_CLASS =
  "mb-3 text-[11px] font-semibold tracking-[0.14em] uppercase text-muted-foreground/50";

export function Footer() {
  const t = useTranslations();
  return (
    <footer className="py-8 text-[color:var(--aqt-fg)]">
      <div className="flex flex-wrap gap-8 justify-between px-4">
        <div className="max-w-sm">
          <p className="text-xl font-bold mb-4">{SITE_NAME}</p>
          <p className="text-sm text-[color:var(--aqt-fg-muted)]">
            {t("common.footer.disclaimer", { siteName: SITE_NAME })}
          </p>
        </div>

        <div>
          <p className={COLUMN_HEADING_CLASS}>{t("common.footer.sectionsHeading")}</p>
          <div className="flex flex-col gap-2">
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
          <div className="flex flex-col gap-2">
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
    </footer>
  );
}
