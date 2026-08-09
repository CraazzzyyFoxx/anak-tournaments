"use client";

import React from "react";
import { RefreshCw, Code2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { useDiscordRoles } from "@/hooks/useDiscordEntities";
import { DiscordRole } from "@/types/discord.types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface DiscordRoleSelectProps {
  workspaceId: number | null | undefined;
  value: string;
  onChange: (roleId: string) => void;
  onRoleNameSelected?: (roleName: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Accessible name for the control. Rows of these carry no visible label of
   *  their own, so the caller has to name them. */
  ariaLabel?: string;
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
  className,
}: DiscordRoleSelectProps) {
  const t = useTranslations("discord.role");
  const { data, isLoading, refetch } = useDiscordRoles(workspaceId);
  const [manualMode, setManualMode] = React.useState(false);

  const roles: DiscordRole[] = data?.roles ?? [];
  const hasRoles = roles.length > 0;

  const handleSelectRole = (selectedRoleId: string) => {
    onChange(selectedRoleId);
    if (onRoleNameSelected) {
      const selectedRole = roles.find((r) => r.id === selectedRoleId);
      if (selectedRole && selectedRole.name !== "@everyone") {
        onRoleNameSelected(selectedRole.name);
      }
    }
  };

  // `className` lands on the WRAPPER, not on the trigger: this component renders
  // a row -- control plus one or two buttons -- into the caller's flex layout, so
  // the wrapper is the thing that has to carry their `flex-1`. Sizing the trigger
  // instead left the wrapper on `w-full`, which claimed the whole row and
  // stretched the trigger, and with it the popup, across the entire card.
  //
  // Manual entry is the only way out when our bot cannot read the guild, so it
  // stays reachable -- but it is the fallback, never the advertised workflow.
  if (manualMode || (!isLoading && !hasRoles)) {
    return (
      <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
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
            className="h-8 px-2 text-xs"
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
      <Select value={value} onValueChange={handleSelectRole} disabled={disabled || isLoading}>
        <SelectTrigger className="h-8 w-full min-w-0" aria-label={ariaLabel}>
          <SelectValue placeholder={isLoading ? t("loading") : (placeholder ?? t("placeholder"))}>
            {(() => {
              const matched = roles.find((r) => r.id === value);
              if (matched) {
                return (
                  <div className="flex items-center gap-2 truncate">
                    <RoleDot color={matched.color} />
                    <span className="truncate">{matched.name}</span>
                  </div>
                );
              }
              return value ? <span className="font-mono text-xs">{value}</span> : null;
            })()}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {roles.map((role) => (
            <SelectItem key={role.id} value={role.id}>
              <div className="flex w-full items-center gap-2">
                <RoleDot color={role.color} />
                <span className="font-medium">{role.name}</span>
                {role.managed && (
                  <span className="ms-auto rounded bg-muted px-1 py-0.5 font-mono text-xs uppercase text-muted-foreground">
                    {t("managed")}
                  </span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
