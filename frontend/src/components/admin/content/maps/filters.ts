import type { FilterDef } from "@/components/kit/useFilters";
import type { CatalogEntityRead } from "@/types/catalog.types";

/** Mode and competitive pool; a game without modes has neither, so its maps get no chips. */
export function mapFilterDefs({
  hasModes,
  modes,
  modeLabel,
  t,
}: Readonly<{
  hasModes: boolean;
  modes: readonly CatalogEntityRead[];
  modeLabel: string;
  t: (
    key: "filters.mode" | "filters.modePool" | "catalog.competitive" | "catalog.casual",
    values?: { kind: string }
  ) => string;
}>): FilterDef[] {
  if (!hasModes) return [];
  return [
    {
      key: "mode",
      label: t("filters.mode", { kind: modeLabel }),
      kind: "single",
      options: modes.map((mode) => ({ value: mode.id.toString(), label: mode.name })),
    },
    {
      key: "in_competitive",
      label: t("filters.modePool"),
      kind: "single",
      options: [
        { value: "true", label: t("catalog.competitive") },
        { value: "false", label: t("catalog.casual") },
      ],
    },
  ];
}
