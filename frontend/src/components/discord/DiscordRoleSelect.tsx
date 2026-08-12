"use client";

import React from "react";
import { Code2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";

import { AdminCombobox, AdminComboboxCheck } from "@/components/admin/AdminCombobox";
import { Button } from "@/components/ui/button";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { useDiscordRoles } from "@/hooks/useDiscordEntities";
import { cn } from "@/lib/utils";
import { DiscordRole } from "@/types/discord.types";

export interface DiscordRoleSelectProps {
  workspaceId: number | null | undefined;
  value: string;
  onChange: (roleId: string) => void;
  onRoleNameSelected?: (roleName: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Accessible name for the manual ID field, which has no visible label. */
  ariaLabel?: string;
  /** Id of the visible label, when there is one. */
  id?: string;
  className?: string;
}

/** Discord ships a per-role hex, which is real data and belongs inline. Anything
 *  else is not a colour we will hand to `style`, so it falls back to a token. */
function RoleDot({ color }: { color: string | null | undefined }) {
  const hex = color && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : null;
  return (
    <span
      aria-hidden
      className={cn("size-2.5 shrink-0 rounded-full", hex ? undefined : "bg-muted-foreground/40")}
      style={hex ? { backgroundColor: hex } : undefined}
    />
  );
}

export function DiscordRoleSelect({
  workspaceId,
  value,
  onChange,
  onRoleNameSelected,
  disabled,
  placeholder,
  ariaLabel,
  id,
  className,
}: DiscordRoleSelectProps) {
  const t = useTranslations("discord.role");
  const { data, isLoading, refetch } = useDiscordRoles(workspaceId);
  const [manualMode, setManualMode] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const roles: DiscordRole[] = data?.roles ?? [];
  const hasRoles = roles.length > 0;
  const selected = roles.find((role) => role.id === value);

  const pick = (role: DiscordRole) => {
    onChange(role.id);
    // `@everyone` is every member, so adopting it as a tier label would name the
    // tier after the absence of a role.
    if (role.name !== "@everyone") onRoleNameSelected?.(role.name);
    setOpen(false);
    setSearch("");
  };

  // `className` lands on the WRAPPER, not on the trigger: this renders a row --
  // control plus one or two buttons -- into the caller's flex layout, so the
  // wrapper is what has to carry their width.
  //
  // Manual entry is the only way out when our bot cannot read the guild, so it
  // stays reachable -- but it is the fallback, never the advertised workflow.
  if (manualMode || (!isLoading && !hasRoles)) {
    return (
      <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
          disabled={disabled}
          aria-label={ariaLabel ?? t("idAria")}
          placeholder="123456789012345678"
          inputMode="numeric"
          autoComplete="off"
          maxLength={19}
          className="h-8 w-full min-w-0 font-mono"
        />
        {hasRoles && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 px-2 text-xs"
            onClick={() => setManualMode(false)}
          >
            {t("dropdown")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <AdminCombobox
        id={id}
        open={open}
        onOpenChange={setOpen}
        disabled={disabled || isLoading}
        triggerClassName="h-8 min-w-0 border-input bg-transparent text-sm hover:bg-transparent"
        // The trigger names itself from its content: the chosen role once there
        // is one, the purpose while there is not. An aria-label here would
        // override that and hide which role is selected.
        label={
          selected ? (
            <span className="flex items-center gap-2 truncate">
              <RoleDot color={selected.color} />
              <span className="truncate">{selected.name}</span>
            </span>
          ) : value ? (
            // A stored role the guild no longer returns: the id is all we know.
            <span className="font-mono text-xs">{value}</span>
          ) : isLoading ? (
            t("loading")
          ) : (
            (placeholder ?? t("placeholder"))
          )
        }
        labelTitle={selected?.name ?? value ?? undefined}
        searchValue={search}
        onSearchValueChange={setSearch}
        searchPlaceholder={t("searchPlaceholder")}
        searchLabel={t("searchLabel")}
        emptyMessage={t("empty")}
      >
        <CommandGroup>
          {roles.map((role) => (
            // The id joins the search text so a pasted snowflake still finds it.
            <CommandItem
              key={role.id}
              value={`${role.name} ${role.id}`}
              onSelect={() => pick(role)}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <RoleDot color={role.color} />
                <span className="truncate font-medium">{role.name}</span>
                {role.managed && (
                  <span className="ms-auto shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-xs uppercase text-muted-foreground">
                    {t("managed")}
                  </span>
                )}
              </span>
              <AdminComboboxCheck selected={role.id === value} />
            </CommandItem>
          ))}
        </CommandGroup>
      </AdminCombobox>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => refetch()}
        disabled={isLoading}
        aria-label={t("refresh")}
        title={t("refresh")}
      >
        <RefreshCw
          aria-hidden
          className={cn("size-3.5", isLoading && "animate-spin motion-reduce:animate-none")}
        />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => setManualMode(true)}
        aria-label={t("manual")}
        title={t("manual")}
      >
        <Code2 aria-hidden className="size-3.5" />
      </Button>
    </div>
  );
}
