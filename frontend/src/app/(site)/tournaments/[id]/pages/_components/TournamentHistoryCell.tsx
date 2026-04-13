"use client";

import PlayerDivisionIcon from "@/components/PlayerDivisionIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TournamentHistoryEntry } from "@/types/registration.types";

const ROLE_LABELS: Record<string, string> = {
  tank: "Tank",
  dps: "DPS",
  support: "Support",
};

const ROLE_TO_ICON: Record<string, string> = {
  tank: "Tank",
  dps: "Damage",
  support: "Support",
};

export default function TournamentHistoryCell({
  history,
}: {
  history: TournamentHistoryEntry[];
}) {
  if (!history || history.length === 0) {
    return (
      <span className="inline-flex items-center rounded-md border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-400">
        New
      </span>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`${history.length} previous ${history.length === 1 ? "tournament" : "tournaments"}`}
            className="inline-flex items-center rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-xs font-medium text-white/65 transition hover:border-white/20 hover:bg-white/8 hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111113]"
          >
            {history.length}x
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-xs border border-white/[0.08] bg-[#111113] px-3 py-2 text-white shadow-xl shadow-black/40"
        >
          <ul className="space-y-1 text-xs">
            {history.slice(0, 10).map((h) => (
              <li key={h.tournament_id} className="space-y-1">
                <div className="text-white/80">{h.tournament_name}</div>
                {(h.role || h.division != null) ? (
                  <div className="flex items-center gap-2 text-white/45">
                    {h.role ? (
                      <span
                        className="inline-flex items-center"
                        title={ROLE_LABELS[h.role] ?? h.role}
                      >
                        <PlayerRoleIcon
                          role={ROLE_TO_ICON[h.role] ?? h.role}
                          size={16}
                        />
                      </span>
                    ) : null}
                    {h.division != null ? (
                      <span
                        className="inline-flex items-center"
                        title={`Division ${h.division}`}
                      >
                        <PlayerDivisionIcon division={h.division} width={20} height={20} />
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
            {history.length > 10 && (
              <li className="text-white/30">+{history.length - 10} more</li>
            )}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
