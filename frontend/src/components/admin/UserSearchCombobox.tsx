"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";

import userService from "@/services/user.service";
import { MinimizedUser } from "@/types/user.types";
import { AdminCombobox, AdminComboboxCheck } from "@/components/admin/AdminCombobox";
import { CommandGroup, CommandItem } from "@/components/ui/command";

interface UserSearchComboboxProps {
  id?: string;
  value?: number;
  selectedName?: string;
  onSelect: (user: MinimizedUser | undefined) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
}

export function UserSearchCombobox({
  id,
  value,
  selectedName,
  onSelect,
  placeholder = "Select user",
  searchPlaceholder = "Search user…",
  disabled = false,
  allowClear = true,
}: UserSearchComboboxProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [debouncedSearch] = useDebounce(searchValue, 250);

  const normalizedQuery = debouncedSearch.trim();
  const shouldSearch = normalizedQuery.length >= 2;

  const usersQuery = useQuery({
    queryKey: ["users-search-minimized", normalizedQuery],
    enabled: open && shouldSearch,
    queryFn: ({ signal }) => userService.searchUsers(normalizedQuery, signal),
    staleTime: 60 * 1000,
  });

  const results = usersQuery.data ?? [];

  const selectedLabel = useMemo(() => {
    const matchedUser = results.find((user) => user.id === value);

    if (matchedUser) {
      return matchedUser.name;
    }

    if (selectedName) {
      return selectedName;
    }

    if (typeof value === "number" && value > 0) {
      return `User #${value}`;
    }

    return placeholder;
  }, [placeholder, results, selectedName, value]);

  const handleSelect = useCallback(
    (user: MinimizedUser | undefined) => {
      onSelect(user);
      setOpen(false);
      setSearchValue("");
    },
    [onSelect]
  );

  const emptyMessage = usersQuery.isFetching
    ? "Loading users…"
    : usersQuery.isError
      ? "Could not load users. Try again."
      : !shouldSearch
        ? "Type at least 2 characters to search."
        : "No users match that search. Try a shorter name.";

  return (
    <AdminCombobox
      id={id}
      open={open}
      onOpenChange={setOpen}
      label={selectedLabel}
      disabled={disabled}
      searchValue={searchValue}
      onSearchValueChange={setSearchValue}
      searchPlaceholder={searchPlaceholder}
      emptyMessage={emptyMessage}
      clear={
        allowClear && typeof value === "number" && value > 0
          ? {
              label: "Clear selection",
              value: "clear-user-selection",
              onSelect: () => handleSelect(undefined)
            }
          : undefined
      }
    >
      <CommandGroup>
        {results.map((user) => (
          <CommandItem
            key={user.id}
            value={`${user.name} ${user.id}`}
            onSelect={() => handleSelect(user)}
          >
            <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
              <span className="truncate">{user.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">#{user.id}</span>
            </div>
            <AdminComboboxCheck selected={value === user.id} />
          </CommandItem>
        ))}
      </CommandGroup>
    </AdminCombobox>
  );
}
