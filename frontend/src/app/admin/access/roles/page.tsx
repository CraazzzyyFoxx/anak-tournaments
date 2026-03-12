"use client";

import { useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Pencil, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { hasUnsavedChanges } from "@/lib/form-change";
import { paginateResults } from "@/lib/paginate-results";
import { rbacService } from "@/services/rbac.service";
import type { RbacRole, UpsertRolePayload } from "@/types/rbac.types";

const PAGE_SIZE = 15;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

const emptyRoleForm: UpsertRolePayload = {
  name: "",
  description: "",
  permission_ids: [],
};

export default function AccessAdminRolesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canReadPermissions = hasPermission("permission.read");
  const canCreateRole = hasPermission("role.create") && canReadPermissions;
  const canUpdateRole = hasPermission("role.update") && canReadPermissions;
  const canDeleteRole = hasPermission("role.delete");

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<number | null>(null);
  const [deletingRole, setDeletingRole] = useState<RbacRole | null>(null);
  const [formData, setFormData] = useState<UpsertRolePayload>(emptyRoleForm);

  const permissionsQuery = useQuery({
    queryKey: ["access-admin", "permissions", "all"],
    queryFn: () => rbacService.listPermissions(),
    enabled: canReadPermissions && (createDialogOpen || editingRoleId !== null),
  });

  const roleDetailQuery = useQuery({
    queryKey: ["access-admin", "roles", editingRoleId],
    queryFn: () => rbacService.getRole(editingRoleId as number),
    enabled: editingRoleId !== null,
  });

  useEffect(() => {
    if (editingRoleId === null) {
      setFormData(emptyRoleForm);
      return;
    }

    if (!roleDetailQuery.data) {
      return;
    }

    setFormData({
      name: roleDetailQuery.data.name,
      description: roleDetailQuery.data.description || "",
      permission_ids: roleDetailQuery.data.permissions.map((permission) => permission.id),
    });
  }, [editingRoleId, roleDetailQuery.data]);

  const createRoleMutation = useMutation({
    mutationFn: (payload: UpsertRolePayload) => rbacService.createRole(payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["access-admin", "roles"] }),
        queryClient.invalidateQueries({ queryKey: ["access-admin", "permissions"] }),
      ]);
      setCreateDialogOpen(false);
      setFormData(emptyRoleForm);
      toast({ title: "Role created" });
    },
    onError: (error) => {
      toast({ title: "Error", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<UpsertRolePayload> }) =>
      rbacService.updateRole(id, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["access-admin", "roles"] }),
        queryClient.invalidateQueries({ queryKey: ["access-admin", "users"] }),
      ]);
      setEditingRoleId(null);
      setFormData(emptyRoleForm);
      toast({ title: "Role updated" });
    },
    onError: (error) => {
      toast({ title: "Error", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const deleteRoleMutation = useMutation({
    mutationFn: (roleId: number) => rbacService.deleteRole(roleId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["access-admin", "roles"] }),
        queryClient.invalidateQueries({ queryKey: ["access-admin", "users"] }),
      ]);
      setDeletingRole(null);
      toast({ title: "Role deleted" });
    },
    onError: (error) => {
      toast({ title: "Error", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const columns: ColumnDef<RbacRole>[] = [
    {
      accessorKey: "name",
      header: "Role",
    },
    {
      accessorKey: "description",
      header: "Description",
      cell: ({ row }) => row.original.description || <span className="text-muted-foreground">No description</span>,
    },
    {
      id: "system",
      header: "Type",
      cell: ({ row }) =>
        row.original.is_system ? (
          <Badge variant="outline">System</Badge>
        ) : (
          <Badge variant="secondary">Custom</Badge>
        ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const role = row.original;
        if (!canUpdateRole && !canDeleteRole) {
          return null;
        }

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label={`Open actions for role ${role.name}`} variant="ghost" size="icon">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              {canUpdateRole ? (
                <DropdownMenuItem
                  onClick={() => {
                    updateRoleMutation.reset();
                    setEditingRoleId(role.id);
                  }}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
              ) : null}
              {canUpdateRole && canDeleteRole ? <DropdownMenuSeparator /> : null}
              {canDeleteRole ? (
                <DropdownMenuItem
                  className="text-destructive"
                  disabled={role.is_system}
                  onClick={() => setDeletingRole(role)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const groupedPermissions = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof permissionsQuery.data>>();
    for (const permission of permissionsQuery.data ?? []) {
      const current = groups.get(permission.resource) ?? [];
      current.push(permission);
      groups.set(permission.resource, current);
    }
    return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [permissionsQuery.data]);

  const isSubmitting = createRoleMutation.isPending || updateRoleMutation.isPending;
  const isEditing = editingRoleId !== null;
  const currentBaseline = isEditing && roleDetailQuery.data
    ? {
        name: roleDetailQuery.data.name,
        description: roleDetailQuery.data.description || "",
        permission_ids: roleDetailQuery.data.permissions.map((permission) => permission.id),
      }
    : emptyRoleForm;
  const isFormDirty = (createDialogOpen || isEditing) && hasUnsavedChanges(formData, currentBaseline);

  const togglePermission = (permissionId: number, checked: boolean) => {
    setFormData((current) => ({
      ...current,
      permission_ids: checked
        ? [...current.permission_ids, permissionId]
        : current.permission_ids.filter((id) => id !== permissionId),
    }));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (isEditing) {
      updateRoleMutation.mutate({ id: editingRoleId, payload: formData });
      return;
    }
    createRoleMutation.mutate(formData);
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Roles"
        description="Create custom roles, inspect protected system roles, and manage permission bundles."
        eyebrow="Access Admin"
        meta={<Badge variant="secondary">RBAC</Badge>}
        actions={
          canCreateRole ? (
            <Button
              onClick={() => {
                createRoleMutation.reset();
                updateRoleMutation.reset();
                setFormData(emptyRoleForm);
                setCreateDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Role
            </Button>
          ) : undefined
        }
      />

      <AdminDataTable
        initialPageSize={PAGE_SIZE}
        pageSizeOptions={[10, 20, 50, 100]}
        queryKey={(page, search, pageSize) => ["access-admin", "roles", page, search, pageSize]}
        queryFn={async (page, search, pageSize) => {
          const roles = await rbacService.listRoles();
          const filteredRoles = search
            ? roles.filter((role) => {
                const haystack = `${role.name} ${role.description || ""}`.toLowerCase();
                return haystack.includes(search.toLowerCase());
              })
            : roles;
          return paginateResults(filteredRoles, page, pageSize);
        }}
        columns={columns}
        searchPlaceholder="Search roles..."
        emptyMessage="No roles found."
        onRowDoubleClick={
          canUpdateRole
            ? (row) => {
                updateRoleMutation.reset();
                setEditingRoleId(row.original.id);
              }
            : undefined
        }
      />

      <EntityFormDialog
        open={createDialogOpen || isEditing}
        onOpenChange={(open) => {
          if (!open) {
            setCreateDialogOpen(false);
            setEditingRoleId(null);
            setFormData(emptyRoleForm);
          }
        }}
        title={isEditing ? "Edit Role" : "Create Role"}
        description={
          isEditing
            ? "Update role metadata and its permission bundle."
            : "Create a new custom role and attach explicit permissions."
        }
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        submittingLabel={isEditing ? "Updating role…" : "Creating role…"}
        errorMessage={
          (isEditing ? updateRoleMutation.error : createRoleMutation.error) instanceof Error
            ? (isEditing ? updateRoleMutation.error : createRoleMutation.error)?.message
            : undefined
        }
        isDirty={isFormDirty}
      >
        <div className="space-y-5">
          {roleDetailQuery.data?.is_system ? (
            <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>System roles are protected. Some edits may be rejected by the API.</span>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="role-name">Name</Label>
            <Input
              id="role-name"
              value={formData.name}
              onChange={(event) => setFormData((current) => ({ ...current, name: event.target.value }))}
              placeholder="support_admin"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role-description">Description</Label>
            <Input
              id="role-description"
              value={formData.description || ""}
              onChange={(event) => setFormData((current) => ({ ...current, description: event.target.value }))}
              placeholder="Describe what this role is allowed to do"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Permission Matrix</Label>
              <Badge variant="outline">{formData.permission_ids.length} selected</Badge>
            </div>
            <ScrollArea className="h-80 rounded-md border border-border/60 p-4">
              <div className="space-y-5">
                {groupedPermissions.map(([resource, permissions]) => (
                  <div key={resource} className="space-y-3">
                    <div>
                      <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        {resource}
                      </p>
                    </div>
                    <div className="space-y-3">
                      {permissions?.map((permission) => {
                        const checked = formData.permission_ids.includes(permission.id);
                        return (
                          <label
                            key={permission.id}
                            className="flex cursor-pointer items-start gap-3 rounded-md border border-border/50 p-3"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(value) => togglePermission(permission.id, value === true)}
                            />
                            <div className="space-y-1">
                              <p className="text-sm font-medium">{permission.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {permission.description || `${permission.resource}.${permission.action}`}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>
      </EntityFormDialog>

      {deletingRole ? (
        <DeleteConfirmDialog
          open={!!deletingRole}
          onOpenChange={(open) => !open && setDeletingRole(null)}
          onConfirm={() => deleteRoleMutation.mutate(deletingRole.id)}
          isDeleting={deleteRoleMutation.isPending}
          title={`Delete role ${deletingRole.name}?`}
          description="This removes the role definition. Users currently assigned to it will lose the access granted by this role."
        />
      ) : null}
    </div>
  );
}
