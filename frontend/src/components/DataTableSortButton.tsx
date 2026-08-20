import { ArrowUp, ArrowUpDown } from "lucide-react";
import { Column } from "@tanstack/react-table";

import { cn } from "@/lib/utils";

interface DataTableSortButtonProps<TData> {
  column: Column<TData>;
  label: string;
  className?: string;
}

/**
 * Sortable column header. Rendered by `@/components/ui/data-table` for every
 * column that can sort, so no call site has to remember to add it.
 *
 * The whole header is one button, which makes the label its accessible name —
 * the previous version put the label in a `<div>` beside an icon-only button
 * with no name at all, so assistive technology announced a bare "button".
 */
export function DataTableSortButton<TData>({
  column,
  label,
  className
}: Readonly<DataTableSortButtonProps<TData>>) {
  const sorted = column.getIsSorted();

  return (
    <button
      type="button"
      onClick={() => column.toggleSorting(sorted === "asc")}
      className={cn(
        "inline-flex items-center gap-1 rounded-[4px] px-1 outline-none transition-colors",
        "hover:text-[color:var(--aqt-fg)]",
        "focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)]",
        className
      )}
    >
      <span>{label}</span>
      {sorted === false ? (
        <ArrowUpDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : (
        <ArrowUp
          aria-hidden
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform",
            sorted === "asc" && "rotate-180"
          )}
        />
      )}
    </button>
  );
}
