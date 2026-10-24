"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Bookmark, ChevronLeft, ChevronRight, Download, MoreHorizontal, Rows3, Rows4, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { SearchField } from "@/components/ui/search-field";
import { Spinner } from "@/components/ui/spinner";
import { CategorizedColumnPicker } from "@/components/ui/categorized-column-picker";
import type { AdminColumnCategory } from "@/components/data-table/columns";
import { AdminSavedViews, useSavedViews, type SavedViewsExtra } from "@/components/data-table/SavedViews";
import type { AdminTableDensity } from "@/components/data-table/useTablePreferences";

/** One offerable column, as the picker and the visibility store see it. */
export interface PickerColumn {
  id: string;
  label: React.ReactNode;
  category: AdminColumnCategory;
  defaultVisible: boolean;
  mandatory: boolean;
}

export interface AdminTableToolbarProps {
  /** Below `md`, where rows are cards: the table's own controls fold into one "⋯" menu. */
  compact: boolean;
  showSearch: boolean;
  searchInputId: string;
  searchLabel: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  /** The screen's own filter bar, between the search box and the table's controls. */
  toolbar?: React.ReactNode;
  isRefreshing: boolean;
  /** Already resolved against the current selection by the table. */
  bulkActions?: React.ReactNode;
  /** Selected rows that are not on the current page, which bulk actions still include. */
  offPageSelected: number;
  selectedCount: number;
  onExportCsv: () => void;
  canExport: boolean;
  density: AdminTableDensity;
  onToggleDensity: () => void;
  prefsKey: string;
  visibility: Record<string, boolean>;
  onVisibilityChange: (next: Record<string, boolean>) => void;
  /** Absent when the screen gave no `columnsStorageKey`: no picker then. */
  pickerColumns?: PickerColumn[];
  onToggleColumn: (id: string) => void;
  onResetColumns: () => void;
  actions?: React.ReactNode;
}

const CATEGORIES: readonly AdminColumnCategory[] = ["core", "meta", "admin"];

/**
 * One row above the table: search, the screen's filter bar (chips wrap inside
 * it), then the table's own controls. Two stacked rows cost a full band of
 * chrome for a chip row that is empty most of the time.
 *
 * `compact` (a phone) keeps the search and a "⋯" on one row, the filters on the
 * next, and only the screen's own buttons after them: the CSV, views and column
 * controls would otherwise take a row of their own.
 */
export function AdminTableToolbar({
  compact,
  showSearch,
  searchInputId,
  searchLabel,
  searchValue,
  onSearchChange,
  toolbar,
  isRefreshing,
  bulkActions,
  offPageSelected,
  selectedCount,
  onExportCsv,
  canExport,
  density,
  onToggleDensity,
  prefsKey,
  visibility,
  onVisibilityChange,
  pickerColumns,
  onToggleColumn,
  onResetColumns,
  actions
}: Readonly<AdminTableToolbarProps>) {
  const t = useTranslations("kitTable.dataTableExtra");
  const savedViewsExtra: SavedViewsExtra = {
    get: () => visibility,
    apply: (next) => onVisibilityChange(next as Record<string, boolean>)
  };

  const search = showSearch ? (
    <SearchField
      id={searchInputId}
      containerClassName={compact ? "min-w-0 flex-1" : "w-full sm:w-64 sm:shrink-0"}
      autoComplete="off"
      name="admin-table-search"
      label={searchLabel}
      placeholder={searchLabel}
      value={searchValue}
      onValueChange={onSearchChange}
    />
  ) : null;

  const spinner = isRefreshing ? (
    <output className="flex shrink-0 items-center text-muted-foreground">
      <Spinner className="size-3" />
      <span className="sr-only">{t("refreshing")}</span>
    </output>
  ) : null;

  const offPage =
    offPageSelected > 0 ? (
      <span className="text-xs tabular-nums text-muted-foreground" title={t("selectedRowsOtherPages")}>
        {t("selectedOnOtherPages", { count: offPageSelected })}
      </span>
    ) : null;

  if (compact) {
    const menu = (
      <div className="ml-auto flex shrink-0 items-center gap-3">
        {spinner}
        <AdminTableMenu
          selectedCount={selectedCount}
          onExportCsv={onExportCsv}
          canExport={canExport}
          prefsKey={prefsKey}
          savedViewsExtra={savedViewsExtra}
          visibility={visibility}
          pickerColumns={pickerColumns}
          onToggleColumn={onToggleColumn}
          onResetColumns={onResetColumns}
        />
      </div>
    );
    return (
      <div className="flex flex-wrap items-center gap-3 border-b border-border/40 px-4 py-2.5">
        {search}
        {search ? menu : null}
        {/* Under a search the filters take the next row whole; without one they share the menu's row. */}
        {toolbar ? <div className={search ? "w-full" : "min-w-0 flex-1"}>{toolbar}</div> : null}
        {search ? null : menu}
        {/* `empty:hidden`: a screen action that renders nothing must not leave a gap-sized row. */}
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2 empty:hidden">
          {bulkActions}
          {offPage}
          {actions}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border/40 px-4 py-2.5">
      {search}

      {toolbar ? <div className="min-w-32 flex-1">{toolbar}</div> : null}

      {spinner}

      <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
        {bulkActions}
        {offPage}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onExportCsv}
          disabled={!canExport}
          title={selectedCount > 0 ? t("exportSelected", { count: selectedCount }) : t("exportCurrent")}
        >
          <Download aria-hidden className="size-3.5" />
          {t("csv")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-8 px-0"
          aria-pressed={density === "compact"}
          aria-label={density === "compact" ? t("comfortableRows") : t("compactRows")}
          title={density === "compact" ? t("comfortableRows") : t("compactRows")}
          onClick={onToggleDensity}
        >
          {density === "compact" ? <Rows3 aria-hidden className="size-3.5" /> : <Rows4 aria-hidden className="size-3.5" />}
        </Button>
        <AdminSavedViews storageKey={prefsKey} extra={savedViewsExtra} />
        {pickerColumns ? (
          <CategorizedColumnPicker<AdminColumnCategory, PickerColumn>
            columns={pickerColumns}
            categories={CATEGORIES}
            categoryLabel={(category) => t(category)}
            visibility={visibility}
            onToggle={onToggleColumn}
            onReset={onResetColumns}
            triggerLabel={t("columns")}
            resetLabel={t("resetColumns")}
            isMandatory={(id) => pickerColumns.some((column) => column.id === id && column.mandatory)}
          />
        ) : null}
        {actions}
      </div>
    </div>
  );
}

/**
 * The phone's "⋯": CSV export, then the views and columns as a second level
 * that replaces the menu's items — a Radix side submenu has no room beside a
 * menu on a phone and runs off the screen edge. No density toggle: the cards a
 * phone shows have no row density.
 */
function AdminTableMenu({
  selectedCount,
  onExportCsv,
  canExport,
  prefsKey,
  savedViewsExtra,
  visibility,
  pickerColumns,
  onToggleColumn,
  onResetColumns
}: Readonly<
  Pick<
    AdminTableToolbarProps,
    | "selectedCount"
    | "onExportCsv"
    | "canExport"
    | "prefsKey"
    | "visibility"
    | "pickerColumns"
    | "onToggleColumn"
    | "onResetColumns"
  > & { savedViewsExtra: SavedViewsExtra }
>) {
  const t = useTranslations("kitTable.dataTableExtra");
  const actionsT = useTranslations("kit.actions");
  const savedViews = useSavedViews(prefsKey, savedViewsExtra);
  const [level, setLevel] = useState<"root" | "views" | "columns">("root");

  return (
    <>
      <DropdownMenu onOpenChange={(open) => (open ? undefined : setLevel("root"))}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-8 px-0"
            aria-label={t("tableMenu")}
            title={t("tableMenu")}
          >
            <MoreHorizontal aria-hidden className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {level === "root" ? (
            <>
              <DropdownMenuItem disabled={!canExport} onSelect={onExportCsv}>
                <Download aria-hidden />
                {selectedCount > 0 ? t("exportSelected", { count: selectedCount }) : t("exportCurrent")}
              </DropdownMenuItem>
              {/* `preventDefault` keeps the menu open while it switches level. */}
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  savedViews.reload();
                  setLevel("views");
                }}
              >
                <Bookmark aria-hidden />
                {t("views")}
                <ChevronRight aria-hidden className="ml-auto" />
              </DropdownMenuItem>
              {pickerColumns ? (
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    setLevel("columns");
                  }}
                >
                  <Settings2 aria-hidden />
                  {t("columns")}
                  <ChevronRight aria-hidden className="ml-auto" />
                </DropdownMenuItem>
              ) : null}
            </>
          ) : (
            <>
              <DropdownMenuItem
                aria-label={actionsT("back")}
                onSelect={(event) => {
                  event.preventDefault();
                  setLevel("root");
                }}
              >
                <ChevronLeft aria-hidden />
                {level === "views" ? t("views") : t("columns")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {level === "views" ? savedViews.items : null}
              {level === "columns" && pickerColumns ? (
                <>
                  {CATEGORIES.map((category) => {
                    const columns = pickerColumns.filter((column) => column.category === category);
                    if (columns.length === 0) return null;
                    return (
                      <DropdownMenuGroup key={category}>
                        <DropdownMenuLabel>{t(category)}</DropdownMenuLabel>
                        {columns.map((column) => (
                          <DropdownMenuCheckboxItem
                            key={column.id}
                            checked={column.mandatory || visibility[column.id] !== false}
                            disabled={column.mandatory}
                            onCheckedChange={() => onToggleColumn(column.id)}
                            // Stay open: columns are toggled several at a time.
                            onSelect={(event) => event.preventDefault()}
                          >
                            {column.label}
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuGroup>
                    );
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      onResetColumns();
                    }}
                  >
                    {t("resetColumns")}
                  </DropdownMenuItem>
                </>
              ) : null}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {savedViews.dialog}
    </>
  );
}
