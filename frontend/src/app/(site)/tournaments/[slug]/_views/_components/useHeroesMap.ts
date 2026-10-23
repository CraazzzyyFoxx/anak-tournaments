"use client";

import { useMemo } from "react";

import { useCatalogEntities } from "@/hooks/useCatalogEntities";
import type { CatalogEntityRead } from "@/types/catalog.types";

/**
 * The tournament game's character catalogue as a slug lookup, built once per catalogue rather than
 * once per row. `enabled: false` keeps the request unsent until something on
 * screen actually needs a hero portrait.
 */
export function useHeroesMap(
  discipline: string,
  { enabled = true }: { enabled?: boolean } = {}
): Map<string, CatalogEntityRead> {
  const { data: heroesData } = useCatalogEntities(discipline, "character", { enabled });

  return useMemo(() => {
    const map = new Map<string, CatalogEntityRead>();
    if (heroesData) {
      for (const h of heroesData) {
        map.set(h.slug, h);
      }
    }
    return map;
  }, [heroesData]);
}
