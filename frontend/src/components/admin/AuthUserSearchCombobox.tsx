"use client";

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";

import { rbacService } from "@/services/rbac.service";
import { AdminCombobox, AdminComboboxCheck } from "@/components/admin/AdminCombobox";
import { CommandGroup, CommandItem } from "@/components/ui/command";

export interface AuthUserOption {
  id: number;
  label: string;
}

interface AuthUserSearchComboboxProps {
  id?: string;
  value?: number;
  selectedLabel?: string;
  onSelect: (user: AuthUserOption | undefined) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
}

/** Server-side search over auth (AuthUser) accounts, for linking a player to
 *  one. Mirrors UserSearchCombobox, but that searches player identities; this
 *  hits rbacService.listUsers (email/username). */
export function AuthUserSearchCombobox({
  id,
  value,
  selectedLabel,
  onSelect,
  placeholder = "Select auth account",
  searchPlaceholder = "Search by email or username…",
  disabled = false
}: AuthUserSearchComboboxProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [debouncedSearch] = useDebounce(searchValue, 250);

  const normalizedQuery = debouncedSearch.trim();
  const shouldSearch = normalizedQuery.length >= 2;

  const usersQuery = useQuery({
    queryKey: ["auth-users-search", normalizedQuery],
    enabled: open && shouldSearch,
    queryFn: () => rbacService.listUsers({ search: normalizedQuery, per_page: 20 }),
    staleTime: 60 * 1000
  });
  const results = usersQuery.data?.results ?? [];

  const label =
    selectedLabel ?? (typeof value === "number" && value > 0 ? `User #${value}` : placeholder);

  const handleSelect = useCallback(
    (user: AuthUserOption | undefined) => {
      onSelect(user);
      setOpen(false);
      setSearchValue("");
    },
    [onSelect]
  );

  const emptyMessage = usersQuery.isFetching
    ? "Loading accounts…"
    : usersQuery.isError
      ? "Could not load accounts. Try again."
      : !shouldSearch
        ? "Type at least 2 characters to search."
        : "No accounts match that email or username.";

  return (
    <AdminCombobox
      id={id}
      open={open}
      onOpenChange={setOpen}
      label={label}
      disabled={disabled}
      searchValue={searchValue}
      onSearchValueChange={setSearchValue}
      searchPlaceholder={searchPlaceholder}
      emptyMessage={emptyMessage}
      // Results are already server-filtered; don't let cmdk re-filter them out.
      shouldFilter={false}
      clear={
        typeof value === "number" && value > 0
          ? {
              label: "Clear selection",
              value: "clear-auth-user-selection",
              onSelect: () => handleSelect(undefined)
            }
          : undefined
      }
    >
      <CommandGroup>
        {results.map((user) => (
          <CommandItem
            key={user.id}
            value={`${user.username} ${user.email} ${user.id}`}
            onSelect={() => handleSelect({ id: user.id, label: user.username })}
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{user.username}</span>
              <span className="truncate text-xs text-muted-foreground">{user.email}</span>
            </div>
            <AdminComboboxCheck selected={value === user.id} />
          </CommandItem>
        ))}
      </CommandGroup>
    </AdminCombobox>
  );
}
