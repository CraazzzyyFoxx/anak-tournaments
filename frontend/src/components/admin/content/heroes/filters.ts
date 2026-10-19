import type { FilterDef } from "@/components/kit/useFilters";

/** One chip: the game's own character classes. A game that declares none renders no chip row at all. */
export function heroFilterDefs(
  classes: readonly string[],
  classLabel: (code: string) => string,
  t: (key: "filters.class") => string
): FilterDef[] {
  return [
    {
      key: "class",
      label: t("filters.class"),
      kind: "single",
      options: classes.map((code) => ({ value: code, label: classLabel(code) })),
    },
  ];
}
