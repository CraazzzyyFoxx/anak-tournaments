"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { BalancerApplication } from "@/types/balancer-admin.types";

type ApplicationComboboxProps = {
  applications: BalancerApplication[];
  onAdd: (application: BalancerApplication) => void;
  disabled?: boolean;
};

function formatApplicationLabel(application: BalancerApplication): string {
  const roles = [application.primary_role, ...application.additional_roles_json].filter(Boolean).join(" / ");
  return roles ? `${application.battle_tag} · ${roles}` : application.battle_tag;
}

export function ApplicationCombobox({ applications, onAdd, disabled = false }: ApplicationComboboxProps) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchValue, setSearchValue] = useState("");

  const selectableApplications = useMemo(
    () => applications.filter((application) => application.is_active && application.player === null),
    [applications],
  );

  const selectedApplication = selectableApplications.find((application) => application.id === selectedId) ?? null;

  return (
    <div className="flex gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="flex-1 justify-between"
          >
            <span className="truncate">{selectedApplication ? formatApplicationLabel(selectedApplication) : "Find application"}</span>
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[420px] p-0">
          <Command>
            <CommandInput value={searchValue} onValueChange={setSearchValue} placeholder="Search BattleTag / Discord / Twitch" />
            <CommandList>
              <CommandEmpty>No applications found.</CommandEmpty>
              <CommandGroup>
                {selectableApplications.map((application) => {
                  const selected = application.id === selectedId;
                  return (
                    <CommandItem
                      key={application.id}
                      value={`${application.battle_tag} ${application.discord_nick ?? ""} ${application.twitch_nick ?? ""}`}
                      onSelect={() => {
                        setSelectedId(application.id);
                        setOpen(false);
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{application.battle_tag}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[application.primary_role, ...application.additional_roles_json].filter(Boolean).join(" / ") || "No roles yet"}
                        </div>
                      </div>
                      <Check className={cn("ml-2 h-4 w-4", selected ? "opacity-100" : "opacity-0")} />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Button
        type="button"
        onClick={() => {
          if (!selectedApplication) {
            return;
          }
          onAdd(selectedApplication);
          setSelectedId(null);
          setSearchValue("");
        }}
        disabled={!selectedApplication || disabled}
      >
        <Plus className="mr-2 h-4 w-4" />
        Add player
      </Button>
    </div>
  );
}
