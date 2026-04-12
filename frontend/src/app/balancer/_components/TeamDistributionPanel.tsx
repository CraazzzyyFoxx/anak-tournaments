import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PANEL_CLASS, TEAM_BADGE_ACCENTS } from "./balancer-page-helpers";
import { calculateTeamAverageFromPayload } from "./balancer-page-helpers";
import type { BalanceVariant } from "./workspace-helpers";

type TeamDistributionPanelProps = {
  variant: BalanceVariant;
  variantSelector?: ReactNode;
};

export function TeamDistributionPanel({ variant, variantSelector }: TeamDistributionPanelProps) {
  const teamAverages = useMemo(
    () => variant.payload.teams.map(calculateTeamAverageFromPayload),
    [variant.payload.teams],
  );

  const average = teamAverages.length > 0
    ? Math.round(teamAverages.reduce((s, v) => s + v, 0) / teamAverages.length)
    : null;
  const min = teamAverages.length > 0 ? Math.min(...teamAverages) : null;
  const max = teamAverages.length > 0 ? Math.max(...teamAverages) : null;
  const spread = min != null && max != null ? max - min : null;
  const stats = variant.payload.statistics ?? null;

  const distributionPoints = useMemo(
    () =>
      variant.payload.teams.map((team, teamIndex) => {
        const teamAvg = teamAverages[teamIndex] ?? calculateTeamAverageFromPayload(team);
        const position =
          min == null || max == null || min === max
            ? 50
            : ((teamAvg - min) / (max - min)) * 100;
        return {
          id: team.id,
          average: teamAvg,
          position,
          accent: TEAM_BADGE_ACCENTS[teamIndex % TEAM_BADGE_ACCENTS.length],
        };
      }),
    [variant.payload.teams, teamAverages, min, max],
  );

  return (
    <div className={cn(PANEL_CLASS, "p-4")}>
      {variantSelector ? (
        <div className="mb-3">{variantSelector}</div>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-white/28">Team distribution</div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="text-3xl font-semibold text-cyan-300">
              {average ?? stats?.averageMMR ?? "-"}
            </span>
            <span className="text-sm text-white/38">Average SR</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 text-right">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-white/24">Spread</div>
            <div className="mt-1 text-lg font-semibold text-amber-300">{spread ?? "-"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-white/24">Range</div>
            <div className="mt-1 text-sm text-white/74">
              {min ?? "-"}
              {min != null && max != null ? ` - ${max}` : ""}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-white/24">StdDev</div>
            <div className="mt-1 text-sm text-white/74">
              {stats?.mmrStdDev != null ? stats.mmrStdDev.toFixed(1) : "-"}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-white/8 bg-black/15 px-4 py-5">
        <div className="relative h-12">
          <div className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full bg-white/4" />
          {distributionPoints.map((point) => (
            <div
              key={point.id}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${Math.max(4, Math.min(point.position, 96))}%` }}
            >
              <span
                className={cn(
                  "inline-flex h-7 min-w-7 items-center justify-center rounded-lg border px-2 text-[11px] font-semibold",
                  point.accent,
                )}
              >
                {point.id}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between text-[11px] text-white/28">
          <span>{min ?? "-"}</span>
          <span>{max ?? "-"}</span>
        </div>
      </div>
    </div>
  );
}
