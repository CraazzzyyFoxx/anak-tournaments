import { Swords, Trophy, UserCircle, Users, type LucideIcon } from "lucide-react";

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
  tournaments: { active: number; total: number } | null;
  teams: number | null;
  players: number | null;
  encounters: number | null;
}

export function KpiStrip({ tournaments, teams, players, encounters }: KpiStripProps) {
  const items: { icon: LucideIcon; value: number; label: string; detail?: string }[] = [];

  if (tournaments !== null) {
    items.push({
      icon: Trophy,
      value: tournaments.total,
      label: "Tournaments",
      detail: `${tournaments.active} active`,
    });
  }

  if (teams !== null) {
    items.push({ icon: Users, value: teams, label: "Teams" });
  }

  if (players !== null) {
    items.push({ icon: UserCircle, value: players, label: "Players" });
  }

  if (encounters !== null) {
    items.push({ icon: Swords, value: encounters, label: "Encounters" });
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
        />
      ))}
    </StatTileGrid>
  );
}
