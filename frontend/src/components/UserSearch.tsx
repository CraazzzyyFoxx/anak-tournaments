"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { usePlayerSearch } from "@/hooks/usePlayerSearch";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const UserSearch = () => {
  const t = useTranslations();
  const inputId = useId();
  const listId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [contentWidth, setContentWidth] = useState<number | undefined>(undefined);

  const {
    searchValue,
    isOpen,
    setIsOpen,
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
  } = usePlayerSearch();

  useEffect(() => {
    const container = containerRef.current;

    if (!container) return;

    const syncWidth = () => setContentWidth(container.offsetWidth);

    syncWidth();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(syncWidth);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  const handleClear = () => {
    resetSearch();

    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const showHistory = searchValue.trim().length === 0 && history.length > 0;

  return (
    <div ref={containerRef} className="relative liquid-glass">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverAnchor asChild>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground"
            />
            <Input
              id={inputId}
              ref={inputRef}
              value={searchValue}
              onChange={handleChange}
              onFocus={() => setIsOpen(true)}
              onClick={() => setIsOpen(true)}
              onKeyDown={handleKeyDown}
              type="text"
              autoComplete="off"
              spellCheck={false}
              inputMode="search"
              enterKeyHint="search"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={isOpen}
              aria-controls={listId}
              aria-activedescendant={activeIndex >= 0 ? `${listId}-item-${activeIndex}` : undefined}
              aria-label={t("nav.search.placeholder")}
              placeholder={t("nav.search.placeholder")}
              className={cn(
                "h-10 rounded-xl border-border/60 bg-background/15 pl-9 pr-10 shadow-sm transition-all duration-200 hover:bg-background/20 focus-visible:ring-2 focus-visible:ring-ring/30 sm:w-[300px] md:w-[200px] lg:w-[300px]",
                isOpen && "border-ring/40 bg-background/20 shadow-lg"
              )}
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
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="liquid-glass-panel p-0"
          onOpenAutoFocus={(event) => event.preventDefault()}
          style={contentWidth ? { width: `${contentWidth}px` } : undefined}
        >
          <Command className="liquid-glass-surface rounded-xl">
            <CommandList id={listId} role="listbox" aria-label={t("nav.search.resultsLabel")}>
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
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default UserSearch;
