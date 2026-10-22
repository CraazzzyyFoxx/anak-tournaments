import {
  TEAM_BADGE_ACCENTS,
  calculateTeamAverageFromPayload,
  calculateTeamTotalFromPayload
} from "@/components/balancer/balancer-page-helpers";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { InternalBalancePayload } from "@/types/balancer-admin.types";

/**
 * A balanced team's card head: the accent `#id` chip, the name, and its total
 * and average rating. The editor's team card and the exported image draw the
 * same head, so it is one component.
 */
export function BalanceTeamHeader({
  team,
  teamIndex
}: Readonly<{ team: InternalBalancePayload["teams"][number]; teamIndex: number }>) {
  const total = Math.round(calculateTeamTotalFromPayload(team));
  const average = Math.round(calculateTeamAverageFromPayload(team));

  return (
    <div className="flex items-start justify-between gap-3 border-b border-[color:var(--aqt-border)] px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <Badge
          shape="pill"
          className={cn(
            "px-2.5 py-1 text-label font-semibold uppercase tracking-label",
            TEAM_BADGE_ACCENTS[teamIndex % TEAM_BADGE_ACCENTS.length]
          )}
        >
          #{team.id}
        </Badge>
        <div
          className="truncate text-sm font-semibold text-[color:var(--aqt-fg)]"
          title={team.name}
        >
          {team.name}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-label font-medium text-[color:var(--aqt-fg-muted)]">
          <span>
            Total: <span className="tabular-nums text-[color:var(--aqt-fg)]">{total}</span>
          </span>
          <span>
            Avg: <span className="tabular-nums text-[color:var(--aqt-fg)]">{average}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
