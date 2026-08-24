"use client";

import DivisionIcon from "@/components/DivisionIcon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDivisionGrid } from "@/hooks/useCurrentWorkspace";
import { resolveDivisionFromRank, resolveRankFromDivision, sortTiersAscending } from "@/lib/division-grid";
import { cn } from "@/lib/utils";

type DivisionRankPickerProps = {
  rank: number | null | undefined;
  disabled?: boolean;
  label: string;
  onChange: (rank: number | null) => void;
};

export function DivisionRankPicker({ rank, disabled, label, onChange }: Readonly<DivisionRankPickerProps>) {
  const grid = useDivisionGrid();
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
          {division == null ? "—" : <DivisionIcon division={division} width={22} height={22} />}
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
                <DivisionIcon division={tier.number} width={24} height={24} />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
