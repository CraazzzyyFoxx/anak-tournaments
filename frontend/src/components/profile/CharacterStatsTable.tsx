"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import CatalogEntityImage from "@/components/catalog/CatalogEntityImage";
import { CardSurface } from "@/components/profile/atoms";
import { PROFILE_METADATA_AXIS } from "@/components/profile/ProfileWidget";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import { useFormatter } from "@/lib/datetime/client";
import { formatStat } from "@/lib/stats/format";
import type { CharacterSummary } from "@/types/user.types";

const headCell =
  "aqt-tnum border-b border-[color:var(--aqt-border)] px-3 py-2.5 text-label font-bold uppercase tracking-label text-[color:var(--aqt-fg-faint)]";

/**
 * A player's characters as a plain definition-driven table: one column per active stat the game declares and the
 * player has a value for (its declared name, order and `value_format`), the character's career value in each
 * cell. The generic view of a game whose module draws no characters tab of its own; a missing value is a dash.
 */
export default function CharacterStatsTable({
  discipline,
  characters,
  title,
  action,
  limit
}: Readonly<{
  discipline: string;
  characters: CharacterSummary[];
  /** Defaults to the localized "Characters". */
  title?: string;
  action?: ReactNode;
  limit?: number;
}>) {
  const t = useTranslations();
  const format = useFormatter();
  const definitions = useDisciplineMetadata(PROFILE_METADATA_AXIS, discipline).data?.stat_defs ?? [];
  const present = new Set(characters.flatMap((row) => row.stats.map((stat) => stat.name)));
  const columns = definitions
    .filter((def) => def.active && present.has(def.code))
    .sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
  const rows = limit === undefined ? characters : characters.slice(0, limit);

  return (
    <CardSurface title={title ?? t("common.characters")} action={action}>
      {rows.length === 0 ? (
        <div className="py-10 text-center text-caption text-[color:var(--aqt-fg-dim)]">{t("users.heroes.noStats")}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-caption">
            <thead>
              <tr>
                <th scope="col" className={`${headCell} text-left`}>
                  {t("common.characters")}
                </th>
                {columns.map((def) => (
                  <th key={def.code} scope="col" className={`${headCell} whitespace-nowrap text-right`}>
                    {def.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.character.id} className="border-b border-[color:var(--aqt-border)] last:border-b-0">
                  <th scope="row" className="px-3 py-2.5 text-left font-normal">
                    <span className="flex items-center gap-2.5">
                      <CatalogEntityImage entity={row.character} size="sm" decorative />
                      <span className="truncate font-bold text-[color:var(--aqt-fg)]">{row.character.name}</span>
                    </span>
                  </th>
                  {columns.map((def) => (
                    <td key={def.code} className="aqt-tnum px-3 py-2.5 text-right text-[color:var(--aqt-fg-muted)]">
                      {formatStat(def, row.stats.find((stat) => stat.name === def.code)?.overall, format)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CardSurface>
  );
}
