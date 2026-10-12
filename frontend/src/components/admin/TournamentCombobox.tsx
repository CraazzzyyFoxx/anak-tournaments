"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import type { Tournament } from "@/types/tournament.types";
import { Combobox, ComboboxCheck } from "@/components/kit/Combobox";
import { CommandGroup, CommandItem } from "@/components/ui/command";

interface TournamentComboboxProps {
  tournaments: Tournament[];
  value?: number;
  onSelect: (tournament: Tournament | undefined) => void;
  id?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
}

export function TournamentCombobox({
  tournaments,
  value,
  onSelect,
  id,
  placeholder,
  searchPlaceholder,
  disabled = false,
  allowClear = true,
}: Readonly<TournamentComboboxProps>) {
  const t = useTranslations("adminTournaments.combobox");
  placeholder ??= t("all");
  searchPlaceholder ??= t("search");
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  const selected = useMemo(
    () => tournaments.find((t) => t.id === value),
    [tournaments, value],
  );

  // Oldest first; JSON delivers `start_date` as a string despite the `Date` type.
  const sorted = useMemo(
    () =>
      [...tournaments].sort(
        (a, b) =>
          new Date(a.start_date).getTime() - new Date(b.start_date).getTime() || a.id - b.id,
      ),
    [tournaments],
  );

  const selectedLabel = selected ? selected.name : placeholder;

  const handleSelect = useCallback(
    (tournament: Tournament | undefined) => {
      onSelect(tournament);
      setOpen(false);
      setSearchValue("");
    },
    [onSelect],
  );

  return (
    <Combobox
      id={id}
      open={open}
      onOpenChange={setOpen}
      label={selectedLabel}
      disabled={disabled}
      searchValue={searchValue}
      onSearchValueChange={setSearchValue}
      searchPlaceholder={searchPlaceholder}
      emptyMessage={t("empty")}
      clear={
        allowClear && typeof value === "number"
          ? {
              label: t("clear"),
              value: "clear-tournament-selection",
              onSelect: () => handleSelect(undefined),
            }
          : undefined
      }
    >
      <CommandGroup>
        {sorted.map((tournament) => (
          <CommandItem
            key={tournament.id}
            value={`${tournament.name} ${tournament.id}`}
            onSelect={() => handleSelect(tournament)}
          >
            <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
              <span className="truncate">{tournament.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                #{tournament.id}
              </span>
            </div>
            <ComboboxCheck selected={value === tournament.id} />
          </CommandItem>
        ))}
      </CommandGroup>
    </Combobox>
  );
}
