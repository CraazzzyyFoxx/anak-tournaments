"use client";

import { useEffect, useMemo, useState } from "react";
import { GripVertical, History, Loader2, MoreHorizontal, Plus, Save, Trash2, X } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import PlayerDivisionIcon from "@/components/PlayerDivisionIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { useDivisionGrid } from "@/hooks/useCurrentWorkspace";
import { cn } from "@/lib/utils";
import type { DivisionGrid } from "@/types/workspace.types";
import {
  BalancerPlayerRecord,
  BalancerPlayerRoleEntry,
  BalancerRoleCode,
  BalancerRoleSubtype,
} from "@/types/balancer-admin.types";
import {
  fetchPlayerRankHistoryPreview,
  resolveDivisionFromRankHelper,
  type PlayerRankHistoryPreview,
  type PlayerRankHistoryPreviewEntry,
} from "@/app/balancer/_components/workspace-helpers";

const ROLE_OPTIONS: Array<{ value: BalancerRoleCode; label: string }> = [
  { value: "tank", label: "Tank" },
  { value: "dps", label: "Damage" },
  { value: "support", label: "Support" },
];

const SUBTYPE_OPTIONS: Record<BalancerRoleCode, Array<{ value: BalancerRoleSubtype; label: string }>> = {
  tank: [],
  dps: [
    { value: "hitscan", label: "Hitscan" },
    { value: "projectile", label: "Projectile" },
  ],
  support: [
    { value: "main_heal", label: "Main Heal" },
    { value: "light_heal", label: "Light Heal" },
  ],
};

const ROLE_DISPLAY: Record<BalancerRoleCode, string> = {
  tank: "Tank",
  dps: "Damage",
  support: "Support",
};

const ROLE_ACCENTS: Record<
  BalancerRoleCode,
  { row: string; text: string; chip: string; line: string; sliderColor: string }
> = {
  tank: {
    row: "border-sky-400/40 bg-sky-500/[0.07] shadow-[0_0_0_1px_rgba(56,189,248,0.08)]",
    text: "text-sky-200",
    chip: "border-sky-300/30 bg-sky-500/12 text-sky-200",
    line: "bg-sky-300",
    sliderColor: "#7dd3fc",
  },
  dps: {
    row: "border-orange-400/40 bg-orange-500/[0.07] shadow-[0_0_0_1px_rgba(251,146,60,0.08)]",
    text: "text-orange-200",
    chip: "border-orange-300/30 bg-orange-500/12 text-orange-200",
    line: "bg-orange-300",
    sliderColor: "#fdba74",
  },
  support: {
    row: "border-emerald-400/40 bg-emerald-500/[0.07] shadow-[0_0_0_1px_rgba(52,211,153,0.08)]",
    text: "text-emerald-200",
    chip: "border-emerald-300/30 bg-emerald-500/12 text-emerald-200",
    line: "bg-emerald-300",
    sliderColor: "#6ee7b7",
  },
};

function normalizeRoleEntries(
  entries: BalancerPlayerRoleEntry[],
): BalancerPlayerRoleEntry[] {
  const seen = new Set<BalancerRoleCode>();
  const sorted = [...entries].sort((a, b) => a.priority - b.priority);
  const normalized: BalancerPlayerRoleEntry[] = [];

  for (const entry of sorted) {
    if (seen.has(entry.role)) continue;
    seen.add(entry.role);
    normalized.push({
      role: entry.role,
      subtype: entry.subtype ?? null,
      priority: normalized.length + 1,
      division_number: entry.division_number ?? null,
      rank_value: entry.rank_value,
      is_active: entry.is_active ?? true,
    });
  }

  return normalized;
}

function applyHistoryToSelectedRoles(
  entries: BalancerPlayerRoleEntry[],
  history: Partial<Record<BalancerRoleCode, number>> | null,
  resolveDivision: (rankValue: number | null) => number | null,
): BalancerPlayerRoleEntry[] {
  if (!history) {
    return entries;
  }

  return normalizeRoleEntries(
    entries.map((entry) => {
      const rankValue = history[entry.role];
      if (rankValue == null) {
        return entry;
      }

      return {
        ...entry,
        rank_value: rankValue,
        division_number: resolveDivision(rankValue),
      };
    }),
  );
}

function applyHistoryPreviewToRoleEntries(
  entries: BalancerPlayerRoleEntry[],
  preview: PlayerRankHistoryPreview | null,
  resolveDivision: (rankValue: number | null) => number | null,
): BalancerPlayerRoleEntry[] {
  if (!preview || preview.entries.length === 0) {
    return entries;
  }

  const byRole = new Map(entries.map((entry) => [entry.role, entry]));
  for (const historyEntry of preview.entries) {
    const existingEntry = byRole.get(historyEntry.role);
    if (existingEntry) {
      byRole.set(historyEntry.role, {
        ...existingEntry,
        rank_value: historyEntry.rank_value,
        division_number: resolveDivision(historyEntry.rank_value),
        is_active: true,
      });
      continue;
    }

    byRole.set(historyEntry.role, {
      role: historyEntry.role,
      subtype: null,
      priority: entries.length + byRole.size,
      division_number: resolveDivision(historyEntry.rank_value),
      rank_value: historyEntry.rank_value,
      is_active: true,
    });
  }

  return normalizeRoleEntries(Array.from(byRole.values()));
}

function getSubtypeLabel(role: BalancerRoleCode, subtype: BalancerRoleSubtype | null): string | null {
  if (!subtype) {
    return null;
  }

  return SUBTYPE_OPTIONS[role].find((option) => option.value === subtype)?.label ?? subtype;
}

function getAverageRankValue(entries: BalancerPlayerRoleEntry[]): number | null {
  const rankedEntries = entries.filter((entry) => entry.is_active && entry.rank_value != null);
  if (rankedEntries.length === 0) {
    return null;
  }

  const total = rankedEntries.reduce((sum, entry) => sum + (entry.rank_value ?? 0), 0);
  return Math.round(total / rankedEntries.length);
}

function getDivisionGridBounds(grid: DivisionGrid): { min: number; max: number } {
  if (!grid.tiers.length) {
    return { min: 0, max: 5000 };
  }

  const mins = grid.tiers.map((tier) => tier.rank_min);
  const maxes = grid.tiers
    .map((tier) => tier.rank_max)
    .filter((value): value is number => value !== null);

  return {
    min: Math.min(...mins),
    max: Math.max(...maxes, ...mins),
  };
}

function getSliderDivisionTiers(grid: DivisionGrid) {
  return [...grid.tiers].sort((left, right) => left.rank_min - right.rank_min);
}

function resolveRankFromDivisionHelper(
  divisionNumber: number | null,
  grid: DivisionGrid,
): number | null {
  if (divisionNumber == null) {
    return null;
  }

  const tier = grid.tiers.find((candidate) => candidate.number === divisionNumber);
  if (!tier) {
    return null;
  }

  return tier.rank_min;
}

function getDivisionSliderIndex(
  rankValue: number | null,
  divisionTiers: DivisionGrid["tiers"],
  resolveDivision: (rankValue: number | null) => number | null,
): number {
  const divisionNumber = resolveDivision(rankValue);
  const index = divisionTiers.findIndex((tier) => tier.number === divisionNumber);
  return index >= 0 ? index : 0;
}

function getRankFillPercentFromDivisionIndex(
  divisionIndex: number,
  totalDivisions: number,
): number {
  if (totalDivisions <= 1) {
    return 100;
  }

  return (divisionIndex / (totalDivisions - 1)) * 100;
}

function formatTournamentSource(entry: PlayerRankHistoryPreviewEntry): string {
  return `${entry.tournament_name} #${entry.tournament_number}`;
}

function buildHistoryChangeText(
  currentEntry: BalancerPlayerRoleEntry | undefined,
  historyEntry: PlayerRankHistoryPreviewEntry,
): string {
  if (!currentEntry) {
    return `Will add this role with ${historyEntry.rank_value}.`;
  }

  if (currentEntry.rank_value == null) {
    return `Will set ${historyEntry.rank_value} on the existing role.`;
  }

  if (currentEntry.rank_value === historyEntry.rank_value) {
    return `Matches the current SR (${currentEntry.rank_value}).`;
  }

  return `Current ${currentEntry.rank_value} -> new ${historyEntry.rank_value}.`;
}

type SortableRoleEntryProps = {
  id: string;
  entry: BalancerPlayerRoleEntry;
  index: number;
  resolveDivision: (rankValue: number | null) => number | null;
  resolveRankFromDivision: (divisionNumber: number | null) => number | null;
  getDivisionName: (divisionNumber: number | null) => string | null;
  divisionTiers: DivisionGrid["tiers"];
  sliderBounds: { min: number; max: number };
  onUpdate: (index: number, next: BalancerPlayerRoleEntry) => void;
  onRemove: (index: number) => void;
};

function SortableRoleEntry({
  id,
  entry,
  index,
  resolveDivision,
  resolveRankFromDivision,
  getDivisionName,
  divisionTiers,
  sliderBounds,
  onUpdate,
  onRemove,
}: SortableRoleEntryProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    position: isDragging ? ("relative" as const) : undefined,
    boxShadow: isDragging ? "0 22px 56px rgba(0,0,0,0.34)" : undefined,
  };

  const divisionNumber = resolveDivision(entry.rank_value);
  const divisionName = getDivisionName(divisionNumber);
  const accent = ROLE_ACCENTS[entry.role];
  const subtypeLabel = getSubtypeLabel(entry.role, entry.subtype);
  const hasSubtypeOptions = SUBTYPE_OPTIONS[entry.role].length > 0;
  const divisionSliderIndex = getDivisionSliderIndex(entry.rank_value, divisionTiers, resolveDivision);
  const rankFillPercent = getRankFillPercentFromDivisionIndex(
    divisionSliderIndex,
    divisionTiers.length,
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "grid gap-3 rounded-2xl border p-3.5 transition-colors md:grid-cols-[52px_minmax(0,1fr)]",
        entry.is_active
          ? cn("border-white/10 bg-white/[0.03]", accent.row)
          : "border-white/8 bg-white/[0.02] opacity-80",
      )}
    >
      <div className="flex items-center justify-between md:flex-col md:items-center md:justify-center md:gap-2">
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-xl border border-white/10 bg-black/15 text-white/45 hover:text-white/80 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/30">
          #{index + 1}
        </span>
      </div>

      <div className="space-y-3">
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2">
              <PlayerRoleIcon role={ROLE_DISPLAY[entry.role]} size={20} />
              <span className={cn("text-base font-semibold", entry.is_active ? accent.text : "text-white/70")}>
                {ROLE_DISPLAY[entry.role]}
              </span>
            </div>
            {subtypeLabel ? (
              <Badge className={cn("border", accent.chip)}>{subtypeLabel}</Badge>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-black/15 px-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">
                Status
              </span>
              <Switch
                checked={entry.is_active}
                onCheckedChange={(checked) =>
                  onUpdate(index, {
                    ...entry,
                    is_active: checked,
                  })
                }
                aria-label={entry.is_active ? "Disable role" : "Enable role"}
              />
              <span
                className={cn(
                  "text-[11px] font-semibold uppercase tracking-[0.18em]",
                  entry.is_active ? accent.text : "text-white/45",
                )}
              >
                {entry.is_active ? "Active" : "Disabled"}
              </span>
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-xl border border-white/10 bg-black/15 text-white/45 hover:bg-white/5 hover:text-white"
              onClick={() => onRemove(index)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid gap-2.5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)_minmax(0,180px)]">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">
                Sub-role
              </span>
              {hasSubtypeOptions ? null : (
                <span className="text-[11px] text-white/35">Not required</span>
              )}
            </div>
            <Select
              value={entry.subtype ?? "none"}
              disabled={!hasSubtypeOptions}
              onValueChange={(value) =>
                onUpdate(index, {
                  ...entry,
                  subtype: value === "none" ? null : (value as BalancerRoleSubtype),
                })
              }
            >
              <SelectTrigger
                className={cn(
                  "h-10 w-full border-white/12 bg-black/15 text-white",
                  !entry.is_active && "text-white/45",
                )}
              >
                <SelectValue placeholder="Sub-role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No sub-role</SelectItem>
                {SUBTYPE_OPTIONS[entry.role].map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">
                Skill rating
              </span>
              {entry.rank_value != null ? (
                <span className={cn("text-xs font-semibold", entry.is_active ? accent.text : "text-white/45")}>
                  {entry.rank_value}
                </span>
              ) : null}
            </div>
            <Input
              type="number"
              min={sliderBounds.min}
              max={sliderBounds.max}
              className={cn(
                "h-10 border-white/12 bg-black/15 text-white shadow-none focus-visible:ring-1 focus-visible:ring-violet-400/40",
                !entry.is_active && "text-white/45",
              )}
              value={entry.rank_value ?? ""}
              onChange={(event) => {
                const rankValue = event.target.value ? Number(event.target.value) : null;
                onUpdate(index, {
                  ...entry,
                  rank_value: rankValue,
                  division_number: resolveDivision(rankValue),
                });
              }}
            />
            <div className="space-y-1.5">
              <input
                type="range"
                min={0}
                max={Math.max(divisionTiers.length - 1, 0)}
                step={1}
                disabled={!entry.is_active}
                value={divisionSliderIndex}
                onChange={(event) => {
                  const nextIndex = Number(event.target.value);
                  const nextDivision = divisionTiers[nextIndex]?.number ?? null;
                  const rankValue = resolveRankFromDivision(nextDivision);
                  onUpdate(index, {
                    ...entry,
                    rank_value: rankValue,
                    division_number: nextDivision,
                  });
                }}
                className={cn(
                  "h-2 w-full cursor-pointer appearance-none rounded-full bg-white/8",
                  !entry.is_active && "cursor-not-allowed opacity-50",
                )}
                style={{
                  accentColor: accent.sliderColor,
                  background: `linear-gradient(90deg, ${accent.sliderColor} 0%, ${accent.sliderColor} ${rankFillPercent}%, rgba(255,255,255,0.08) ${rankFillPercent}%, rgba(255,255,255,0.08) 100%)`,
                }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">
              Division
            </span>
            <div
              className={cn(
                "flex min-h-[68px] items-center gap-3 rounded-xl border border-white/10 bg-black/15 px-3 py-2.5",
                !entry.is_active && "text-white/45",
              )}
              title={divisionName ?? undefined}
            >
              {divisionNumber != null ? (
                <>
                  <PlayerDivisionIcon division={divisionNumber} width={32} height={32} />
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">Current</div>
                    <div className="truncate text-sm font-medium text-white/85">
                      {divisionName ?? `Division ${divisionNumber}`}
                    </div>
                  </div>
                </>
              ) : (
                <span className="text-sm text-white/45">No division yet</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type HistoryPreviewCardProps = {
  entry: PlayerRankHistoryPreviewEntry;
  currentEntry: BalancerPlayerRoleEntry | undefined;
  getDivisionName: (divisionNumber: number | null) => string | null;
};

function HistoryPreviewCard({
  entry,
  currentEntry,
  getDivisionName,
}: HistoryPreviewCardProps) {
  const accent = ROLE_ACCENTS[entry.role];
  const divisionName =
    getDivisionName(entry.division_number) ??
    (entry.division_number != null ? `Division ${entry.division_number}` : null);
  const changeText = buildHistoryChangeText(currentEntry, entry);

  return (
    <div
      className={cn(
        "grid gap-3 rounded-2xl border p-3 sm:grid-cols-[minmax(0,1fr)_auto]",
        "border-white/10 bg-white/[0.03]",
        accent.row,
      )}
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <PlayerRoleIcon role={ROLE_DISPLAY[entry.role]} size={18} />
            <span className={cn("text-sm font-semibold", accent.text)}>{ROLE_DISPLAY[entry.role]}</span>
          </div>
          <Badge className={cn("border", accent.chip)}>{entry.rank_value} SR</Badge>
          {divisionName ? (
            <div className="flex items-center gap-2 rounded-full border border-white/12 bg-black/15 px-2.5 py-1 text-white/80">
              {entry.division_number != null ? (
                <PlayerDivisionIcon division={entry.division_number} width={18} height={18} />
              ) : null}
              <span className="text-xs font-medium">{divisionName}</span>
            </div>
          ) : null}
        </div>
        <p className="text-xs leading-relaxed text-white/65">{changeText}</p>
      </div>
      <div className="space-y-1 text-xs text-white/55 sm:text-right">
        <div className="font-medium text-white/80">{formatTournamentSource(entry)}</div>
        <div>Source role: {entry.source_role}</div>
      </div>
    </div>
  );
}

type PlayerEditModalProps = {
  player: BalancerPlayerRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (
    playerId: number,
    payload: {
      role_entries_json: BalancerPlayerRoleEntry[];
      is_in_pool: boolean;
      is_flex: boolean;
      admin_notes: string | null;
    },
  ) => void;
  onRemove?: (playerId: number) => void;
  saving?: boolean;
  rankHistory?: Partial<Record<BalancerRoleCode, number>> | null;
};

export function PlayerEditModal({
  player,
  open,
  onOpenChange,
  onSave,
  onRemove,
  saving = false,
  rankHistory = null,
}: PlayerEditModalProps) {
  const divisionGrid = useDivisionGrid();
  const divisionNameByNumber = useMemo(
    () => new Map(divisionGrid.tiers.map((tier) => [tier.number, tier.name])),
    [divisionGrid],
  );
  const resolveDivision = (rankValue: number | null) =>
    resolveDivisionFromRankHelper(rankValue, divisionGrid);
  const resolveRankFromDivision = (divisionNumber: number | null) =>
    resolveRankFromDivisionHelper(divisionNumber, divisionGrid);
  const getDivisionName = (divisionNumber: number | null) =>
    divisionNumber == null ? null : (divisionNameByNumber.get(divisionNumber) ?? `Division ${divisionNumber}`);
  const sliderBounds = useMemo(() => getDivisionGridBounds(divisionGrid), [divisionGrid]);
  const divisionTiers = useMemo(() => getSliderDivisionTiers(divisionGrid), [divisionGrid]);

  const [roleEntries, setRoleEntries] = useState<BalancerPlayerRoleEntry[]>(
    normalizeRoleEntries(player.role_entries_json),
  );
  const [isInPool, setIsInPool] = useState(player.is_in_pool);
  const [isFlex, setIsFlex] = useState(player.is_flex);
  const [notes, setNotes] = useState(player.admin_notes ?? "");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyPreview, setHistoryPreview] = useState<PlayerRankHistoryPreview | null>(null);
  const [historyPreviewRequested, setHistoryPreviewRequested] = useState(false);
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null);

  useEffect(() => {
    const normalized = normalizeRoleEntries(player.role_entries_json);
    setIsInPool(player.is_in_pool);
    setIsFlex(player.is_flex);
    setNotes(player.admin_notes ?? "");
    setHistoryPreview(null);
    setHistoryPreviewRequested(false);
    setHistoryLoadError(null);
    setRoleEntries(applyHistoryToSelectedRoles(normalized, rankHistory, resolveDivision));
  }, [player, rankHistory, divisionGrid]);

  const averageRankValue = useMemo(() => getAverageRankValue(roleEntries), [roleEntries]);
  const historyPreviewEntries = historyPreview?.entries ?? [];
  const historyPreviewAverage = historyPreview?.average_rank_value ?? null;
  const hasHistoryPreview = historyPreviewEntries.length > 0;

  const handleLoadFromHistory = async () => {
    setLoadingHistory(true);
    setHistoryPreviewRequested(true);
    setHistoryLoadError(null);

    try {
      const preview = await fetchPlayerRankHistoryPreview(player.battle_tag, divisionGrid);
      setHistoryPreview(preview);
    } catch (error) {
      setHistoryPreview(null);
      setHistoryLoadError(
        error instanceof Error ? error.message : "Failed to load player history.",
      );
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleDismissHistoryPreview = () => {
    setHistoryPreviewRequested(false);
    setHistoryPreview(null);
    setHistoryLoadError(null);
  };

  const handleApplyHistoryPreview = () => {
    setRoleEntries((current) =>
      applyHistoryPreviewToRoleEntries(current, historyPreview, resolveDivision),
    );
    handleDismissHistoryPreview();
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const sortableIds = roleEntries.map(
    (entry, index) => `${entry.role}-${index}`,
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sortableIds.indexOf(active.id as string);
    const newIndex = sortableIds.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;

    setRoleEntries((current) => {
      const moved = arrayMove(current, oldIndex, newIndex);
      return moved.map((entry, i) => ({ ...entry, priority: i + 1 }));
    });
  };

  const addRole = () => {
    const availableRole = ROLE_OPTIONS.find(
      (option) => !roleEntries.some((entry) => entry.role === option.value),
    );
    if (!availableRole) return;

    setRoleEntries((current) => [
      ...current,
        {
          role: availableRole.value,
          subtype: null,
          priority: current.length + 1,
          division_number: null,
          rank_value: null,
          is_active: true,
        },
      ]);
  };

  const updateEntry = (index: number, nextEntry: BalancerPlayerRoleEntry) => {
    setRoleEntries((current) =>
      normalizeRoleEntries(
        current.map((entry, currentIndex) =>
          currentIndex === index ? nextEntry : entry,
        ),
      ),
    );
  };

  const removeEntry = (index: number) => {
    setRoleEntries((current) =>
      normalizeRoleEntries(
        current.filter((_, currentIndex) => currentIndex !== index),
      ),
    );
  };

  const handleSave = () => {
    onSave(player.id, {
      role_entries_json: normalizeRoleEntries(roleEntries),
      is_in_pool: isInPool,
      is_flex: isFlex,
      admin_notes: notes || null,
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-hidden border-white/10 bg-[#12111d]/95 p-0 text-white shadow-2xl shadow-black/50 backdrop-blur-xl sm:max-w-[960px] [&>button:last-child]:right-5 [&>button:last-child]:top-5 [&>button:last-child]:z-20 [&>button:last-child]:flex [&>button:last-child]:h-9 [&>button:last-child]:w-9 [&>button:last-child]:items-center [&>button:last-child]:justify-center [&>button:last-child]:rounded-xl [&>button:last-child]:border [&>button:last-child]:border-white/10 [&>button:last-child]:bg-black/30 [&>button:last-child]:p-0 [&>button:last-child]:text-white/60 [&>button:last-child]:backdrop-blur-sm [&>button:last-child]:hover:bg-white/8 [&>button:last-child]:hover:text-white [&>button:last-child]:data-[state=open]:bg-black/30 [&>button:last-child]:data-[state=open]:text-white/60"
      >
        

        <SheetHeader
          className={cn(
            "border-b border-white/8 px-5 pb-4 pt-5 sm:px-6 sm:pb-5 sm:pt-6",
            onRemove ? "pr-32 sm:pr-36" : "pr-20 sm:pr-24",
          )}
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle className="text-3xl font-semibold tracking-tight text-white">
                  {player.battle_tag}
                </SheetTitle>
                {isFlex ? (
                  <Badge className="border-emerald-400/25 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/10">
                    Flex
                  </Badge>
                ) : null}
              </div>
              <SheetDescription className="max-w-2xl text-sm text-white/55">
                Roles, ratings, and balancer participation. Preview history before applying it to this registration.
              </SheetDescription>
            </div>

          
          </div>
        </SheetHeader>

        <div className="space-y-5 px-5 py-5 sm:px-6">
          <div className="grid gap-3 lg:grid-cols-2">
            <div
              className={cn(
                "rounded-2xl border p-4",
                isInPool
                  ? "border-violet-400/20 bg-violet-500/[0.08]"
                  : "border-white/10 bg-white/[0.03]",
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="is-in-pool" className="cursor-pointer text-sm font-medium text-white">
                  Include in balancer
                  </Label>
                  <p className="text-xs leading-relaxed text-white/55">
                    Keep this registration available when the Balancing Pool is used for roster generation.
                  </p>
                </div>
                <Switch
                  id="is-in-pool"
                  checked={isInPool}
                  onCheckedChange={setIsInPool}
                  aria-label="Include in balancer"
                />
              </div>
            </div>

            <div
              className={cn(
                "rounded-2xl border p-4",
                isFlex
                  ? "border-emerald-400/20 bg-emerald-500/[0.08]"
                  : "border-white/10 bg-white/[0.03]",
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="is-flex" className="cursor-pointer text-sm font-medium text-white">
                  Flex player
                  </Label>
                  <p className="text-xs leading-relaxed text-white/55">
                    Mark this player as comfortable switching roles when the final roster needs flexibility.
                  </p>
                </div>
                <Switch
                  id="is-flex"
                  checked={isFlex}
                  onCheckedChange={setIsFlex}
                  aria-label="Flex player"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3.5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <Label className="text-sm font-medium text-white">Roles</Label>
                <p className="text-xs text-white/45">
                  Drag rows to change priority. Disabled roles stay on the profile but are excluded from balancing.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-white/12 bg-black/20 text-white/85 hover:bg-white/5 hover:text-white"
                  onClick={addRole}
                  disabled={roleEntries.length >= ROLE_OPTIONS.length}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add role
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-white/12 bg-black/20 text-white/85 hover:bg-white/5 hover:text-white"
                  onClick={handleLoadFromHistory}
                  disabled={loadingHistory}
                >
                  {loadingHistory ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <History className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Load from history
                </Button>
              </div>
            </div>

            {historyPreviewRequested ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">History preview</span>
                      {historyPreviewAverage != null ? (
                        <Badge className="border-violet-400/20 bg-violet-400/10 text-violet-200 hover:bg-violet-400/10">
                          Avg {historyPreviewAverage}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-xs leading-relaxed text-white/55">
                      Review the latest tournament SR values before applying them. Nothing changes until you confirm.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 self-start">
                    {hasHistoryPreview ? (
                      <Button
                        type="button"
                        size="sm"
                        className="bg-violet-500/90 text-white hover:bg-violet-400"
                        onClick={handleApplyHistoryPreview}
                      >
                        Apply history values
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 rounded-xl border border-white/10 bg-black/15 text-white/55 hover:bg-white/5 hover:text-white"
                      onClick={handleDismissHistoryPreview}
                      aria-label="Close history preview"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {historyLoadError ? (
                    <div className="rounded-2xl border border-rose-400/20 bg-rose-500/[0.08] px-4 py-3 text-sm text-rose-100">
                      {historyLoadError}
                    </div>
                  ) : null}

                  {!historyLoadError && !loadingHistory && !hasHistoryPreview ? (
                    <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/55">
                      No ranked tournament history was found for this BattleTag.
                    </div>
                  ) : null}

                  {historyPreviewEntries.map((entry) => (
                    <HistoryPreviewCard
                      key={`${entry.role}-${entry.tournament_id}`}
                      entry={entry}
                      currentEntry={roleEntries.find((roleEntry) => roleEntry.role === entry.role)}
                      getDivisionName={getDivisionName}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sortableIds}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2.5">
                  {roleEntries.map((entry, index) => (
                    <SortableRoleEntry
                      key={sortableIds[index]}
                      id={sortableIds[index]}
                      entry={entry}
                      index={index}
                      resolveDivision={resolveDivision}
                      resolveRankFromDivision={resolveRankFromDivision}
                      getDivisionName={getDivisionName}
                      divisionTiers={divisionTiers}
                      sliderBounds={sliderBounds}
                      onUpdate={updateEntry}
                      onRemove={removeEntry}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-white">Admin notes</Label>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="min-h-24 border-white/10 bg-black/20 text-white placeholder:text-white/25"
              placeholder="Notes about availability, role comfort, or balancing caveats."
            />
          </div>
        </div>

        <SheetFooter className="border-t border-white/8 px-5 py-4 sm:justify-between sm:space-x-0 sm:px-6">
          <div className="text-xs text-white/35">
            Manual edits always win until you explicitly load and apply new history values.
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="border-white/12 bg-black/20 text-white/80 hover:bg-white/5 hover:text-white"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-violet-500 text-white hover:bg-violet-400"
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              Save
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
