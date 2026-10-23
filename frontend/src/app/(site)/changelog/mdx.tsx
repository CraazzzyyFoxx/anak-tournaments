import { ArrowRight } from "lucide-react";
import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import type { ReactNode } from "react";

import Image from "@/components/ui/image";

import { mdxComponents } from "../docs/mdx";
import styles from "./changelog.module.css";

/** The entry's opening paragraph, a size above the body. */
function Lead({ children }: Readonly<{ children: ReactNode }>) {
  return <p className={styles.lead}>{children}</p>;
}

/** "Learn more" into the docs. */
function More({ href, children }: Readonly<{ href: string; children: ReactNode }>) {
  return (
    <Link href={href} prefetch={false} className={styles.more}>
      {children}
      <ArrowRight size={14} aria-hidden />
    </Link>
  );
}

/** A screenshot; it opens full size in a new tab. */
function Shot({
  src,
  width,
  height,
  alt,
  priority
}: Readonly<{ src: string; width: number; height: number; alt: string; priority?: boolean }>) {
  return (
    <figure className={styles.shot}>
      <a href={src} target="_blank" rel="noreferrer" className={styles.shotLink}>
        <Image
          src={src}
          width={width}
          height={height}
          alt={alt}
          sizes="(min-width: 1024px) 880px, 100vw"
          // `priority` in the MDX, `preload` in Next 16: the old name is deprecated.
          preload={priority}
          className={styles.shotImage}
        />
      </a>
    </figure>
  );
}

/** Text beside a screenshot on a wide screen. */
function Split({ children }: Readonly<{ children: ReactNode }>) {
  return <div className={styles.split}>{children}</div>;
}

/** The closing round-up: a title over two columns of short items. */
function Also({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className={styles.also}>
      <h3>{title}</h3>
      <div className={styles.alsoColumns}>{children}</div>
    </section>
  );
}

/** Everything a changelog entry may use. Anything else in an MDX file fails to render. */
export const changelogComponents: MDXComponents = { ...mdxComponents, Lead, More, Shot, Split, Also };
