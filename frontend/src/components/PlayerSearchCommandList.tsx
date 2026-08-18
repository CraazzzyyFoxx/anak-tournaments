"use client";

import type { MutableRefObject } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import FavoriteStarButton from "@/components/FavoriteStarButton";
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { MinimizedUser } from "@/types/user.types";
import type { RecentPlayer } from "@/hooks/usePlayerSearch";

export interface PlayerSearchCommandListProps {
  listId: string;
  listClassName?: string;
  searchValue: string;
  emptyMessage: string;
  searchData: MinimizedUser[];
  activeIndex: number;
  itemRefs: MutableRefObject<Array<HTMLDivElement | null>>;
  history: RecentPlayer[];
  handleSelect: (user: MinimizedUser) => void;
  setActiveIndex: (index: number) => void;
  removeFromHistory: (id: number) => void;
  clearHistory: () => void;
}

/**
 * Results/history list shared by both player search surfaces (the desktop
 * popover `UserSearch` and the mobile `MobilePlayerSearchSheet`). Each
 * surface keeps its own `<Command>` wrapper/styling and passes its own
 * `listId`/`listClassName` for layout differences, plus the derived state
 * and handlers from `usePlayerSearch()`.
 */
export default function PlayerSearchCommandList({
  listId,
  listClassName,
  searchValue,
  emptyMessage,
  searchData,
  activeIndex,
  itemRefs,
  history,
  handleSelect,
  setActiveIndex,
  removeFromHistory,
  clearHistory
}: PlayerSearchCommandListProps) {
  const t = useTranslations();
  const showHistory = searchValue.trim().length === 0 && history.length > 0;

  return (
    <CommandList
      id={listId}
      role="listbox"
      aria-label={t("nav.search.resultsLabel")}
      className={listClassName}
    >
      <CommandEmpty>{emptyMessage}</CommandEmpty>
      {showHistory ? (
        <CommandGroup heading={t("nav.search.recent")}>
          {history.map((item) => (
            <CommandItem
              key={`history:${item.id}`}
              value={`history ${item.name} ${item.id}`}
              className="rounded-md px-3 py-2"
              onMouseDown={(event) => event.preventDefault()}
              onSelect={() => handleSelect(item)}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="truncate font-medium">{item.name}</span>
                <button
                  type="button"
                  aria-label={t("nav.search.removeFromHistory")}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    removeFromHistory(item.id);
                  }}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            </CommandItem>
          ))}
          <CommandItem
            key="clear-history"
            value="clear-search-history"
            className="justify-center rounded-md px-3 py-2 text-center text-muted-foreground"
            onSelect={clearHistory}
          >
            {t("nav.search.clearHistory")}
          </CommandItem>
        </CommandGroup>
      ) : null}
      <CommandGroup>
        {searchData.map((item, index) => (
          <CommandItem
            key={`${item.id}:${item.name}`}
            id={`${listId}-item-${index}`}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            value={`${item.name} ${item.id}`}
            aria-selected={activeIndex === index}
            className={cn(
              "rounded-md px-3 py-2",
              activeIndex === index && "bg-accent text-accent-foreground"
            )}
            onMouseEnter={() => setActiveIndex(index)}
            onMouseDown={(event) => event.preventDefault()}
            onSelect={() => handleSelect(item)}
          >
            <div className="flex w-full items-center justify-between gap-2">
              <span className="truncate font-medium">{item.name}</span>
              <div
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
              >
                <FavoriteStarButton playerId={item.id} size="sm" />
              </div>
            </div>
          </CommandItem>
        ))}
      </CommandGroup>
    </CommandList>
  );
}
