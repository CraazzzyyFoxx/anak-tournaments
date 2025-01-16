"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CaretSortIcon } from "@radix-ui/react-icons";

export interface CustomSelectItem {
  value: any;
  label: string;
  item?: React.ReactNode;
}

export interface CustomSelectProps {
  items: CustomSelectItem[];
  placeholder?: string;
  value: any;
  onSelect: (value: any) => void;
  className?: string;
}

const CustomSelect = ({ items, placeholder, value, onSelect, className }: CustomSelectProps) => {
  const [isOpen, setIsOpen] = React.useState<boolean>(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  const selectedItem: string | undefined = useMemo(() => {
    const item = items.find((item) => item.value == value);
    if (!item) return undefined;
    return item.label;
  }, [items, value]);

  useEffect(() => {
    if (isOpen) setIsOpen(false);
  }, [value]);

  return (
    <div
      onFocus={() => setIsOpen(true)}
      onClick={() => setIsOpen(true)}
      className={cn("relative", className)}
    >
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverAnchor asChild>
          <div ref={anchorRef}>
            <Input
              defaultValue={selectedItem}
              value={selectedItem}
              onFocus={() => setIsOpen(true)}
              onClick={() => setIsOpen(true)}
              onChange={() => {}}
              placeholder={placeholder}
              className={cn("pr-8", className)}
            />
            <CaretSortIcon className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          </div>
        </PopoverAnchor>
        <PopoverContent
          className="p-0 w-auto min-w-[var(--anchor-width)]"
          onOpenAutoFocus={(e) => e.preventDefault()}
          style={{ minWidth: `${anchorRef.current?.offsetWidth || 0}px` }}
        >
          <Command className="rounded-lg border shadow-md w-full">
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
              <CommandGroup>
                {items.map((item) => (
                  <CommandItem
                    key={item.value}
                    onSelect={() => {
                      onSelect(item.value);
                    }}
                  >
                    {item.item || item.label}
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

export default CustomSelect;
