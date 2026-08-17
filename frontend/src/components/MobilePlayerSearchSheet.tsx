"use client";

import React, { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import FavoriteStarButton from "@/components/FavoriteStarButton";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { usePlayerSearch } from "@/hooks/usePlayerSearch";

/**
 * Full-screen player search for narrow viewports, where the desktop popover
 * (`UserSearch`) is hidden. The sheet itself is the "popover" — no nested
 * Popover/PopoverAnchor, just a scrollable results list below the input.
 * Shares its query/debounce/fetch/keyboard-nav/history behavior with
 * `UserSearch` via `usePlayerSearch()`; closes itself on selection through
 * that hook's `onNavigate` callback.
 */
const MobilePlayerSearchSheet = () => {
  const t = useTranslations();
  const inputId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [sheetOpen, setSheetOpen] = useState<boolean>(false);

  const {
    searchValue,
    isOpen,
    isSearching,
    searchData,
    activeIndex,
    emptyMessage,
    handleSelect,
    handleClear: resetSearch,
    handleChange,
    handleKeyDown,
    setActiveIndex,
    itemRefs,
    history,
    removeFromHistory,
    clearHistory
  } = usePlayerSearch(() => setSheetOpen(false));

  const handleClear = () => {
    resetSearch();

    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const showHistory = searchValue.trim().length === 0 && history.length > 0;

  return (
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="shrink-0 md:hidden"
          aria-label={t("nav.search.mobileTrigger")}
        >
          <Search className="h-5 w-5" aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="top"
        aria-describedby={undefined}
        className="flex h-[100dvh] max-h-[100dvh] w-full flex-col gap-4 overflow-hidden border-none p-4"
      >
        <SheetTitle className="sr-only">{t("nav.search.mobileTrigger")}</SheetTitle>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground"
            />
            <Input
              id={inputId}
              ref={inputRef}
              value={searchValue}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              type="text"
              autoComplete="off"
              spellCheck={false}
              inputMode="search"
              enterKeyHint="search"
              autoFocus
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={isOpen}
              aria-controls={listId}
              aria-activedescendant={activeIndex >= 0 ? `${listId}-item-${activeIndex}` : undefined}
              aria-label={t("nav.search.placeholder")}
              placeholder={t("nav.search.placeholder")}
              className="h-10 rounded-xl border-border/60 bg-background/15 pl-9 pr-10 shadow-sm"
            />
            {isSearching ? (
              <Loader2
                aria-hidden
                className="pointer-events-none absolute right-3 top-3 h-4 w-4 animate-spin text-muted-foreground"
              />
            ) : searchValue.length > 0 ? (
              <button
                type="button"
                aria-label={t("nav.search.clear")}
                className="absolute right-2.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                onMouseDown={(event) => event.preventDefault()}
                onClick={handleClear}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" aria-label={t("nav.search.close")}>
              <X className="h-5 w-5" aria-hidden />
            </Button>
          </SheetClose>
        </div>
        <Command className="flex-1 overflow-hidden rounded-xl border border-border/60">
          <CommandList
            id={listId}
            role="listbox"
            aria-label={t("nav.search.resultsLabel")}
            className="max-h-full"
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
        </Command>
      </SheetContent>
    </Sheet>
  );
};

export default MobilePlayerSearchSheet;
