import React from "react";
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
import { RefreshCw, Code2 } from "lucide-react";

export interface DiscordRoleSelectProps {
  workspaceId: number | null | undefined;
  value: string;
  onChange: (roleId: string) => void;
  onRoleNameSelected?: (roleName: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function DiscordRoleSelect({
  workspaceId,
  value,
  onChange,
  onRoleNameSelected,
  disabled,
  placeholder = "Select Discord role...",
  className,
}: DiscordRoleSelectProps) {
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

  if (manualMode || (!isLoading && !hasRoles)) {
    return (
      <div className="flex items-center gap-1.5 w-full">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="123456789012345678"
          maxLength={19}
          className={className}
        />
        {hasRoles && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={() => setManualMode(false)}
            title="Switch back to role dropdown"
          >
            Dropdown
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 w-full">
      <Select
        value={value}
        onValueChange={handleSelectRole}
        disabled={disabled || isLoading}
      >
        <SelectTrigger className={className}>
          <SelectValue placeholder={isLoading ? "Loading roles..." : placeholder}>
            {(() => {
              const matched = roles.find((r) => r.id === value);
              if (matched) {
                return (
                  <div className="flex items-center gap-2 truncate">
                    <span
                      className="size-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: matched.color || "#a1a1aa" }}
                    />
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
              <div className="flex items-center gap-2 w-full">
                <span
                  className="size-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: role.color || "#a1a1aa" }}
                />
                <span className="font-medium">{role.name}</span>
                {role.managed && (
                  <span className="text-[10px] uppercase font-mono px-1 py-0.5 rounded bg-muted text-muted-foreground ml-auto">
                    managed
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
        title="Refresh roles from Discord"
      >
        <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => setManualMode(true)}
        title="Enter Role ID manually"
      >
        <Code2 className="size-3.5" />
      </Button>
    </div>
  );
}
