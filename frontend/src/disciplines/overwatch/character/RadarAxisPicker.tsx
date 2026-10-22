"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RowButton } from "@/components/ui/row-button";
import { LogStatsName } from "../stat-names";
import { getHumanizedStats } from "../stat-names";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";

const MIN_AXES = 3;
const MAX_AXES = 8;

interface Props {
  /** Currently plotted axes (order preserved). */
  selected: LogStatsName[];
  /** Every stat the hero has data for (selected + addable). */
  candidates: LogStatsName[];
  /** Add when absent / remove when present (parent enforces the 3–8 bounds). */
  onToggle: (name: LogStatsName) => void;
}

/** Radar axis editor: selected stats are removable chips (✕); a "+ Add" chip
 *  opens a searchable list of the remaining stats to add. Mirrors the mockup —
 *  add/remove any number of axes (kept within 3–8). */
const RadarAxisPicker = ({ selected, candidates, onToggle }: Props) => {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const available = useMemo(() => candidates.filter((c) => !selected.includes(c)), [candidates, selected]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? available.filter((c) => getHumanizedStats(c).toLowerCase().includes(q)) : available;
  }, [available, query]);

  const canRemove = selected.length > MIN_AXES;
  const canAdd = selected.length < MAX_AXES && available.length > 0;

  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {selected.map((name) => (
        <span key={name} className="aqt-filter-chip active inline-flex items-center">
          {getHumanizedStats(name)}
          {canRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => onToggle(name)}
              className="-mr-2 text-[color:var(--aqt-fg-muted)] hover:bg-transparent hover:text-[color:var(--aqt-fg)]"
              aria-label={t("users.heroes.removeAxis", { stat: getHumanizedStats(name) })}
            >
              <X aria-hidden />
            </Button>
          ) : null}
        </span>
      ))}

      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="subtle"
            size="sm"
            disabled={!canAdd}
            // Pointer events stay on when disabled so the title still says why.
            className="gap-1 disabled:pointer-events-auto disabled:cursor-not-allowed"
            title={canAdd ? t("users.heroes.addAxis") : t("users.heroes.upToAxes", { count: MAX_AXES })}
          >
            <Plus aria-hidden />
            {t("common.add")}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="center"
          className="w-56 border-[color:var(--aqt-border)] bg-[color:var(--aqt-bg)] p-0"
        >
          <div className="border-b border-[color:var(--aqt-border)] p-2">
            <SearchField
              autoFocus
              label={t("users.heroes.searchStats")}
              placeholder={t("users.heroes.searchStats")}
              value={query}
              onValueChange={setQuery}
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.map((name) => (
              <RowButton
                key={name}
                onClick={() => onToggle(name)}
                className="block px-3 py-1.5 text-caption text-[color:var(--aqt-fg)]"
              >
                {getHumanizedStats(name)}
              </RowButton>
            ))}
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-center text-label text-[color:var(--aqt-fg-dim)]">
                {available.length === 0 ? t("users.heroes.allStatsAdded") : t("users.heroes.noMatch")}
              </div>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default RadarAxisPicker;
