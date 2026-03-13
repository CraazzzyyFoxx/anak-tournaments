"use client";

import { useEffect, useState } from "react";
import { GripVertical, History, Loader2, MoreHorizontal, Plus, Save, Trash2 } from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { cn } from "@/lib/utils";
import {
  BalancerPlayerRecord,
  BalancerPlayerRoleEntry,
  BalancerRoleCode,
  BalancerRoleSubtype,
} from "@/types/balancer-admin.types";
import {
  fetchPlayerRankHistory,
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

const DIVISION_THRESHOLDS: Array<{ division: number; minRank: number }> = [
  { division: 1, minRank: 2000 },
  { division: 2, minRank: 1900 },
  { division: 3, minRank: 1800 },
  { division: 4, minRank: 1700 },
  { division: 5, minRank: 1600 },
  { division: 6, minRank: 1500 },
  { division: 7, minRank: 1400 },
  { division: 8, minRank: 1300 },
  { division: 9, minRank: 1200 },
  { division: 10, minRank: 1100 },
  { division: 11, minRank: 1000 },
  { division: 12, minRank: 900 },
  { division: 13, minRank: 800 },
  { division: 14, minRank: 700 },
  { division: 15, minRank: 600 },
  { division: 16, minRank: 500 },
  { division: 17, minRank: 400 },
  { division: 18, minRank: 300 },
  { division: 19, minRank: 200 },
  { division: 20, minRank: 0 },
];

function resolveDivisionFromRank(rankValue: number | null): number | null {
  if (rankValue == null) return null;
  for (const { division, minRank } of DIVISION_THRESHOLDS) {
    if (rankValue >= minRank) return division;
  }
  return 20;
}

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
      division_number:
        entry.division_number ?? resolveDivisionFromRank(entry.rank_value),
      rank_value: entry.rank_value,
      is_active: entry.is_active ?? true,
    });
  }

  return normalized;
}

function applyHistoryToSelectedRoles(
  entries: BalancerPlayerRoleEntry[],
  history: Partial<Record<BalancerRoleCode, number>> | null,
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
        division_number: resolveDivisionFromRank(rankValue),
      };
    }),
  );
}

type SortableRoleEntryProps = {
  id: string;
  entry: BalancerPlayerRoleEntry;
  index: number;
  roleEntries: BalancerPlayerRoleEntry[];
  onUpdate: (index: number, next: BalancerPlayerRoleEntry) => void;
  onRemove: (index: number) => void;
};

function SortableRoleEntry({
  id,
  entry,
  index,
  roleEntries,
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
    boxShadow: isDragging
      ? "0 4px 12px rgba(0,0,0,0.3)"
      : undefined,
  };

  const availableRoles = ROLE_OPTIONS.filter(
    (option) =>
      option.value === entry.role ||
      !roleEntries.some(
        (candidate, candidateIndex) =>
          candidate.role === option.value && candidateIndex !== index,
      ),
  );

  const divisionNumber = resolveDivisionFromRank(entry.rank_value);
  const hasSubtypeOptions = SUBTYPE_OPTIONS[entry.role].length > 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "grid grid-cols-[18px_24px_minmax(0,1fr)_32px] gap-3 rounded-xl border bg-background p-3 transition-colors sm:grid-cols-[18px_24px_72px_minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,132px)_36px_32px] sm:items-center",
        entry.is_active
          ? "border-border bg-background"
          : "border-amber-500/35 bg-amber-500/10 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.12)]",
      )}
    >
      <button
        type="button"
        className="flex h-8 shrink-0 cursor-grab touch-none items-center justify-center self-start text-muted-foreground hover:text-foreground active:cursor-grabbing sm:h-auto sm:self-center"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div
        className={cn(
          "flex h-8 items-center justify-center rounded-md border border-dashed bg-muted/20 transition-colors",
          entry.is_active ? "border-muted-foreground/30" : "border-amber-400/35 bg-amber-500/10",
        )}
      >
        <PlayerRoleIcon role={ROLE_DISPLAY[entry.role]} size={20} />
      </div>

      <div className="col-start-2 col-span-2 flex items-center gap-2 sm:col-span-1 sm:col-start-auto sm:justify-center">
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
            "text-[11px] font-semibold uppercase tracking-[0.14em]",
            entry.is_active ? "text-muted-foreground" : "text-amber-300",
          )}
        >
          {entry.is_active ? "On" : "Off"}
        </span>
      </div>

      <Select
        value={entry.role}
        onValueChange={(value) =>
          onUpdate(index, { ...entry, role: value as BalancerRoleCode, subtype: null })
        }
      >
        <SelectTrigger
          className={cn(
            "h-8 w-full min-w-0",
            !entry.is_active && "border-amber-500/30 bg-amber-500/5",
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {availableRoles.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="col-start-2 col-span-2 sm:col-span-1 sm:col-start-auto">
        <Select
          value={entry.subtype ?? undefined}
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
              "h-8 w-full min-w-0",
              !entry.is_active && "border-amber-500/30 bg-amber-500/5",
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

      <div
        className={cn(
          "col-start-2 col-span-2 flex min-w-0 items-center overflow-hidden rounded-md border border-input bg-background shadow-sm sm:col-span-1 sm:col-start-auto",
          !entry.is_active && "border-amber-500/30 bg-amber-500/5",
        )}
      >
        <span
          className={cn(
            "flex h-8 items-center border-r border-input bg-muted/50 px-2 text-xs font-medium text-muted-foreground",
            !entry.is_active && "border-amber-500/20 bg-amber-500/10 text-amber-200",
          )}
        >
          SR
        </span>
        <Input
          type="number"
          min={0}
          max={5000}
          className={cn(
            "h-8 border-0 px-3 shadow-none focus-visible:ring-0",
            !entry.is_active && "bg-transparent text-foreground/90",
          )}
          value={entry.rank_value ?? ""}
          onChange={(event) => {
            const rankValue = event.target.value
              ? Number(event.target.value)
              : null;
            onUpdate(index, {
              ...entry,
              rank_value: rankValue,
              division_number: resolveDivisionFromRank(rankValue),
            });
          }}
        />
      </div>

      <div
        className={cn(
          "col-start-4 row-start-1 flex h-8 shrink-0 items-center justify-center self-start rounded-md sm:col-start-auto sm:row-start-auto sm:self-center",
          !entry.is_active && "bg-amber-500/10",
        )}
        title={divisionNumber != null ? `Division ${divisionNumber}` : undefined}
      >
        {divisionNumber != null ? (
          <>
            <PlayerDivisionIcon division={divisionNumber} width={28} height={28} />
            <span className="sr-only">Division {divisionNumber}</span>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>

      <div className="col-start-4 row-start-2 flex items-center self-center sm:col-start-auto sm:row-start-auto">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => onRemove(index)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
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
  const [roleEntries, setRoleEntries] = useState<BalancerPlayerRoleEntry[]>(
    normalizeRoleEntries(player.role_entries_json),
  );
  const [isInPool, setIsInPool] = useState(player.is_in_pool);
  const [isFlex, setIsFlex] = useState(player.is_flex);
  const [notes, setNotes] = useState(player.admin_notes ?? "");
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    const normalized = normalizeRoleEntries(player.role_entries_json);
    setIsInPool(player.is_in_pool);
    setIsFlex(player.is_flex);
    setNotes(player.admin_notes ?? "");

    setRoleEntries(applyHistoryToSelectedRoles(normalized, rankHistory));
  }, [player, rankHistory]);

  const handleLoadFromHistory = async () => {
    setLoadingHistory(true);
    try {
      const history = await fetchPlayerRankHistory(player.battle_tag);
      if (history && Object.keys(history).length > 0) {
        setRoleEntries((current) => applyHistoryToSelectedRoles(current, history));
      }
    } finally {
      setLoadingHistory(false);
    }
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        {onRemove ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-14 top-4 h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Player actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onRemove(player.id)}
              >
                <Trash2 className="h-4 w-4" />
                Delete player
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {player.battle_tag}
            {isFlex && (
              <Badge className="text-xs">Flex</Badge>
            )}
          </DialogTitle>
          <DialogDescription>Edit player roles, ranks, and pool status.</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 px-1 sm:px-0">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-start justify-between rounded-xl border bg-muted/20 p-4">
              <div className="space-y-1 pr-4">
                <Label htmlFor="is-in-pool" className="cursor-pointer text-sm font-medium">
                  Include in balancing pool
                </Label>
                <p className="text-xs text-muted-foreground">
                  Keep this player available for roster generation.
                </p>
              </div>
              <Switch
                id="is-in-pool"
                checked={isInPool}
                onCheckedChange={setIsInPool}
                aria-label="Include in balancing pool"
              />
            </div>

            <div className="flex items-start justify-between rounded-xl border bg-muted/20 p-4">
              <div className="space-y-1 pr-4">
                <Label htmlFor="is-flex" className="cursor-pointer text-sm font-medium">
                  Flex player
                </Label>
                <p className="text-xs text-muted-foreground">
                  Mark this player as comfortable switching roles.
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

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-sm font-medium">Roles</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
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

            <div className="hidden rounded-lg border border-dashed border-muted-foreground/20 bg-muted/10 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[18px_24px_72px_minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,132px)_36px_32px] sm:items-center sm:gap-3">
              <span />
              <span />
              <span className="text-center">State</span>
              <span>Role</span>
              <span>Sub-role</span>
              <span>Skill rating</span>
              <span className="text-center">Div</span>
              <span />
            </div>

            <p className="text-xs text-muted-foreground">Use the On/Off toggle to disable a role without deleting it. Export and import keep this state via `isActive`.</p>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sortableIds}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {roleEntries.map((entry, index) => (
                    <SortableRoleEntry
                      key={sortableIds[index]}
                      id={sortableIds[index]}
                      entry={entry}
                      index={index}
                      roleEntries={roleEntries}
                      onUpdate={updateEntry}
                      onRemove={removeEntry}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Admin notes</Label>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="min-h-16"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="mr-1.5 h-3.5 w-3.5" />
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
