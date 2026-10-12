import { CircleMinus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

/**
 * No rows. When a search or a filter is what emptied the table, the state also
 * offers the way back out of it.
 */
export function AdminTableEmptyState({
  message,
  hasSearch,
  hasFilters,
  onClear
}: Readonly<{
  message: string;
  hasSearch: boolean;
  hasFilters: boolean;
  onClear: () => void;
}>) {
  const t = useTranslations("kitTable.table");
  const dataT = useTranslations("kitTable.dataTableExtra");
  const narrowed = hasSearch && hasFilters ? "search and filters" : hasSearch ? "search" : "filters";
  return (
    <div className="flex flex-col items-center justify-center gap-2">
      <CircleMinus aria-hidden className="size-5 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">{message}</p>
      {hasSearch || hasFilters ? (
        <>
          <p className="text-xs text-muted-foreground">{t("nothingMatches", { noun: narrowed })}.</p>
          <Button type="button" variant="outline" size="sm" onClick={onClear}>
            {hasSearch && hasFilters ? dataT("clearSearchAndFilters") : hasSearch ? dataT("clearSearch") : dataT("clearFilters")}
          </Button>
        </>
      ) : null}
    </div>
  );
}
