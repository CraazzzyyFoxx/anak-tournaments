"use client";

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Team } from "@/types/team.types";
import { Check, ChevronsUpDown } from "lucide-react";

export interface TeamComboBoxProps {
  teams: Team[];
  onSelect: (team: Team) => void;
  selectedTeam: string;
}

const TeamComboBox = ({ teams, onSelect, selectedTeam }: TeamComboBoxProps) => {
  const [open, setOpen] = React.useState(false);

  const values: { label: string; value: string }[] = useMemo(() => {
    return teams.map((team) => ({
      label: team.name,
      value: team.name
    }));
  }, [teams]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[250px] justify-between"
        >
          {selectedTeam
            ? values.find((team) => team.value === selectedTeam)?.label
            : "Select team..."}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[250px] p-0">
        <Command>
          <CommandInput placeholder="Search team..." />
          <CommandList>
            <CommandEmpty>No team found.</CommandEmpty>
            <CommandGroup>
              {values.map((team) => (
                <CommandItem
                  key={team.value}
                  value={team.value}
                  onSelect={(currentValue) => {
                    setOpen(false);
                    onSelect(teams.find((t) => t.name === currentValue)!);
                  }}
                >
                  {team.label}
                  <Check
                    className={cn(
                      "ml-auto",
                      selectedTeam === team.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default TeamComboBox;
