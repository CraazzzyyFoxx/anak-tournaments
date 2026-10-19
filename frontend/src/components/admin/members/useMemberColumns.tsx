"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, ChevronsUpDown, Trash2 } from "lucide-react";
import { createKebabColumn } from "@/components/data-table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { cn, initials } from "@/lib/utils";
import type { RbacRole } from "@/types/rbac.types";
import type { WorkspaceMember, WorkspaceSystemRole } from "@/types/workspace.types";
import { useTranslations } from "next-intl";

import { SYSTEM_ROLES, memberCustomRoleIds, memberLabel, memberPrimaryRole } from "./model";

export function useMemberColumns({
  canUpdateMembers,
  canDeleteMembers,
  customScopedRoles,
  changePrimaryRole,
  toggleCustomRole,
  requestRemoval
}: Readonly<{
  canUpdateMembers: boolean;
  canDeleteMembers: boolean;
  customScopedRoles: RbacRole[];
  changePrimaryRole: (member: WorkspaceMember, nextRole: WorkspaceSystemRole) => void;
  toggleCustomRole: (member: WorkspaceMember, roleId: number) => void;
  requestRemoval: (member: WorkspaceMember) => void;
}>): ColumnDef<WorkspaceMember>[] {
  const t = useTranslations("adminAccess.common");
  const tm = useTranslations("adminAccess.member");

  return useMemo<ColumnDef<WorkspaceMember>[]>(() => {
    const cols: ColumnDef<WorkspaceMember>[] = [
      {
        id: "user",
        header: t("user"),
        enableSorting: true,
        cell: ({ row }) => {
          const member = row.original;
          return (
            <div className="flex items-center gap-3 min-w-0">
              <Avatar className="size-8 shrink-0">
                {member.avatar_url ? <AvatarImage src={member.avatar_url} alt="" /> : null}
                <AvatarFallback className="text-xs">{initials(memberLabel(member))}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {member.username ?? `User #${member.auth_user_id}`}
                </p>
                {member.email ? (
                  <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                ) : null}
              </div>
            </div>
          );
        }
      },
      {
        id: "role",
        header: t("role"),
        size: 340,
        enableSorting: true,
        // Editing stays in the cell -- the one deliberate exception to "details
        // go in a dialog or an inspector": two fields, and changing a role is
        // the whole reason this screen is opened.
        cell: ({ row }) => {
          const member = row.original;
          const customCount = memberCustomRoleIds(member).length;
          if (!canUpdateMembers) {
            return (
              <div className="flex flex-wrap gap-1.5">
                {member.rbac_roles.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{t("noRoles")}</span>
                ) : (
                  member.rbac_roles.map((role) => (
                    <Badge key={role.id} variant="outline" className="text-xs">
                      {role.name}
                    </Badge>
                  ))
                )}
              </div>
            );
          }
          return (
            <div className="flex items-center gap-2">
              <Select
                value={memberPrimaryRole(member)}
                onValueChange={(value) => changePrimaryRole(member, value as WorkspaceSystemRole)}
              >
                <SelectTrigger
                  className="h-8 w-32 text-sm"
                  aria-label={tm("userRole", { member: memberLabel(member) })}
                >
                  <SelectValue placeholder={t("noRole")} />
                </SelectTrigger>
                <SelectContent>
                  {SYSTEM_ROLES.map((name) => (
                    <SelectItem key={name} value={name} className="text-sm">
                      {tm(`${name}Role`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {customScopedRoles.length > 0 ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1 text-xs"
                      aria-label={tm("customRoles", { member: memberLabel(member) })}
                    >
                      {tm("custom")}
                      {customCount > 0 ? (
                        <Badge
                          variant="secondary"
                          className="ml-0.5 h-4 px-1 text-xs tabular-nums"
                        >
                          {customCount}
                        </Badge>
                      ) : null}
                      <ChevronsUpDown aria-hidden className="size-3 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-0" align="start">
                    <Command>
                      <CommandInput placeholder={tm("searchCustomRoles")} />
                      <CommandList>
                        <CommandEmpty>{t("noCustomRoles")}</CommandEmpty>
                        <CommandGroup>
                          {customScopedRoles.map((role) => {
                            const checked = memberCustomRoleIds(member).includes(role.id);
                            return (
                              <CommandItem
                                key={role.id}
                                value={role.name}
                                onSelect={() => toggleCustomRole(member, role.id)}
                              >
                                <Check
                                  aria-hidden
                                  className={cn(
                                    "mr-2 size-4",
                                    checked ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                <div className="min-w-0">
                                  <p className="truncate">{role.name}</p>
                                  {role.description ? (
                                    <p className="truncate text-xs text-muted-foreground">
                                      {role.description}
                                    </p>
                                  ) : null}
                                </div>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              ) : null}
            </div>
          );
        }
      }
    ];

    cols.push(
      createKebabColumn<WorkspaceMember>(
        (member) => [
          {
            label: tm("remove"),
            icon: Trash2,
            destructive: true,
            hidden: !canDeleteMembers,
            onSelect: () => requestRemoval(member)
          }
        ],
        { rowLabel: memberLabel }
      )
    );
    return cols;
  }, [
    canUpdateMembers,
    canDeleteMembers,
    customScopedRoles,
    changePrimaryRole,
    toggleCustomRole,
    requestRemoval,
    t,
    tm
  ]);
}
