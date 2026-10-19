import { ClipboardList, ScrollText, Swords, Trophy, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { StatTile, StatTileGrid } from "@/components/admin/StatTile";

/**
 * Column class for `count` KPI tiles. Exported so the dashboard's loading
 * skeleton can reserve exactly the tiles the reader's role will get.
 */
export function kpiColumnsClass(count: number): string {
  if (count >= 4) return "xl:grid-cols-4";
  if (count === 3) return "xl:grid-cols-3";
  return "xl:grid-cols-2";
}

interface KpiStripProps {
  /** Tournaments the reader can act on now, against the lifetime total. */
  tournaments: { active: number; total: number } | null;
  /** Tournaments currently accepting entries. */
  registrationOpen: number | null;
  /** Bracket progress of every visible tournament. */
  matches: { completed: number; total: number } | null;
  /** Encounters carrying parsed logs, against every encounter. */
  logs: { covered: number; total: number } | null;
}

/**
 * The dashboard's four decision metrics.
 *
 * These used to be lifetime totals (tournaments / teams / players /
 * encounters) — numbers that only ever grow and answer no question an admin
 * arrives with. Each tile now states where the current cycle stands. A
 * second line only when it adds a number; colour only when one needs work.
 */
export function KpiStrip({ tournaments, registrationOpen, matches, logs }: Readonly<KpiStripProps>) {
  const t = useTranslations("adminShell.dashboard");
  const items: {
    icon: LucideIcon;
    value: string | number;
    label: string;
    detail?: string;
    warn?: boolean;
  }[] = [];

  if (tournaments !== null) {
    items.push({
      icon: Trophy,
      value: tournaments.active,
      label: t("activeTournaments"),
      detail: t("inTotal", { count: tournaments.total })
    });
  }

  if (registrationOpen !== null) {
    items.push({
      icon: ClipboardList,
      value: registrationOpen,
      label: t("registrationOpen")
    });
  }

  if (matches !== null) {
    const remaining = matches.total - matches.completed;
    items.push({
      icon: Swords,
      value: `${matches.completed} / ${matches.total}`,
      label: t("matchesPlayed"),
      detail: remaining > 0 ? t("stillToPlay", { count: remaining }) : undefined
    });
  }

  if (logs !== null) {
    const percent = logs.total > 0 ? Math.round((logs.covered / logs.total) * 100) : 100;
    const missing = logs.total - logs.covered;
    items.push({
      icon: ScrollText,
      value: `${percent}%`,
      label: t("logCoverage"),
      detail: missing > 0 ? t("withoutLogs", { count: missing }) : undefined,
      warn: missing > 0
    });
  }

  if (items.length === 0) return null;

  return (
    <StatTileGrid className={kpiColumnsClass(items.length)}>
      {items.map((item) => (
        <StatTile
          key={item.label}
          label={item.label}
          value={item.value}
          detail={item.detail}
          icon={item.icon}
          tone={item.warn ? "warning" : "neutral"}
        />
      ))}
    </StatTileGrid>
  );
}
