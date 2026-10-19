import { useCallback } from "react";
import { useTranslations } from "next-intl";

/**
 * A game's word for one of its side codes: the localized `pickBan.room.sides.<game>.<code>` message when the
 * bundle has one, else the code itself. Never a per-game table in code: the room's `state.sides` decides which
 * codes exist.
 */
export function useSideLabel() {
  const t = useTranslations("pickBan.room");
  return useCallback(
    (discipline: string, code: string): string => {
      // Dynamic `<game>.<side>` path: the typed key union (every game × side) is not worth spelling out.
      const key = `sides.${discipline}.${code}` as never;
      return t.has(key) ? t(key) : code;
    },
    [t]
  );
}
