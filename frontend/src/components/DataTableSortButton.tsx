import { Button } from "@/components/ui/button";
import { ArrowUp, ArrowUpDown } from "lucide-react";
import { Column } from "@tanstack/react-table";
import { cn } from "@/lib/utils";

interface DataTableSortButtonProps<TData> {
  column: Column<TData>;
  label: string;
  className?: string;
}

export function DataTableSortButton<TData>({
                                             column,
                                             label,
                                             className,
                                           }: DataTableSortButtonProps<TData>) {
  return (
    <div className="flex flex-row items-center gap-1">
      {label}
      <Button
        variant="ghost"
        size="sm"
        className={cn("px-1 text-left", className)}
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        {
          column.getIsSorted() === false ?
            <ArrowUpDown className="h-4 w-4" />
            :
            <ArrowUp
              className={cn(
                "h-4 w-4 transition-transform",
                column.getIsSorted() === "asc" && "rotate-180",
                column.getIsSorted() === "desc" && "rotate-0"
              )}
            />
        }
      </Button>
    </div>
  );
}