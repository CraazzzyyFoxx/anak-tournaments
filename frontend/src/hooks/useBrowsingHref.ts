"use client";

import { usePathname, useSearchParams } from "next/navigation";

import { DISCIPLINE_PARAM, withBrowsingDiscipline } from "@/lib/site/discipline-scope";

/** `href` carrying the current browsing surface's `?discipline=` to a browsing destination (§2.4). */
export function useBrowsingHref<T extends string | object>(href: T): T {
  const pathname = usePathname();
  const discipline = useSearchParams()?.get(DISCIPLINE_PARAM) || null;
  return typeof href === "string" && pathname ? (withBrowsingDiscipline(href, { pathname, discipline }) as T) : href;
}
