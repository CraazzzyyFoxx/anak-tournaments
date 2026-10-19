import type { useTranslations } from "next-intl";

/**
 * The one named translator contract for this tree. Consumers import `Translate`
 * rather than restating `ReturnType<...>` at each site.
 *
 * It has to be derived: neither `next-intl` nor `use-intl` exports a translator
 * type — next-intl's own `useTranslations.d.ts` is itself
 * `ReturnType<typeof useTranslationsType>` — so there is no upstream name to
 * import. Declaring it once here is the closest thing to owning it.
 */
export type Translate = ReturnType<typeof useTranslations<never>>;

export const parsePositiveInt = (value: string | null, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

export const formatOptional = (value: number | null): string => {
  if (value === null) return "-";
  return value.toFixed(2);
};


/**
 * Compact, language-neutral handle for a tournament in dense UI (chart axis
 * ticks, encounter chips). Tournament names are long and frequently non-Latin
 * ("Турнір Сабов Анакq #42"), so the previous `name.slice(0, 3 | 4)` emitted a
 * row of identical stubs — "ТУР" on every encounter row, "Турн" on most axis
 * ticks — which render as Latin "TYP"/"TypH" in the display face and carry no
 * information. The trailing "#N" is the handle players actually use; league legs
 * fall back to their numbered leg ("… | Day 3" → "D3").
 *
 * Returns `null` when the name yields nothing meaningful, so callers can omit
 * the label instead of printing a truncation.
 */
export const tournamentTag = (name: string): string | null => {
  const numbered = /#\s*(\d+)/.exec(name);
  if (numbered) return `T${numbered[1]}`;
  const leg = /\|\s*(.+)$/.exec(name);
  if (!leg) return null;
  const legNumber = /(\d+)/.exec(leg[1]);
  return legNumber ? `D${legNumber[1]}` : null;
};
