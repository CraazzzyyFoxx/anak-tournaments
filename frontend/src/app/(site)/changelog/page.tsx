import type { Metadata } from "next";
import type { MDXContent } from "mdx/types";
import { ArrowUpRight } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import { PageHero } from "@/components/site/PageHero";
import { Button } from "@/components/ui/button";
import { REPO_URL } from "@/config/site";
import { RELEASES } from "@/lib/changelog/releases";
import { getFormatter } from "@/lib/datetime/server";

import { toDocLocale } from "../docs/nav";
import styles from "./changelog.module.css";
import { changelogComponents } from "./mdx";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("changelog");
  return { title: `${t("title")} · OWT` };
}

export default async function ChangelogPage() {
  const [t, locale, format] = await Promise.all([getTranslations("changelog"), getLocale(), getFormatter()]);
  const lang = toDocLocale(locale);
  // Runtime-selected: the locale comes from a cookie / Accept-Language, so
  // this cannot be a static import. RELEASES is the allow-list.
  const entries = await Promise.all(
    RELEASES.map(async (release) => ({
      release,
      Content: (await import(`./_content/${lang}/${release.version}.mdx`)).default as MDXContent
    }))
  );

  return (
    <>
      <PageHero compact title={t("title")} lede={t("lede")} />
      {entries.map(({ release, Content }) => {
        const id = `v${release.version}`;
        return (
          <article key={id} id={id} aria-labelledby={`${id}-title`} className={styles.release}>
            <div className={styles.meta}>
              <a href={`#${id}`} className={styles.version}>
                {id}
              </a>
              <time dateTime={release.date} className={styles.date}>
                {format.dateTime(new Date(release.date), { dateStyle: "long", timeZone: "UTC" })}
              </time>
            </div>
            <div className={styles.body}>
              <h2 id={`${id}-title`} className={styles.title}>
                {release.title[lang]}
              </h2>
              <Content components={changelogComponents} />
              <Button variant="outline" asChild className={styles.fullLog}>
                <a href={`${REPO_URL}/releases/tag/${id}`} target="_blank" rel="noreferrer">
                  {t("fullLog")}
                  <ArrowUpRight aria-hidden />
                </a>
              </Button>
            </div>
          </article>
        );
      })}
    </>
  );
}
