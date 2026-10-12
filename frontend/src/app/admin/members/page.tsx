"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, ChevronsUpDown, Trash2, UserPlus, Wand2 } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable, createKebabColumn } from "@/components/data-table";
import { FilterBar } from "@/components/kit/FilterBar";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { useFilters, type FilterDef } from "@/components/kit/useFilters";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { notify } from "@/lib/notify";
import { cn, initials } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";
import { rbacService } from "@/services/rbac.service";
import workspaceService from "@/services/workspace.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { RbacRole } from "@/types/rbac.types";
import type { WorkspaceMember, WorkspaceSystemRole } from "@/types/workspace.types";
import { workspaceQueryKeys } from "@/lib/workspace/query-keys";
import { useTranslations } from "next-intl";

const SYSTEM_ROLES: WorkspaceSystemRole[] = ["owner", "admin", "referee", "host", "player"];
function isSystemRoleName(name: string): name is WorkspaceSystemRole {
  return (SYSTEM_ROLES as string[]).includes(name);
}

/** Best human-readable handle for a member, used in control names and confirmations. */
function memberLabel(member: WorkspaceMember): string {
  return member.username ?? member.email ?? `User #${member.auth_user_id}`;
}

/** The custom (non-system) role ids currently held by a member. */
function memberCustomRoleIds(member: WorkspaceMember): number[] {
  return member.rbac_roles.filter((role) => !role.is_system).map((role) => role.id);
}

/**
 * Highest-priority system role a member holds, mirroring the backend's RBAC
 * derivation. `undefined` when the member holds no system role at all -- a real
 * state the "Fill missing roles" action exists to repair.
 */
export function memberPrimaryRole(member: WorkspaceMember): WorkspaceSystemRole | undefined {
  return SYSTEM_ROLES.find((name) =>
    member.rbac_roles.some((role) => role.is_system && role.name === name)
  );
}

export default function WorkspaceMembersPage() {
  const t = useTranslations("adminAccess.common");
  const tw = useTranslations("adminAccess.workspace");
  const tm = useTranslations("adminAccess.member");
  const { isSuperuser, canAccessAnyPermission } = usePermissions();
  const queryClient = useQueryClient();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const getCurrentWorkspace = useWorkspaceStore((s) => s.getCurrentWorkspace);
  const workspace = getCurrentWorkspace();

  const [addOpen, setAddOpen] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<WorkspaceMember | null>(null);

  const canCreateMembers =
    isSuperuser ||
    (currentWorkspaceId !== null &&
      canAccessAnyPermission(["workspace_member.create"], currentWorkspaceId));
  const canUpdateMembers =
    isSuperuser ||
    (currentWorkspaceId !== null &&
      canAccessAnyPermission(["workspace_member.update"], currentWorkspaceId));
  const canDeleteMembers =
    isSuperuser ||
    (currentWorkspaceId !== null &&
      canAccessAnyPermission(["workspace_member.delete"], currentWorkspaceId));

  const { data: scopedRoles } = useQuery({
    queryKey: workspaceQueryKeys.rbacRoles(currentWorkspaceId),
    queryFn: () =>
      currentWorkspaceId
        ? rbacService.listRolesAll({ workspace_id: currentWorkspaceId })
        : Promise.resolve([]),
    enabled: !!currentWorkspaceId && (canCreateMembers || canUpdateMembers)
  });

  const systemRoleId = useCallback(
    (name: WorkspaceSystemRole): number | undefined =>
      scopedRoles?.find((role) => role.name === name)?.id,
    [scopedRoles]
  );
  const customScopedRoles: RbacRole[] = useMemo(
    () => (scopedRoles ?? []).filter((role) => !isSystemRoleName(role.name)),
    [scopedRoles]
  );

  // Role chips carry the ids the members endpoint takes. Declared even while
  // the catalogue is still loading, so `?role=` / `?exclude_role=` are read on mount.
  const filterDefs = useMemo<FilterDef[]>(() => {
    const options = (scopedRoles ?? []).map((role) => ({ value: String(role.id), label: role.name }));
    return [
      { key: "role", label: t("role"), kind: "single", options },
      { key: "exclude_role", label: tm("excludeRole"), kind: "multi", options }
    ];
  }, [scopedRoles, t, tm]);
  const filters = useFilters(filterDefs);
  const roleFilter = String(filters.values.role ?? "");
  const excludeRoleIds = Array.isArray(filters.values.exclude_role)
    ? filters.values.exclude_role.map(Number).filter((id) => Number.isInteger(id))
    : [];

  const invalidateMembers = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.memberList(currentWorkspaceId) });
  }, [queryClient, currentWorkspaceId]);

  const updateRolesMutation = useMutation({
    mutationFn: ({ authUserId, roleIds }: { authUserId: number; roleIds: number[] }) =>
      workspaceService.updateMemberRole(currentWorkspaceId!, authUserId, roleIds),
    onSuccess: () => {
      invalidateMembers();
      notify.success(tw("rolesUpdated"));
    },
    onError: (error) => notify.apiError(error)
  });

  const removeMemberMutation = useMutation({
    mutationFn: (authUserId: number) => workspaceService.removeMember(currentWorkspaceId!, authUserId),
    onSuccess: () => {
      invalidateMembers();
      setPendingRemoval(null);
      notify.success(tw("memberRemoved"));
    },
    onError: (error) => notify.apiError(error)
  });

  const autofillMutation = useMutation({
    mutationFn: () => workspaceService.autofillMemberRoles(currentWorkspaceId!),
    onSuccess: ({ assigned }) => {
      invalidateMembers();
      notify.success(
        assigned > 0
          ? tm("assignedPlayer", { count: assigned })
          : tm("everyoneHasRole")
      );
    },
    onError: (error) => notify.apiError(error)
  });

  const changePrimaryRole = useCallback(
    (member: WorkspaceMember, nextRole: WorkspaceSystemRole) => {
      if (nextRole === memberPrimaryRole(member)) return;
      const sysId = systemRoleId(nextRole);
      if (sysId == null) {
        notify.error(tw("roleNotConfigured"));
        return;
      }
      updateRolesMutation.mutate({
        authUserId: member.auth_user_id,
        roleIds: [sysId, ...memberCustomRoleIds(member)]
      });
    },
    [systemRoleId, updateRolesMutation, tw]
  );

  const toggleCustomRole = useCallback(
    (member: WorkspaceMember, roleId: number) => {
      const current = new Set(memberCustomRoleIds(member));
      if (current.has(roleId)) current.delete(roleId);
      else current.add(roleId);
      const primary = memberPrimaryRole(member);
      const sysId = primary != null ? systemRoleId(primary) : undefined;
      updateRolesMutation.mutate({
        authUserId: member.auth_user_id,
        roleIds: [...(sysId != null ? [sysId] : []), ...current]
      });
    },
    [systemRoleId, updateRolesMutation]
  );

  const columns = useMemo<ColumnDef<WorkspaceMember>[]>(() => {
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
            onSelect: () => setPendingRemoval(member)
          }
        ],
        { rowLabel: memberLabel }
      )
    );
    return cols;
  }, [canUpdateMembers, canDeleteMembers, customScopedRoles, changePrimaryRole, toggleCustomRole, t, tm]);

  // Exclusive branch: no workspace selected means the table below never renders,
  // so this header is the page's only `<h1>`.
  if (!currentWorkspaceId) {
    return (
      <div className="flex flex-col gap-6">
        <AdminPageHeader
          title={tw("membersTitle")}
          description={tw("membersDescription")}
        />
      </div>
    );
  }

  const tableActions = (
    <>
      {canUpdateMembers ? (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={autofillMutation.isPending}
          onClick={() => autofillMutation.mutate()}
        >
          <Wand2 aria-hidden className="size-3.5" />
          {tw("fillMissing")}
        </Button>
      ) : null}
      {canCreateMembers ? (
        <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
          <UserPlus aria-hidden className="size-3.5" />
          {t("addMember")}
        </Button>
      ) : null}
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title={tw("membersTitle")}
        description={tw("manageMembers", { workspace: workspace?.name ?? t("thisWorkspace") })}
      />

      <DataTable<WorkspaceMember>
        queryKey={(page, search, pageSize, sortField, sortDir) => [
          "workspace-members",
          currentWorkspaceId,
          { page, search, pageSize, sortField, sortDir, roleId: roleFilter || null, excludeRoleIds }
        ]}
        queryFn={(page, search, pageSize, sortField, sortDir) =>
          workspaceService.getMembers(currentWorkspaceId, {
            page,
            per_page: pageSize,
            search,
            role_id: roleFilter ? Number(roleFilter) : null,
            exclude_role_id: excludeRoleIds,
            sort: sortField === "role" ? "role" : "username",
            order: sortDir
          })
        }
        columns={columns}
        initialPageSize={25}
        searchPlaceholder={t("searchByNameEmail")}
        filterKey={filters.filterKey}
        getRowId={(row) => String(row.auth_user_id)}
        toolbar={<FilterBar defs={filterDefs} filters={filters} />}
        emptyMessage={tw("noMembers")}
        actions={tableActions}
      />

      {canCreateMembers ? (
        <AddMemberDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          workspaceId={currentWorkspaceId}
          systemRoleId={systemRoleId}
          onAdded={() => {
            invalidateMembers();
            setAddOpen(false);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => (open ? null : setPendingRemoval(null))}
        intent={{
          title: t("removeMember"),
          description: pendingRemoval
            ? tm("removeDescription", { member: memberLabel(pendingRemoval), workspace: workspace?.name ?? t("thisWorkspace") })
            : "",
          confirmLabel: t("removeMember"),
          tone: "danger"
        }}
        onConfirm={() => {
          if (pendingRemoval) removeMemberMutation.mutate(pendingRemoval.auth_user_id);
        }}
        pending={removeMemberMutation.isPending}
      />
    </div>
  );
}

function AddMemberDialog({
  open,
  onOpenChange,
  workspaceId,
  systemRoleId,
  onAdded
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: number;
  systemRoleId: (name: WorkspaceSystemRole) => number | undefined;
  onAdded: () => void;
}>) {
  const t = useTranslations("adminAccess.common");
  const tw = useTranslations("adminAccess.workspace");
  const tm = useTranslations("adminAccess.member");
  const userFieldId = useId();
  const roleFieldId = useId();
  const [userId, setUserId] = useState<string>("");
  // One system role, same as the row's role select; custom roles are added from the row.
  const [role, setRole] = useState<WorkspaceSystemRole>("player");
  const [userComboOpen, setUserComboOpen] = useState(false);

  const { data: allUsers } = useQuery({
    queryKey: workspaceQueryKeys.rbacUsersAll(workspaceId),
    queryFn: () => rbacService.listUsersAll({ workspace_id: workspaceId }),
    enabled: open
  });

  const addMemberMutation = useMutation({
    mutationFn: (roleId: number) => workspaceService.addMember(workspaceId, Number(userId), roleId),
    onSuccess: () => {
      setUserId("");
      setRole("player");
      notify.success(tw("memberAdded"));
      onAdded();
    },
    onError: (error) => notify.apiError(error)
  });

  const selectedUsername = allUsers?.find((u) => u.id === Number(userId))?.username;

  // Validated on submit rather than by disabling the button, so the reason the
  // form will not go through is spoken instead of silently greyed out.
  const submit = () => {
    if (!userId) {
      notify.error(tw("pickUser"));
      return;
    }
    const roleId = systemRoleId(role);
    if (roleId == null) {
      notify.error(tw("roleNotConfigured"));
      return;
    }
    addMemberMutation.mutate(roleId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("addMember")}</DialogTitle>
          <DialogDescription>{tm("addDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={userFieldId}>{t("user")}</Label>
            <Popover open={userComboOpen} onOpenChange={setUserComboOpen}>
              <PopoverTrigger asChild>
                <Button
                  id={userFieldId}
                  variant="outline"
                  role="combobox"
                  aria-haspopup="listbox"
                  aria-expanded={userComboOpen}
                  className="justify-between"
                >
                  <span className="truncate">{selectedUsername ?? tm("selectUser")}</span>
                  <ChevronsUpDown aria-hidden className="ml-2 size-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                <Command>
                  <CommandInput placeholder={t("searchUser")} />
                  <CommandList>
                    <CommandEmpty>{t("noUser")}</CommandEmpty>
                    <CommandGroup>
                      {(allUsers ?? []).map((u) => (
                        <CommandItem
                          key={u.id}
                          value={u.username}
                          onSelect={() => {
                            setUserId(String(u.id));
                            setUserComboOpen(false);
                          }}
                        >
                          <Check
                            aria-hidden
                            className={cn(
                              "mr-2 size-4",
                              userId === String(u.id) ? "opacity-100" : "opacity-0"
                            )}
                          />
                          {u.username}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={roleFieldId}>{t("role")}</Label>
            <Select value={role} onValueChange={(value) => setRole(value as WorkspaceSystemRole)}>
              <SelectTrigger id={roleFieldId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SYSTEM_ROLES.map((name) => (
                  <SelectItem key={name} value={name}>
                    {tm(`${name}Role`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={addMemberMutation.isPending}>
            {addMemberMutation.isPending ? tm("adding") : t("addMember")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
