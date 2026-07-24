"use client";

import { memo, useCallback, useMemo, useRef, useState } from "react";
import { DivisionGridMappingEditor } from "./MappingEditor";
import { OwRankRangePicker } from "./OwRankRangePicker";
import { DivisionGridImportWizard } from "./ImportWizard";
import { DivisionGridLibrary } from "./GridLibrary";
import { MappingReadinessMatrix } from "./MappingReadinessMatrix";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyPlus, Minus, Plus, Save, Star, Trash2, Upload, Wand2, X } from "lucide-react";
import Image from "next/image";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { notify } from "@/lib/notify";
import { usePermissions } from "@/hooks/usePermissions";
import { OW2_RANK_OPTIONS } from "@/lib/ow-rank-mapping";
import workspaceService from "@/services/workspace.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { DivisionGridVersion, DivisionTier } from "@/types/workspace.types";

function buildDefaultTiers(): DivisionTier[] {
  const divisions = [
    "champion",
    "grandmaster",
    "master",
    "diamond",
    "platinum",
    "gold",
    "silver",
    "bronze"
  ];
  const bases: Record<string, number> = {
    bronze: 1000,
    silver: 1500,
    gold: 2000,
    platinum: 2500,
    diamond: 3000,
    master: 3500,
    grandmaster: 4000,
    champion: 4500
  };

  const tiers: DivisionTier[] = [];
  let sort_order = 0;
  let number = 1;

  for (const div of divisions) {
    const base = bases[div];
    for (let tier_num = 1; tier_num <= 5; tier_num++) {
      const slug = `${div}-${tier_num}`;
      const name = `${div.charAt(0).toUpperCase() + div.slice(1)} ${tier_num}`;
      const offset = (5 - tier_num) * 100;
      const rank_min = base + offset;
      const rank_max = div === "champion" && tier_num === 1 ? null : rank_min + 99;
      const icon_url = `https://minio.craazzzyyfoxx.me/aqt/assets/divisions/${slug}.png`;

      tiers.push({
        slug,
        number,
        name,
        sort_order,
        rank_min,
        rank_max,
        icon_url
      });
      sort_order++;
      number++;
    }
  }

  return tiers.sort((a, b) => a.number - b.number);
}

function emptyTier(number: number, index: number): DivisionTier {
  return {
    slug: `division-${number}`,
    number,
    name: `Division ${number}`,
    sort_order: index,
    rank_min: 1000,
    rank_max: 1099,
    icon_url: `https://minio.craazzzyyfoxx.me/aqt/assets/divisions/bronze-5.png`,
    ow_rank_min: null,
    ow_rank_max: null
  };
}

function hasCriticalChanges(original: DivisionTier[], current: DivisionTier[]): boolean {
  if (original.length !== current.length) return true;
  const origSorted = [...original].sort((a, b) => a.number - b.number);
  const currSorted = [...current].sort((a, b) => a.number - b.number);
  return origSorted.some((orig, i) => {
    const curr = currSorted[i];
    return orig.rank_min !== curr.rank_min || orig.rank_max !== curr.rank_max;
  });
}

function buildEditorState(selectedVersion: DivisionGridVersion | null): {
  label: string;
  tiers: DivisionTier[];
} {
  if (!selectedVersion) {
    return {
      label: "Draft",
      tiers: buildDefaultTiers()
    };
  }

  return {
    label: selectedVersion.label,
    tiers: [...selectedVersion.tiers]
      .sort((a, b) => a.number - b.number)
      .map((tier, index) => ({ ...tier, sort_order: tier.sort_order ?? index }))
  };
}

type DivisionGridEditorCardProps = {
  workspaceId: number;
  gridId: number;
  canEdit: boolean;
  selectedVersion: DivisionGridVersion | null;
  onSaved: () => Promise<void>;
};

// Navigable column indices: 0=#, 1=name, 2=rank_min, 3=rank_max (OW range uses a popover, no nav)
const NAV_COLS = 4;
const DEFAULT_RANK_STEP = 100;

function toSafeInteger(value: number, fallback = 0) {
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function parseIntegerInput(value: string, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampRank(value: number) {
  return Math.max(0, toSafeInteger(value));
}

function shiftTierRankRange(tier: DivisionTier, delta: number): DivisionTier {
  return {
    ...tier,
    rank_min: clampRank(tier.rank_min + delta),
    rank_max: tier.rank_max === null ? null : clampRank(tier.rank_max + delta)
  };
}

function getSelectedIndexes(selectedRows: Set<number>, length: number) {
  return Array.from(selectedRows)
    .filter((index) => index >= 0 && index < length)
    .sort((a, b) => a - b);
}

type TierEditorRowProps = {
  tier: DivisionTier;
  rowIndex: number;
  canEdit: boolean;
  isSelected: boolean;
  onDelete: (index: number) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => void;
  onSelect: (index: number, checked: boolean) => void;
  onSetInputRef: (row: number, col: number, element: HTMLInputElement | null) => void;
  onUpdate: (index: number, field: keyof DivisionTier, value: string | number | null) => void;
  onUpdateOwRange: (index: number, min: number | null, max: number | null) => void;
  onUpload: (index: number, tier: DivisionTier, file: File) => void;
};

const TierEditorRow = memo(function TierEditorRow({
  tier,
  rowIndex,
  canEdit,
  isSelected,
  onDelete,
  onKeyDown,
  onSelect,
  onSetInputRef,
  onUpdate,
  onUpdateOwRange,
  onUpload
}: TierEditorRowProps) {
  const setInputRef = useCallback(
    (col: number) => (element: HTMLInputElement | null) => onSetInputRef(rowIndex, col, element),
    [onSetInputRef, rowIndex]
  );

  return (
    <div className="grid min-w-[900px] grid-cols-[40px_56px_48px_180px_220px_1fr_40px_36px] gap-2 border-b px-4 py-1.5 last:border-b-0">
      <div className="flex items-center justify-center">
        <Checkbox
          checked={isSelected}
          onCheckedChange={(checked) => onSelect(rowIndex, checked === true)}
          aria-label={`Select ${tier.name}`}
          disabled={!canEdit}
        />
      </div>
      <Input
        ref={setInputRef(0)}
        inputMode="numeric"
        className="h-8 text-center tabular-nums"
        value={tier.number}
        onChange={(event) => onUpdate(rowIndex, "number", parseIntegerInput(event.target.value))}
        onKeyDown={(event) => onKeyDown(event, rowIndex, 0)}
        disabled={!canEdit}
      />
      <div className="flex items-center justify-center">
        <Image
          src={tier.icon_url}
          alt={tier.name}
          width={28}
          height={28}
          className="h-7 w-7 object-contain"
        />
      </div>
      <Input
        ref={setInputRef(1)}
        className="h-8"
        value={tier.name}
        onChange={(event) => onUpdate(rowIndex, "name", event.target.value)}
        onKeyDown={(event) => onKeyDown(event, rowIndex, 1)}
        disabled={!canEdit}
      />
      <div className="flex items-center gap-1.5">
        <Input
          ref={setInputRef(2)}
          inputMode="numeric"
          className="h-8 w-24 tabular-nums"
          value={tier.rank_min}
          onChange={(event) =>
            onUpdate(rowIndex, "rank_min", parseIntegerInput(event.target.value))
          }
          onKeyDown={(event) => onKeyDown(event, rowIndex, 2)}
          disabled={!canEdit}
        />
        <span className="shrink-0 text-xs text-muted-foreground">-</span>
        <Input
          ref={setInputRef(3)}
          inputMode="numeric"
          className="h-8 w-24 tabular-nums"
          placeholder="max"
          value={tier.rank_max ?? ""}
          onChange={(event) =>
            onUpdate(
              rowIndex,
              "rank_max",
              event.target.value === "" ? null : parseIntegerInput(event.target.value)
            )
          }
          onKeyDown={(event) => onKeyDown(event, rowIndex, 3)}
          disabled={!canEdit}
        />
      </div>
      <div className="flex items-center">
        <OwRankRangePicker
          min={tier.ow_rank_min ?? null}
          max={tier.ow_rank_max ?? null}
          disabled={!canEdit}
          onChange={(min, max) => onUpdateOwRange(rowIndex, min, max)}
        />
      </div>
      <label className="inline-flex cursor-pointer items-center justify-center">
        <input
          type="file"
          className="hidden"
          accept="image/png,image/webp,image/jpeg,image/gif"
          disabled={!canEdit}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onUpload(rowIndex, tier, file);
            event.currentTarget.value = "";
          }}
        />
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border hover:bg-muted">
          <Upload className="h-3.5 w-3.5" />
        </span>
      </label>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        onClick={() => onDelete(rowIndex)}
        disabled={!canEdit}
        aria-label={`Delete ${tier.name}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
});

function DivisionGridEditorCard({
  workspaceId,
  gridId,
  canEdit,
  selectedVersion,
  onSaved
}: DivisionGridEditorCardProps) {
  const initialState = useMemo(() => buildEditorState(selectedVersion), [selectedVersion]);
  const [label, setLabel] = useState(initialState.label);
  const [tiers, setTiers] = useState<DivisionTier[]>(initialState.tiers);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(() => new Set());
  const [rankDelta, setRankDelta] = useState(DEFAULT_RANK_STEP);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeStep, setRangeStep] = useState(DEFAULT_RANK_STEP);
  const [tiersToAdd, setTiersToAdd] = useState(1);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // Keyboard navigation refs: key = `${row}-${col}`
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const setInputRef = useCallback((row: number, col: number, el: HTMLInputElement | null) => {
    const key = `${row}-${col}`;
    if (el) inputRefs.current.set(key, el);
    else inputRefs.current.delete(key);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
      const input = e.currentTarget;
      const focus = (r: number, c: number) => {
        const target = inputRefs.current.get(`${r}-${c}`);
        if (target) {
          e.preventDefault();
          target.focus();
          target.select();
        }
      };
      switch (e.key) {
        case "ArrowDown":
        case "Enter":
          focus(row + 1, col);
          break;
        case "ArrowUp":
          focus(row - 1, col);
          break;
        case "ArrowLeft":
          if (input.selectionStart === 0 && col > 0) focus(row, col - 1);
          break;
        case "ArrowRight":
          if (input.selectionStart === input.value.length && col < NAV_COLS - 1)
            focus(row, col + 1);
          break;
      }
    },
    []
  );

  const tiersPayload = useMemo(
    () =>
      tiers.map((tier, index) => ({
        id: tier.id,
        slug: tier.slug || `division-${tier.number}`,
        number: tier.number,
        name: tier.name,
        sort_order: index,
        rank_min: tier.rank_min,
        rank_max: tier.rank_max,
        icon_url: tier.icon_url,
        ow_rank_min: tier.ow_rank_min ?? null,
        ow_rank_max: tier.ow_rank_max ?? null
      })),
    [tiers]
  );

  const saveVersionMutation = useMutation({
    mutationFn: async (mode: "edit" | "new") => {
      if (mode === "edit" && selectedVersion) {
        return workspaceService.updateDivisionGridVersion(selectedVersion.id, {
          label,
          tiers: tiersPayload
        });
      }
      return workspaceService.createDivisionGridVersion(workspaceId, gridId, {
        label,
        tiers: tiersPayload
      });
    },
    onSuccess: async (_, mode) => {
      await onSaved();
      notify.success(mode === "edit" ? "Version saved" : "New draft created");
    }
  });

  const handleSave = useCallback(() => {
    if (!selectedVersion) {
      saveVersionMutation.mutate("new");
      return;
    }
    if (hasCriticalChanges(selectedVersion.tiers, tiers)) {
      setShowSaveDialog(true);
    } else {
      saveVersionMutation.mutate("edit");
    }
  }, [selectedVersion, tiers, saveVersionMutation]);

  const updateTier = useCallback(
    (index: number, field: keyof DivisionTier, value: string | number | null) => {
      setTiers((current) =>
        current.map((tier, tierIndex) => (tierIndex === index ? { ...tier, [field]: value } : tier))
      );
    },
    []
  );

  const updateTierOwRange = useCallback((index: number, min: number | null, max: number | null) => {
    setTiers((current) =>
      current.map((tier, tierIndex) =>
        tierIndex === index ? { ...tier, ow_rank_min: min, ow_rank_max: max } : tier
      )
    );
  }, []);

  const selectedRowIndexes = useMemo(
    () => getSelectedIndexes(selectedRows, tiers.length),
    [selectedRows, tiers.length]
  );

  const bulkTargetIndexes = useMemo(
    () =>
      selectedRowIndexes.length > 0
        ? selectedRowIndexes
        : Array.from({ length: tiers.length }, (_, index) => index),
    [selectedRowIndexes, tiers.length]
  );

  const bulkTargetLabel =
    selectedRowIndexes.length > 0
      ? `${selectedRowIndexes.length} selected`
      : `all ${tiers.length} tiers`;
  const allRowsSelected = tiers.length > 0 && selectedRowIndexes.length === tiers.length;
  const someRowsSelected = selectedRowIndexes.length > 0 && !allRowsSelected;

  const toggleRowSelection = useCallback((index: number, checked: boolean) => {
    setSelectedRows((current) => {
      const next = new Set(current);
      if (checked) next.add(index);
      else next.delete(index);
      return next;
    });
  }, []);

  const toggleAllRows = useCallback(
    (checked: boolean) => {
      setSelectedRows(
        checked ? new Set(Array.from({ length: tiers.length }, (_, index) => index)) : new Set()
      );
    },
    [tiers.length]
  );

  const shiftBulkRanks = useCallback(
    (direction: 1 | -1) => {
      const delta = Math.abs(toSafeInteger(rankDelta, DEFAULT_RANK_STEP)) * direction;
      const targetSet = new Set(bulkTargetIndexes);
      setTiers((current) =>
        current.map((tier, index) =>
          targetSet.has(index) ? shiftTierRankRange(tier, delta) : tier
        )
      );
    },
    [bulkTargetIndexes, rankDelta]
  );

  const autoFillBulkRanges = useCallback(() => {
    const start = clampRank(rangeStart);
    const step = Math.max(1, Math.abs(toSafeInteger(rangeStep, DEFAULT_RANK_STEP)));
    const targetSet = new Set(bulkTargetIndexes);

    setTiers((current) => {
      const orderedIndexes = bulkTargetIndexes
        .slice()
        .sort((a, b) => current[b].number - current[a].number || b - a);
      const orderByIndex = new Map(orderedIndexes.map((index, order) => [index, order]));

      return current.map((tier, index) => {
        if (!targetSet.has(index)) return tier;

        const order = orderByIndex.get(index) ?? 0;
        const min = start + order * step;
        const shouldStayOpenEnded = tier.rank_max === null;

        return {
          ...tier,
          rank_min: min,
          rank_max: shouldStayOpenEnded ? null : min + step - 1
        };
      });
    });
  }, [bulkTargetIndexes, rangeStart, rangeStep]);

  const autoMapOwRanges = useCallback(() => {
    const targetSet = new Set(bulkTargetIndexes);

    setTiers((current) => {
      // Top tier (lowest number) first, matching OW2_RANK_OPTIONS' highest → lowest order.
      const orderedIndexes = bulkTargetIndexes
        .slice()
        .sort((a, b) => current[a].number - current[b].number || a - b);
      const tierCount = orderedIndexes.length;
      if (tierCount === 0) return current;

      // Distribute the full OW ladder across the targeted tiers as contiguous,
      // near-even chunks: 40 tiers -> one OW rank each, 8 tiers -> one division each.
      const assignments = new Map<number, { min: number; max: number }>();
      let cursor = 0;
      for (let order = 0; order < tierCount; order++) {
        const size =
          Math.floor(OW2_RANK_OPTIONS.length / tierCount) +
          (order < OW2_RANK_OPTIONS.length % tierCount ? 1 : 0);
        if (size === 0) break; // more tiers than OW ranks: the rest stay unmapped
        const chunk = OW2_RANK_OPTIONS.slice(cursor, cursor + size);
        cursor += size;
        assignments.set(orderedIndexes[order], {
          min: chunk[chunk.length - 1].value,
          max: chunk[0].value
        });
      }

      return current.map((tier, index) => {
        const assigned = assignments.get(index);
        if (!targetSet.has(index) || !assigned) return tier;
        return { ...tier, ow_rank_min: assigned.min, ow_rank_max: assigned.max };
      });
    });
  }, [bulkTargetIndexes]);

  const clearOwRanges = useCallback(() => {
    const targetSet = new Set(bulkTargetIndexes);
    setTiers((current) =>
      current.map((tier, index) =>
        targetSet.has(index) ? { ...tier, ow_rank_min: null, ow_rank_max: null } : tier
      )
    );
  }, [bulkTargetIndexes]);

  const addTiers = useCallback(() => {
    const count = Math.max(1, Math.min(100, Math.abs(toSafeInteger(tiersToAdd, 1))));
    const step = Math.max(1, Math.abs(toSafeInteger(rangeStep, DEFAULT_RANK_STEP)));

    setTiers((current) => {
      const maxNumber = current.reduce((max, tier) => Math.max(max, tier.number), 0);
      return [
        ...current,
        ...Array.from({ length: count }, (_, offset) => {
          const number = maxNumber + offset + 1;
          return {
            ...emptyTier(number, current.length + offset),
            rank_max: step - 1
          };
        })
      ];
    });
  }, [rangeStep, tiersToAdd]);

  const removeTier = useCallback((index: number) => {
    setTiers((current) => current.filter((_, tierIndex) => tierIndex !== index));
    setSelectedRows(new Set());
  }, []);

  const removeSelectedTiers = useCallback(() => {
    setTiers((current) => current.filter((_, index) => !selectedRows.has(index)));
    setSelectedRows(new Set());
  }, [selectedRows]);

  const uploadIcon = useCallback(
    async (index: number, tier: DivisionTier, file: File) => {
      const slugBase = tier.slug || `division-${tier.number}`;
      const randomHash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
      const upload = await workspaceService.uploadDivisionIcon(
        `${slugBase}-${randomHash}`,
        file,
        workspaceId
      );
      updateTier(index, "icon_url", upload.public_url);
      notify.success("Icon uploaded");
    },
    [updateTier, workspaceId]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Version Editor</CardTitle>
        <CardDescription>
          Minor changes (name, icon, OW ranks) save in-place. Adding or removing tiers, or changing
          rank ranges, will prompt you to choose between editing the current version or creating a
          new draft.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Version label"
        />

        <div className="rounded-md border bg-muted/20 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Bulk target</div>
              <Badge variant="outline" className="h-9 px-3">
                {bulkTargetLabel}
              </Badge>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="rank-delta">
                Rank delta
              </label>
              <NumberInput
                id="rank-delta"
                integer
                min={0}
                className="h-9 w-28 tabular-nums"
                value={rankDelta}
                onValueChange={(next) => setRankDelta(next ?? 0)}
                disabled={!canEdit}
              />
            </div>
            <Button
              variant="outline"
              onClick={() => shiftBulkRanks(1)}
              disabled={!canEdit || bulkTargetIndexes.length === 0}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add
            </Button>
            <Button
              variant="outline"
              onClick={() => shiftBulkRanks(-1)}
              disabled={!canEdit || bulkTargetIndexes.length === 0}
            >
              <Minus className="mr-2 h-4 w-4" />
              Reduce
            </Button>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="range-start">
                Range start
              </label>
              <NumberInput
                id="range-start"
                integer
                min={0}
                className="h-9 w-28 tabular-nums"
                value={rangeStart}
                onValueChange={(next) => setRangeStart(next ?? 0)}
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="range-step">
                Step
              </label>
              <NumberInput
                id="range-step"
                integer
                min={1}
                className="h-9 w-24 tabular-nums"
                value={rangeStep}
                onValueChange={(next) => setRangeStep(next ?? 1)}
                disabled={!canEdit}
              />
            </div>
            <Button
              variant="outline"
              onClick={autoFillBulkRanges}
              disabled={!canEdit || bulkTargetIndexes.length === 0}
            >
              <Wand2 className="mr-2 h-4 w-4" />
              Auto ranges
            </Button>
            <Button
              variant="outline"
              onClick={autoMapOwRanges}
              disabled={!canEdit || bulkTargetIndexes.length === 0}
              title="Distribute the OW2 ladder across the targeted tiers (top tier gets the highest ranks)"
            >
              <Wand2 className="mr-2 h-4 w-4" />
              Auto OW map
            </Button>
            <Button
              variant="outline"
              onClick={clearOwRanges}
              disabled={!canEdit || bulkTargetIndexes.length === 0}
            >
              <X className="mr-2 h-4 w-4" />
              Clear OW
            </Button>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="tiers-to-add">
                Tiers
              </label>
              <NumberInput
                id="tiers-to-add"
                integer
                min={1}
                className="h-9 w-20 tabular-nums"
                value={tiersToAdd}
                onValueChange={(next) => setTiersToAdd(next ?? 1)}
                disabled={!canEdit}
              />
            </div>
            <Button variant="outline" onClick={addTiers} disabled={!canEdit}>
              <Plus className="mr-2 h-4 w-4" />
              Add tiers
            </Button>
            <Button
              variant="outline"
              onClick={removeSelectedTiers}
              disabled={!canEdit || selectedRowIndexes.length === 0}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete selected
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Without selected rows, bulk rank actions apply to every tier.
          </p>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <div className="grid min-w-[900px] grid-cols-[40px_56px_48px_180px_220px_1fr_40px_36px] gap-2 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
            <div className="flex items-center justify-center">
              <Checkbox
                checked={someRowsSelected ? "indeterminate" : allRowsSelected}
                onCheckedChange={(checked) => toggleAllRows(checked === true)}
                aria-label="Select all tiers"
                disabled={!canEdit}
              />
            </div>
            <span>#</span>
            <span>Icon</span>
            <span>Name</span>
            <span>Rank Range</span>
            <span>OW Range</span>
            <span>Upload</span>
            <span />
          </div>
          {tiers.map((tier, rowIndex) => (
            <TierEditorRow
              key={`${tier.id ?? tier.slug ?? "tier"}-${rowIndex}`}
              tier={tier}
              rowIndex={rowIndex}
              canEdit={canEdit}
              isSelected={selectedRows.has(rowIndex)}
              onDelete={removeTier}
              onKeyDown={handleKeyDown}
              onSelect={toggleRowSelection}
              onSetInputRef={setInputRef}
              onUpdate={updateTier}
              onUpdateOwRange={updateTierOwRange}
              onUpload={uploadIcon}
            />
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSave} disabled={!canEdit || saveVersionMutation.isPending}>
            <Save className="mr-2 h-4 w-4" />
            Save
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Critical changes detected</AlertDialogTitle>
            <AlertDialogDescription>
              You changed the number of tiers or their rank ranges. Would you like to edit the
              current version in-place, or save these changes as a new draft version?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowSaveDialog(false);
                saveVersionMutation.mutate("new");
              }}
            >
              Create new version
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                setShowSaveDialog(false);
                saveVersionMutation.mutate("edit");
              }}
            >
              Edit current version
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default function DivisionsAdminPage() {
  const queryClient = useQueryClient();
  const { isSuperuser, canAccessPermission } = usePermissions();
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const getCurrentWorkspace = useWorkspaceStore((state) => state.getCurrentWorkspace);
  const fetchWorkspaces = useWorkspaceStore((state) => state.fetchWorkspaces);
  const workspace = getCurrentWorkspace();

  const [selectedGridId, setSelectedGridId] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const value = new URLSearchParams(window.location.search).get("grid");
    return value ? Number(value) : null;
  });
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const value = new URLSearchParams(window.location.search).get("version");
    return value ? Number(value) : null;
  });
  const [reviewMappingPair, setReviewMappingPair] = useState<{
    sourceVersionId: number | null;
    targetVersionId: number | null;
  }>({ sourceVersionId: null, targetVersionId: null });

  const canCreate =
    currentWorkspaceId !== null &&
    (isSuperuser || canAccessPermission("division_grid.create", currentWorkspaceId));
  const canUpdate =
    currentWorkspaceId !== null &&
    (isSuperuser || canAccessPermission("division_grid.update", currentWorkspaceId));
  const canImport =
    currentWorkspaceId !== null &&
    (isSuperuser || canAccessPermission("division_grid.import", currentWorkspaceId));
  const canExport =
    currentWorkspaceId !== null &&
    (isSuperuser || canAccessPermission("division_grid.export", currentWorkspaceId));
  const canPublish =
    currentWorkspaceId !== null &&
    (isSuperuser || canAccessPermission("division_grid.publish", currentWorkspaceId));

  const gridsQuery = useQuery({
    queryKey: ["division-grids", currentWorkspaceId],
    queryFn: () => workspaceService.getDivisionGrids(currentWorkspaceId!),
    enabled: currentWorkspaceId !== null
  });
  const grids = useMemo(() => gridsQuery.data ?? [], [gridsQuery.data]);
  const activeGrid =
    grids.find((grid) =>
      grid.versions.some((version) => version.id === workspace?.default_division_grid_version_id)
    ) ?? null;
  const selectedGrid =
    grids.find((grid) => grid.id === selectedGridId) ??
    activeGrid ??
    grids.find((grid) => !grid.archived_at) ??
    null;
  const versions = selectedGrid?.versions ?? [];
  const defaultSelectedVersion =
    versions.find((version) => version.id === workspace?.default_division_grid_version_id) ??
    versions.slice().sort((left, right) => right.version - left.version)[0] ??
    null;
  const selectedVersion =
    versions.find((version) => version.id === selectedVersionId) ?? defaultSelectedVersion;
  const effectiveVersionId = selectedVersion?.id ?? null;
  const allVersions = useMemo(() => grids.flatMap((grid) => grid.versions), [grids]);
  const reviewSourceVersionQuery = useQuery({
    queryKey: ["division-grid-version", reviewMappingPair.sourceVersionId],
    queryFn: () => workspaceService.getDivisionGridVersion(reviewMappingPair.sourceVersionId!),
    enabled:
      reviewMappingPair.sourceVersionId !== null &&
      !allVersions.some((version) => version.id === reviewMappingPair.sourceVersionId)
  });
  const mappingVersions = useMemo(() => {
    const byId = new Map(allVersions.map((version) => [version.id, version]));
    if (reviewSourceVersionQuery.data) {
      byId.set(reviewSourceVersionQuery.data.id, reviewSourceVersionQuery.data);
    }
    return [...byId.values()];
  }, [allVersions, reviewSourceVersionQuery.data]);
  const mappingGridNames = useMemo(
    () => Object.fromEntries(grids.map((grid) => [grid.id, grid.name])),
    [grids]
  );

  const selectGrid = useCallback((gridId: number, versionId?: number) => {
    setSelectedGridId(gridId);
    setSelectedVersionId(versionId ?? null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("grid", String(gridId));
      if (versionId) url.searchParams.set("version", String(versionId));
      else url.searchParams.delete("version");
      url.searchParams.set("tab", "editor");
      url.hash = "editor";
      window.history.replaceState(null, "", url);
    }
  }, []);

  const refreshGrids = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["division-grids", currentWorkspaceId] });
  }, [currentWorkspaceId, queryClient]);

  const cloneMutation = useMutation({
    mutationFn: async () => {
      if (!selectedVersion) throw new Error("Select a version first.");
      return workspaceService.cloneDivisionGridVersion(selectedVersion.id);
    },
    onSuccess: async (version) => {
      await refreshGrids();
      if (selectedGrid) selectGrid(selectedGrid.id, version.id);
      notify.success("Draft created from selected version");
    }
  });
  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!selectedVersion) throw new Error("Select a draft first.");
      return workspaceService.publishDivisionGridVersion(selectedVersion.id);
    },
    onSuccess: async (version) => {
      await refreshGrids();
      if (selectedGrid) selectGrid(selectedGrid.id, version.id);
      notify.success("Version published", {
        description: "Review activation readiness before making it the workspace default."
      });
    }
  });
  const readinessQuery = useQuery({
    queryKey: ["division-grid-readiness", currentWorkspaceId, selectedVersion?.id],
    queryFn: () =>
      workspaceService.getDivisionGridVersionReadiness(currentWorkspaceId!, selectedVersion!.id),
    enabled: currentWorkspaceId !== null && selectedVersion?.status === "published"
  });
  const activateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedVersion || !currentWorkspaceId) throw new Error("Select a published version.");
      return workspaceService.activateDivisionGridVersion(currentWorkspaceId, selectedVersion.id);
    },
    onSuccess: async () => {
      await Promise.all([refreshGrids(), fetchWorkspaces()]);
      notify.success("Workspace division grid activated");
    }
  });

  if (!currentWorkspaceId) {
    return (
      <AdminPageHeader
        title="Divisions"
        description="Select a workspace to manage division grids."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Divisions"
        description="Choose a grid, import one version when needed, and edit its tiers."
        actions={
          selectedVersion ? (
            <div className="flex flex-wrap gap-2">
              {canCreate && (
                <Button
                  variant="outline"
                  onClick={() => cloneMutation.mutate()}
                  disabled={cloneMutation.isPending}
                >
                  <CopyPlus className="mr-2 h-4 w-4" />
                  {selectedVersion.status === "published" ? "Fork draft" : "Clone draft"}
                </Button>
              )}
              {canPublish && selectedVersion.status === "draft" && (
                <Button
                  onClick={() => publishMutation.mutate()}
                  disabled={publishMutation.isPending}
                >
                  Publish version
                </Button>
              )}
              {canPublish &&
                selectedVersion.status === "published" &&
                workspace?.default_division_grid_version_id !== selectedVersion.id && (
                  <Button
                    onClick={() => activateMutation.mutate()}
                    disabled={
                      activateMutation.isPending ||
                      readinessQuery.isLoading ||
                      readinessQuery.data?.is_ready !== true
                    }
                  >
                    <Star className="mr-2 h-4 w-4" />
                    Activate
                  </Button>
                )}
            </div>
          ) : null
        }
      />

      <DivisionGridLibrary
        workspaceId={currentWorkspaceId}
        workspaceName={workspace?.name ?? "Workspace"}
        defaultVersionId={workspace?.default_division_grid_version_id ?? null}
        grids={grids}
        selectedGridId={selectedGrid?.id ?? null}
        permissions={{
          create: canCreate,
          update: canUpdate,
          import: canImport,
          export: canExport
        }}
        loading={gridsQuery.isLoading}
        error={gridsQuery.error}
        onSelect={selectGrid}
        onChanged={refreshGrids}
      />

      <DivisionGridImportWizard
        workspaceId={currentWorkspaceId}
        canImport={canImport}
        onImported={async (job) => {
          await refreshGrids();
          const imported = job.result?.imported_grids[0];
          if (imported) selectGrid(imported.target_grid_id);
        }}
      />

      {selectedGrid && (
        <Card id="editor">
          <CardHeader>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <CardTitle>Edit {selectedGrid.name}</CardTitle>
                <CardDescription>
                  Choose a draft to edit. Published versions remain read-only.
                </CardDescription>
              </div>
              <label className="grid gap-2 text-sm font-medium">
                Version
                <Select
                  value={effectiveVersionId?.toString() ?? ""}
                  onValueChange={(value) => selectGrid(selectedGrid.id, Number(value))}
                >
                  <SelectTrigger className="w-80">
                    <SelectValue placeholder="Select version" />
                  </SelectTrigger>
                  <SelectContent>
                    {versions
                      .slice()
                      .sort((left, right) => right.version - left.version)
                      .map((version) => (
                        <SelectItem key={version.id} value={version.id.toString()}>
                          v{version.version} · {version.label} · {version.status}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
          </CardHeader>
          {selectedVersion?.status === "published" &&
            readinessQuery.data &&
            !readinessQuery.data.is_ready && (
              <CardContent>
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                  Activation is blocked until mappings from source version ID(s){" "}
                  {Array.from(
                    new Set([
                      ...readinessQuery.data.missing_mapping_version_ids,
                      ...readinessQuery.data.incomplete_mapping_version_ids
                    ])
                  ).join(", ")}{" "}
                  are complete.
                </div>
              </CardContent>
            )}
        </Card>
      )}

      {selectedGrid && (
        <DivisionGridEditorCard
          key={selectedVersion?.id ?? `${selectedGrid.id}-new`}
          workspaceId={currentWorkspaceId}
          gridId={selectedGrid.id}
          canEdit={selectedVersion ? canUpdate && selectedVersion.status === "draft" : canCreate}
          selectedVersion={selectedVersion}
          onSaved={refreshGrids}
        />
      )}

      <MappingReadinessMatrix
        workspaceId={currentWorkspaceId}
        versions={allVersions}
        onSelectVersion={(targetVersionId, sourceVersionId) => {
          setReviewMappingPair({ sourceVersionId, targetVersionId });
          const grid = grids.find((candidate) =>
            candidate.versions.some((version) => version.id === targetVersionId)
          );
          if (grid) selectGrid(grid.id, targetVersionId);
        }}
      />

      {mappingVersions.length >= 2 && (
        <DivisionGridMappingEditor
          key={`${reviewMappingPair.sourceVersionId ?? "source"}-${reviewMappingPair.targetVersionId ?? "target"}`}
          versions={mappingVersions}
          gridNames={mappingGridNames}
          canEdit={canUpdate}
          reviewSourceVersionId={reviewMappingPair.sourceVersionId}
          reviewTargetVersionId={reviewMappingPair.targetVersionId}
        />
      )}
    </div>
  );
}
