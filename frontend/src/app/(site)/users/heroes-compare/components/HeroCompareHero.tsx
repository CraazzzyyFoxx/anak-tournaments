"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { PageHero, HeroCoord } from "@/components/site/PageHero";

/** The comparison page's title block; its headline figures (`aside`) are the browsed game's module's. */
const HeroCompareHero = ({ aside }: Readonly<{ aside: ReactNode }>) => {
  const t = useTranslations();

  return (
    <PageHero
      eyebrow={
        <HeroCoord className="inline-flex items-center gap-2">
          <Link href="/users" className="transition-colors hover:text-[color:var(--aqt-teal)]">
            {t("users.heroesCompare.hero.usersBreadcrumb")}
          </Link>
          <ChevronRight aria-hidden className="h-3 w-3 opacity-50" />
          <span>{t("users.heroesCompare.hero.breadcrumb")}</span>
        </HeroCoord>
      }
      title={t("users.heroesCompare.hero.title")}
      lede={t("users.heroesCompare.hero.lede")}
      aside={aside}
    />
  );
};

export default HeroCompareHero;
