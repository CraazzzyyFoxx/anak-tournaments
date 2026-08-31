"use client";

import { memo, useCallback, useMemo, useRef, useState } from "react";
import { OwRankRangePicker } from "./OwRankRangePicker";
import { DivisionGridImportWizard } from "./ImportWizard";
import { DivisionGridLibrary } from "./GridLibrary";
import { DivisionGridConflictResolver } from "./ConflictResolver";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, Save, Star, Trash2, Upload, Wand2, X } from "lucide-react";
import Image from "next/image";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-error";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { notify } from "@/lib/notify";
import { usePermissions } from "@/hooks/usePermissions";
import { DEFAULT_DIVISION_GRID } from "@/lib/division-grid";
import { DIVISION_ICON_BASE } from "@/lib/ow-ladder";
import { OW2_RANK_OPTIONS } from "@/lib/ow-rank-mapping";
import workspaceService from "@/services/workspace.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type {
  DivisionGridActivationReadiness,
  DivisionGridVersion,
  DivisionTier
} from "@/types/workspace.types";

function emptyTier(number: number, index: number): DivisionTier {
  return {
    slug: `division-${number}`,
    number,
    name: `Division ${number}`,
    sort_order: index,
    rank_min: 500,
    rank_max: 599,
    icon_url: `${DIVISION_ICON_BASE}/bronze-5.png`,
    ow_rank_min: null,
    ow_rank_max: null
  };
}

/**
 * Editor rows for a version, or for the in-code default ladder when passed
 * `null` — which is both the no-version fallback and what "Load standard OW
 * grid" pushes into the editor. Both go through the same normalization so a
 * default draft and a loaded version cannot differ in ordering or `sort_order`.
 */
export function buildEditorState(selectedVersion: DivisionGridVersion | null): {
  label: string;
  tiers: DivisionTier[];
} {
  return {
    label: selectedVersion?.label ?? "Draft",
    tiers: [...(selectedVersion?.tiers ?? DEFAULT_DIVISION_GRID.tiers)]
      .sort((a, b) => a.number - b.number)
      .map((tier, index) => ({ ...tier, sort_order: tier.sort_order ?? index }))
  };
}

type SaveTierPayload = {
  id?: number | null;
  slug: string;
  number: number;
  name: string;
  sort_order: number;
  rank_min: number;
  rank_max: number | null;
  icon_url: string;
  ow_rank_min: number | null;
  ow_rank_max: number | null;
};

/**
 * The standard OW ladder as a ready-to-save payload, OW mapping included.
 *
 * Every ladder tier's `rank_min` IS its OW `rank_value` — the artifact carries
 * one of each and they align 1:1 — so the mapping is a single OW rank per tier,
 * exactly what "Auto-map OW ranges" produces for a 45-tier grid. The pair must
 * be filled on BOTH ends: `resolve_division_from_ow_rank` skips any tier with a
 * `None` endpoint, so leaving the open-ended top tier's `ow_rank_max` null would
 * make Champion 1 unreachable by OW rank.
 */
export function standardOwTierPayload(): SaveTierPayload[] {
  return buildEditorState(null).tiers.map((tier, index) => ({
    slug: tier.slug,
    number: tier.number,
    name: tier.name,
    sort_order: index,
    rank_min: tier.rank_min,
    rank_max: tier.rank_max,
    icon_url: tier.icon_url,
    ow_rank_min: tier.rank_min,
    ow_rank_max: tier.rank_min
  }));
}

type DivisionGridEditorCardProps = {
  workspaceId: number;
  canEdit: boolean;
  activeVersion: DivisionGridVersion | null;
  saving: boolean;
  onSave: (payload: { name: string; tiers: SaveTierPayload[] }) => void;
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
  // Every cell needs its own accessible name; the name cell can be blank mid-edit.
  const rowLabel = tier.name || `division ${tier.number}`;

  return (
    <div className="grid min-w-[900px] grid-cols-[40px_56px_48px_180px_220px_1fr_40px_36px] gap-2 border-b px-4 py-1.5 last:border-b-0">
      <div className="flex items-center justify-center">
        <Checkbox
          checked={isSelected}
          onCheckedChange={(checked) => onSelect(rowIndex, checked === true)}
          aria-label={`Select ${rowLabel}`}
          disabled={!canEdit}
        />
      </div>
      <Input
        ref={setInputRef(0)}
        inputMode="numeric"
        aria-label={`Number for ${rowLabel}`}
        className="h-8 text-center tabular-nums"
        value={tier.number}
        onChange={(event) => onUpdate(rowIndex, "number", parseIntegerInput(event.target.value))}
        onKeyDown={(event) => onKeyDown(event, rowIndex, 0)}
        disabled={!canEdit}
      />
      <div className="flex items-center justify-center">
        {/* Decorative: the editable name sits in the next cell. */}
        <Image
          src={tier.icon_url}
          alt=""
          width={28}
          height={28}
          className="h-7 w-7 object-contain"
        />
      </div>
      <Input
        ref={setInputRef(1)}
        aria-label={`Name for ${rowLabel}`}
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
          aria-label={`Minimum rank for ${rowLabel}`}
          className="h-8 w-24 tabular-nums"
          value={tier.rank_min}
          onChange={(event) =>
            onUpdate(rowIndex, "rank_min", parseIntegerInput(event.target.value))
          }
          onKeyDown={(event) => onKeyDown(event, rowIndex, 2)}
          disabled={!canEdit}
        />
        <span aria-hidden className="shrink-0 text-xs text-muted-foreground">
          –
        </span>
        <Input
          ref={setInputRef(3)}
          inputMode="numeric"
          aria-label={`Maximum rank for ${rowLabel}`}
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
      {/* `sr-only` rather than `hidden`: a display:none input is unreachable by keyboard. */}
      <label className="inline-flex cursor-pointer items-center justify-center">
        <input
          type="file"
          className="peer sr-only"
          aria-label={`Upload icon for ${rowLabel}`}
          accept="image/png,image/webp,image/jpeg,image/gif"
          disabled={!canEdit}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onUpload(rowIndex, tier, file);
            event.currentTarget.value = "";
          }}
        />
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border hover:bg-muted peer-focus-visible:ring-1 peer-focus-visible:ring-ring">
          <Upload aria-hidden className="h-3.5 w-3.5" />
        </span>
      </label>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        onClick={() => onDelete(rowIndex)}
        disabled={!canEdit}
        aria-label={`Delete ${rowLabel}`}
      >
        <Trash2 aria-hidden className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
});

function DivisionGridEditorCard({
  workspaceId,
  canEdit,
  activeVersion,
  saving,
  onSave
}: Readonly<DivisionGridEditorCardProps>) {
  const initialState = useMemo(() => buildEditorState(activeVersion), [activeVersion]);
  const [label, setLabel] = useState(initialState.label);
  const [tiers, setTiers] = useState<DivisionTier[]>(initialState.tiers);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(() => new Set());
  const [rankDelta, setRankDelta] = useState(DEFAULT_RANK_STEP);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeStep, setRangeStep] = useState(DEFAULT_RANK_STEP);
  const [tiersToAdd, setTiersToAdd] = useState(1);

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

  const handleSave = useCallback(() => {
    onSave({ name: label, tiers: tiersPayload });
  }, [onSave, label, tiersPayload]);

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
        <CardTitle asChild>
          <h2>Version editor</h2>
        </CardTitle>
        <CardDescription>
          Minor changes (name, icon, OW ranks) save in-place. Adding or removing tiers, or changing
          rank ranges, will prompt you to choose between editing the current version or creating a
          new draft.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="version-label">
            Version label
          </label>
          <Input
            id="version-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Version label"
          />
        </div>

        <div className="rounded-md border bg-muted/20 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Bulk target</div>
              <Badge variant="outline" className="h-9 px-3 tabular-nums">
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
              <Plus aria-hidden className="mr-2 h-4 w-4" />
              Raise ranks
            </Button>
            <Button
              variant="outline"
              onClick={() => shiftBulkRanks(-1)}
              disabled={!canEdit || bulkTargetIndexes.length === 0}
            >
              <Minus aria-hidden className="mr-2 h-4 w-4" />
              Lower ranks
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
              <Wand2 aria-hidden className="mr-2 h-4 w-4" />
              Auto-fill ranges
            </Button>
            <Button
              variant="outline"
              onClick={autoMapOwRanges}
              disabled={!canEdit || bulkTargetIndexes.length === 0}
              title="Distribute the OW2 ladder across the targeted tiers (top tier gets the highest ranks)"
            >
              <Wand2 aria-hidden className="mr-2 h-4 w-4" />
              Auto-map OW ranges
            </Button>
            <Button
              variant="outline"
              onClick={clearOwRanges}
              disabled={!canEdit || bulkTargetIndexes.length === 0}
            >
              <X aria-hidden className="mr-2 h-4 w-4" />
              Clear OW ranges
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
              <Plus aria-hidden className="mr-2 h-4 w-4" />
              Add tiers
            </Button>
            <Button
              variant="outline"
              onClick={removeSelectedTiers}
              disabled={!canEdit || selectedRowIndexes.length === 0}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 aria-hidden className="mr-2 h-4 w-4" />
              Delete selected tiers
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
            <span>Rank range</span>
            <span>OW range</span>
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
          {tiers.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              No divisions yet. Set “Tiers” above, then choose “Add tiers” to start the grid.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSave} disabled={!canEdit || saving}>
            <Save aria-hidden className="mr-2 h-4 w-4" />
            {saving ? "Saving…" : "Save grid"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function VersionHistoryCard({
  versions,
  activeVersionId
}: Readonly<{
  versions: DivisionGridVersion[];
  activeVersionId: number | null;
}>) {
  const ordered = [...versions].sort((left, right) => right.version - left.version);
  return (
    <Card>
      <CardHeader>
        <CardTitle asChild>
          <h2>Version history</h2>
        </CardTitle>
        <CardDescription>
          Read-only. Each structural save creates a new version; existing tournaments stay pinned to
          theirs and are remapped automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {ordered.map((version) => (
          <div
            key={version.id}
            className="flex flex-wrap items-center gap-2 border-b py-1.5 text-sm last:border-b-0"
          >
            <span className="font-medium tabular-nums">v{version.version}</span>
            <span className="text-muted-foreground">{version.label}</span>
            <Badge variant="outline">{version.status}</Badge>
            {version.id === activeVersionId && <Badge>Active</Badge>}
            {version.published_at && (
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                {new Date(version.published_at).toLocaleDateString()}
              </span>
            )}
          </div>
        ))}
      </CardContent>
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

  const [conflict, setConflict] = useState<{
    targetVersionId: number;
    readiness: DivisionGridActivationReadiness;
  } | null>(null);
  const [selectedGridId, setSelectedGridId] = useState<number | null>(null);

  const canCreate =
    currentWorkspaceId !== null &&
    (isSuperuser || canAccessPermission("division_grid.create", currentWorkspaceId));
  const canUpdate =
    currentWorkspaceId !== null &&
    (isSuperuser || canAccessPermission("division_grid.update", currentWorkspaceId));
  const canImport =
    currentWorkspaceId !== null &&
    (isSuperuser || canAccessPermission("division_grid.create", currentWorkspaceId));
  const canExport =
    currentWorkspaceId !== null &&
    (isSuperuser || canAccessPermission("division_grid.read", currentWorkspaceId));
  const canDelete =
    currentWorkspaceId !== null &&
    (isSuperuser || canAccessPermission("division_grid.delete", currentWorkspaceId));
  const canPublish =
    currentWorkspaceId !== null &&
    (isSuperuser || canAccessPermission("division_grid.update", currentWorkspaceId));

  const gridsQuery = useQuery({
    queryKey: ["division-grids", currentWorkspaceId],
    queryFn: () => workspaceService.getDivisionGrids(currentWorkspaceId!),
    enabled: currentWorkspaceId !== null
  });
  const grids = useMemo(() => gridsQuery.data ?? [], [gridsQuery.data]);
  const defaultVersionId = workspace?.default_division_grid_version_id ?? null;
  const activeGrid =
    grids.find((grid) => grid.versions.some((version) => version.id === defaultVersionId)) ??
    grids.find((grid) => !grid.archived_at) ??
    grids[0] ??
    null;
  const editedGrid =
    grids.find((grid) => grid.id === selectedGridId) ??
    activeGrid ??
    null;
  const activeVersion =
    editedGrid?.versions.find((version) => version.id === defaultVersionId) ??
    editedGrid?.versions.slice().sort((left, right) => right.version - left.version)[0] ??
    null;

  const refreshGrids = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["division-grids", currentWorkspaceId] }),
      fetchWorkspaces()
    ]);
  }, [currentWorkspaceId, queryClient, fetchWorkspaces]);

  const conflictTargetVersion = useMemo(() => {
    if (!conflict || !editedGrid) return null;
    return editedGrid.versions.find((version) => version.id === conflict.targetVersionId) ?? null;
  }, [conflict, editedGrid]);

  const saveMutation = useMutation({
    mutationFn: (payload: { name: string; tiers: SaveTierPayload[] }) =>
      workspaceService.saveWorkspaceGrid(currentWorkspaceId!, {
        ...payload,
        grid_id: editedGrid?.id ?? null
      }),
    onSuccess: async (result) => {
      await refreshGrids();
      if (result.mode === "new_version_pending") {
        setConflict({ targetVersionId: result.saved_version_id, readiness: result.readiness });
        notify.warning("Saved as a new version", {
          description: "Resolve the mapping conflicts below to activate it."
        });
        return;
      }
      setConflict(null);
      notify.success(result.mode === "in_place" ? "Grid updated" : "New version activated");
    },
    onError: () =>
      notify.error("Grid could not be saved", {
        description:
          "Your edits are still in the form — check that every division has a name and a rank range, then save again."
      })
  });

  /**
   * "Load standard OW grid" writes the standard ladder straight through the
   * normal save path, so it versions, auto-remaps every pinned tournament and
   * activates exactly like any other structural edit. `name` repeats the grid's
   * current name on purpose: `save_workspace_grid` also assigns it to
   * `grid.name`, and loading a standard grid must not rename the grid.
   */
  const loadStandardGrid = () =>
    saveMutation.mutate({
      name: editedGrid?.name ?? "Division Grid",
      tiers: standardOwTierPayload()
    });

  const publishMutation = useMutation({
    mutationFn: () => workspaceService.publishDivisionGridVersion(activeVersion!.id),
    onSuccess: async () => {
      await refreshGrids();
      notify.success("Version published");
    },
    onError: () =>
      notify.error("Version could not be published", {
        description: "The version is still a draft. Retry, or reload the page if it keeps failing."
      })
  });
  const activateMutation = useMutation({
    mutationFn: () => workspaceService.activateDivisionGridVersion(currentWorkspaceId!, activeVersion!.id),
    onSuccess: async () => {
      setConflict(null);
      await refreshGrids();
      notify.success("Grid activated for the workspace");
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 409 && activeVersion) {
        const readiness = await workspaceService.getDivisionGridVersionReadiness(
          currentWorkspaceId!,
          activeVersion.id
        );
        setConflict({ targetVersionId: activeVersion.id, readiness });
        notify.warning("Activation blocked", {
          description: "Resolve the mapping conflicts below, then activate."
        });
        return;
      }
      notify.error("Grid could not be activated", {
        description:
          "The workspace still uses its previous grid. Publish this version first, then activate it."
      });
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

  const conflictSources =
    conflict?.readiness.sources.filter((source) => source.conflict_tiers.length > 0) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Divisions"
        description="Edit your workspace division grid. Saving auto-versions, remaps existing tournaments, and activates when the mapping is complete."
        actions={
          activeVersion ? (
            <div className="flex flex-wrap items-center gap-2">
              {defaultVersionId === activeVersion.id ? (
                <Badge variant="secondary">Active grid</Badge>
              ) : (
                canPublish && (
                  <Button
                    onClick={() => activateMutation.mutate()}
                    disabled={activateMutation.isPending || activeVersion.status !== "published"}
                    title={
                      activeVersion.status === "published"
                        ? undefined
                        : "Publish this version first, then activate it."
                    }
                  >
                    <Star aria-hidden className="mr-2 h-4 w-4" />
                    Activate grid
                  </Button>
                )
              )}
              {canPublish && activeVersion.status === "draft" && (
                <Button
                  variant="outline"
                  onClick={() => publishMutation.mutate()}
                  disabled={publishMutation.isPending}
                >
                  Publish version
                </Button>
              )}
            </div>
          ) : null
        }
      />

      <DivisionGridLibrary
        workspaceId={currentWorkspaceId}
        workspaceName={workspace?.name ?? "Workspace"}
        defaultVersionId={defaultVersionId}
        grids={grids}
        selectedGridId={editedGrid?.id ?? null}
        permissions={{
          create: canCreate,
          update: canUpdate,
          import: canImport,
          export: canExport,
          delete: canDelete
        }}
        loading={gridsQuery.isLoading}
        error={gridsQuery.error}
        canLoadStandard={activeVersion ? canUpdate : canCreate}
        loadStandardPending={saveMutation.isPending}
        onLoadStandard={loadStandardGrid}
        onSelect={(gridId) => setSelectedGridId(gridId)}
        onChanged={refreshGrids}
      />

      <DivisionGridImportWizard
        workspaceId={currentWorkspaceId}
        canImport={canImport}
        onImported={async (job) => {
          await refreshGrids();
          const imported = job.result?.imported_grids[0];
          if (imported) setSelectedGridId(imported.target_grid_id);
        }}
      />

      {conflict && conflictTargetVersion && (
        <DivisionGridConflictResolver
          workspaceId={currentWorkspaceId}
          targetVersionId={conflict.targetVersionId}
          targetTiers={conflictTargetVersion.tiers}
          sources={conflictSources}
          canEdit={canUpdate}
          onResolved={async () => {
            setConflict(null);
            await refreshGrids();
          }}
        />
      )}

      {editedGrid && (
        <DivisionGridEditorCard
          key={activeVersion?.id ?? `${editedGrid.id}-new`}
          workspaceId={currentWorkspaceId}
          canEdit={activeVersion ? canUpdate : canCreate}
          activeVersion={activeVersion}
          saving={saveMutation.isPending}
          onSave={(payload) => saveMutation.mutate(payload)}
        />
      )}

      {editedGrid && editedGrid.versions.length > 0 && (
        <VersionHistoryCard versions={editedGrid.versions} activeVersionId={defaultVersionId} />
      )}
    </div>
  );
}
