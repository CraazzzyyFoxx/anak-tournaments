import { useCallback } from "react";
import { useTranslations } from "next-intl";

import type { CatalogKind } from "@/types/catalog.types";
import type { DisciplineDescriptor } from "@/types/discipline.types";

/**
 * The game's own word for a catalog kind ("Hero" for Overwatch, "Champion" for League): the localized
 * `disciplineKinds.<code>.<kind>` message when the bundle has one, else the module's declared label, else the kind
 * code. Never a fixed per-game table in code: the descriptor decides which kinds exist.
 */
export function useKindLabel() {
  const t = useTranslations("disciplineKinds");
  return useCallback(
    (descriptor: Pick<DisciplineDescriptor, "code" | "kinds">, kind: CatalogKind): string => {
      // Dynamic `<game>.<kind>` path: the typed key union (every game × kind) is not worth spelling out.
      const key = `${descriptor.code}.${kind}` as never;
      return t.has(key) ? t(key) : (descriptor.kinds[kind] ?? kind);
    },
    [t]
  );
}
