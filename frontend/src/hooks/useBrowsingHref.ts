"use client";

import { usePathname, useSearchParams } from "next/navigation";

import { DISCIPLINE_PARAM, withBrowsingDiscipline } from "@/lib/site/discipline-scope";

/** For imperative navigation (`router.push`): maps an href to the one carrying the surface's `?discipline=` (§2.4). */
export function useBrowsingHrefResolver(): (href: string) => string {
  const pathname = usePathname();
  const discipline = useSearchParams()?.get(DISCIPLINE_PARAM) || null;
  return (href) => (pathname ? withBrowsingDiscipline(href, { pathname, discipline }) : href);
}

/** `href` carrying the current browsing surface's `?discipline=` to a browsing destination (§2.4). */
export function useBrowsingHref<T extends string | object>(href: T): T {
  const resolve = useBrowsingHrefResolver();
  return typeof href === "string" ? (resolve(href) as T) : href;
}
