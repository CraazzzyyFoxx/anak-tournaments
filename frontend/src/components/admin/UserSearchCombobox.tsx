"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import userService from "@/services/user.service";
import { MinimizedUser } from "@/types/user.types";
import { Combobox, ComboboxCheck } from "@/components/kit/Combobox";
import { useSearchComboboxQuery } from "@/components/kit/useSearchComboboxQuery";
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
  placeholder,
  searchPlaceholder,
  disabled = false,
  allowClear = true,
}: Readonly<UserSearchComboboxProps>) {
  const t = useTranslations("adminPeople.userSearch");
  const resolvedPlaceholder = placeholder ?? t("select");
  const resolvedSearchPlaceholder = searchPlaceholder ?? t("search");
  const {
    open,
    setOpen,
    searchValue,
    setSearchValue,
    results,
    handleSelect,
    emptyMessage
  } = useSearchComboboxQuery<MinimizedUser, MinimizedUser>({
    queryKeyPrefix: ["users-search-minimized"],
    fetchResults: ({ query, signal }) => userService.searchUsers(query, signal),
    onSelect,
    messages: {
      loading: t("loading"),
      error: t("loadError"),
      minChars: t("minChars"),
      empty: t("empty")
    }
  });

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

    return resolvedPlaceholder;
  }, [resolvedPlaceholder, results, selectedName, value]);

  return (
    <Combobox
      id={id}
      open={open}
      onOpenChange={setOpen}
      label={selectedLabel}
      disabled={disabled}
      searchValue={searchValue}
      onSearchValueChange={setSearchValue}
      searchPlaceholder={resolvedSearchPlaceholder}
      emptyMessage={emptyMessage}
      clear={
        allowClear && typeof value === "number" && value > 0
          ? {
              label: t("clear"),
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
            <ComboboxCheck selected={value === user.id} />
          </CommandItem>
        ))}
      </CommandGroup>
    </Combobox>
  );
}
