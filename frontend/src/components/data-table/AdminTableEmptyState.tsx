import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

/**
 * No rows. When a search or a filter is what emptied the table, the state says
 * so instead of the generic message and offers the way back out of it.
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
  const t = useTranslations("kitTable.dataTableExtra");
  const narrowed = hasSearch || hasFilters;
  return (
    <div className="flex flex-col items-center justify-center gap-2">
      <p className="text-sm text-muted-foreground">
        {!narrowed
          ? message
          : hasSearch && hasFilters
            ? t("noMatchBoth")
            : hasSearch
              ? t("noMatchSearch")
              : t("noMatchFilters")}
      </p>
      {narrowed ? (
        <Button type="button" variant="outline" size="sm" onClick={onClear}>
          {hasSearch && hasFilters ? t("clearSearchAndFilters") : hasSearch ? t("clearSearch") : t("clearFilters")}
        </Button>
      ) : null}
    </div>
  );
}
