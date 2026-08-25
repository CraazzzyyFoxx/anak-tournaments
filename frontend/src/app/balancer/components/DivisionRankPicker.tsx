"use client";

import DivisionIcon from "@/components/DivisionIcon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDivisionGrid } from "@/hooks/useCurrentWorkspace";
import { resolveDivisionFromRank, resolveRankFromDivision, sortTiersAscending } from "@/lib/division-grid";
import { cn } from "@/lib/utils";
import type { DivisionGrid } from "@/types/workspace.types";

type DivisionRankPickerProps = {
  rank: number | null | undefined;
  disabled?: boolean;
  label: string;
  onChange: (rank: number | null) => void;
  /**
   * The tiers this picker offers. Omitted = the workspace's.
   *
   * A mix MUST pass `OW_REFERENCE_GRID`: balancer-service resolves a mix's
   * ranks against the global, OW-synced grid (`workspace_id=None`), so a
   * workspace's tiers here write a rating that means something else.
   */
  grid?: DivisionGrid;
};

export function DivisionRankPicker({
  rank,
  disabled,
  label,
  onChange,
  grid: gridOverride,
}: Readonly<DivisionRankPickerProps>) {
  // The workspace's tiers by default. Reading the default grid here made it
  // offer ranks the workspace does not use and label them with the wrong crest.
  const workspaceGrid = useDivisionGrid();
  const grid = gridOverride ?? workspaceGrid;
  const division = grid ? resolveDivisionFromRank(grid, rank ?? null) : null;
  const tiers = grid ? sortTiersAscending(grid) : [];

  if (!grid || tiers.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          className={cn(
            "flex size-8 items-center justify-center rounded-md border border-[color:var(--aqt-border)] bg-black/20 transition-colors hover:bg-white/5 disabled:opacity-50",
            division == null && "text-[11px] text-muted-foreground",
          )}
        >
          {division == null ? "—" : <DivisionIcon division={division} tournamentGrid={grid} width={22} height={22} />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div className="mb-2">
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        </div>
        <div className="grid grid-cols-5 gap-1">
          {tiers.map((tier) => {
            const selected = tier.number === division;
            return (
              <button
                key={tier.id ?? tier.number}
                type="button"
                disabled={disabled}
                title={tier.name}
                aria-label={tier.name}
                aria-pressed={selected}
                className={cn(
                  "flex size-9 items-center justify-center rounded-md border border-transparent hover:bg-white/5",
                  selected && "border-[color:var(--aqt-border-2)] bg-white/10",
                )}
                onClick={() => onChange(resolveRankFromDivision(grid, tier.number))}
              >
                <DivisionIcon division={tier.number} tournamentGrid={grid} width={24} height={24} />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
