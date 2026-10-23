"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type QueryParamValue = string | number | boolean | null | undefined;

export interface UseQueryParamsOptions {
  /**
   * `replace` (default) keeps filter churn out of the back-button history;
   * `push` is for navigation the user should be able to step back through.
   */
  mode?: "push" | "replace";
  /**
   * Params reset to their default whenever any *other* param changes — almost
   * always `["page"]`, so narrowing a filter does not strand the user on a page
   * that no longer exists.
   */
  resetOnChange?: string[];
  /**
   * Write the URL with the History API instead of the router. Next syncs
   * `useSearchParams` from a native `pushState`/`replaceState` without a
   * server round trip, so the change lands in the same tick — right for
   * client-only state such as an open inspector row. Leave it off wherever a
   * server component reads `searchParams` and must re-render.
   */
  shallow?: boolean;
}

/**
 * The single URL-query writer for the public site.
 *
 * Replaces five near-identical hand-rolled versions that each re-implemented
 * "merge these updates into the current query string, dropping empty values",
 * and disagreed on whether to reset the page and whether to push or replace.
 *
 * Passing `null`, `undefined` or `""` deletes the param, so callers never have
 * to branch between `set` and `delete`.
 */
export function useQueryParams({
  mode = "replace",
  resetOnChange = ["page"],
  shallow = false
}: UseQueryParamsOptions = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setParams = useCallback(
    (updates: Record<string, QueryParamValue>) => {
      const next = new URLSearchParams(searchParams?.toString() ?? "");

      const touchesNonReset = Object.keys(updates).some((key) => !resetOnChange.includes(key));
      if (touchesNonReset) {
        for (const key of resetOnChange) {
          if (!(key in updates)) next.delete(key);
        }
      }

      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined || value === "") {
          next.delete(key);
          continue;
        }
        next.set(key, String(value));
      }

      const query = next.toString();
      const url = query ? `${pathname}?${query}` : pathname;
      if (shallow) {
        if (mode === "push") window.history.pushState(null, "", url);
        else window.history.replaceState(null, "", url);
      } else if (mode === "push") router.push(url);
      else router.replace(url, { scroll: false });
    },
    [mode, pathname, resetOnChange, router, searchParams, shallow]
  );

  return { searchParams, setParams };
}
