"use client";

import { useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Shield, UserCog } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { paginateResults } from "@/lib/paginate-results";
import { rbacService } from "@/services/rbac.service";
import type { AuthAdminUser } from "@/types/rbac.types";

const PAGE_SIZE = 15;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

export default function AccessAdminUsersPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canAssignRoles = hasPermission("role.assign") && hasPermission("role.read");

  const [managingUserId, setManagingUserId] = useState<number | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");

  const rolesQuery = useQuery({
    queryKey: ["access-admin", "roles", "all"],
    queryFn: () => rbacService.listRoles(),
    enabled: canAssignRoles,
  });

  const userDetailQuery = useQuery({
    queryKey: ["access-admin", "users", managingUserId],
    queryFn: () => rbacService.getUser(managingUserId as number),
    enabled: managingUserId !== null,
  });

  const assignRoleMutation = useMutation({
    mutationFn: (payload: { user_id: number; role_id: number }) => rbacService.assignRole(payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["access-admin", "users"] }),
        queryClient.invalidateQueries({ queryKey: ["access-admin", "roles"] }),
        queryClient.invalidateQueries({ queryKey: ["access-admin", "users", managingUserId] }),
      ]);
      setSelectedRoleId("");
      toast({ title: "Role assigned" });
    },
    onError: (error) => {
      toast({ title: "Error", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const removeRoleMutation = useMutation({
    mutationFn: (payload: { user_id: number; role_id: number }) => rbacService.removeRole(payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["access-admin", "users"] }),
        queryClient.invalidateQueries({ queryKey: ["access-admin", "roles"] }),
        queryClient.invalidateQueries({ queryKey: ["access-admin", "users", managingUserId] }),
      ]);
      toast({ title: "Role removed" });
    },
    onError: (error) => {
      toast({ title: "Error", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const columns: ColumnDef<AuthAdminUser>[] = [
    {
      accessorKey: "email",
      header: "Email",
    },
    {
      accessorKey: "username",
      header: "Username",
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const user = row.original;
        return (
          <div className="flex flex-wrap gap-2">
            <Badge variant={user.is_active ? "default" : "secondary"}>
              {user.is_active ? "Active" : "Inactive"}
            </Badge>
            {user.is_verified ? <Badge variant="outline">Verified</Badge> : null}
            {user.is_superuser ? <Badge variant="destructive">Superuser</Badge> : null}
          </div>
        );
      },
    },
    {
      id: "roles",
      header: "Roles",
      cell: ({ row }) => {
        const roles = row.original.roles;
        if (roles.length === 0) {
          return <span className="text-sm text-muted-foreground">No roles</span>;
        }

        return (
          <div className="flex flex-wrap gap-2">
            {roles.map((role) => (
              <Badge key={role.id} variant="secondary">
                {role.name}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setManagingUserId(row.original.id)}>
              <UserCog className="mr-2 h-4 w-4" />
              {canAssignRoles ? "Manage" : "Inspect"}
            </Button>
          </div>
        ),
    },
  ];

  const assignableRoles = useMemo(() => {
    const currentRoleIds = new Set(userDetailQuery.data?.roles.map((role) => role.id) ?? []);
    return (rolesQuery.data ?? []).filter((role) => !currentRoleIds.has(role.id));
  }, [rolesQuery.data, userDetailQuery.data]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Access Users"
        description="Manage auth accounts, review assigned roles, and inspect effective permissions."
        eyebrow="Access Admin"
        meta={<Badge variant="secondary">RBAC</Badge>}
      />

      <AdminDataTable
        queryKey={(page, search) => ["access-admin", "users", page, search]}
        queryFn={async (page, search) => {
          const users = await rbacService.listUsers({ search: search || undefined });
          return paginateResults(users, page, PAGE_SIZE);
        }}
        columns={columns}
        searchPlaceholder="Search auth users..."
        emptyMessage="No auth users found."
      />

      <Dialog
        open={managingUserId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setManagingUserId(null);
            setSelectedRoleId("");
          }
        }}
      >
        <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Manage Access</DialogTitle>
              <DialogDescription>
                {canAssignRoles
                  ? "Assign or remove roles and review effective permissions for this auth account."
                  : "Review assigned roles and effective permissions for this auth account."}
              </DialogDescription>
            </DialogHeader>

          {userDetailQuery.isLoading ? (
            <div className="py-8 text-sm text-muted-foreground">Loading auth user...</div>
          ) : userDetailQuery.data ? (
            <div className="space-y-6">
              <div className="rounded-lg border border-border/60 bg-card/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-lg font-semibold">{userDetailQuery.data.email}</p>
                    <p className="text-sm text-muted-foreground">@{userDetailQuery.data.username}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {userDetailQuery.data.is_superuser ? <Badge variant="destructive">Superuser</Badge> : null}
                    <Badge variant={userDetailQuery.data.is_active ? "default" : "secondary"}>
                      {userDetailQuery.data.is_active ? "Active" : "Inactive"}
                    </Badge>
                    {userDetailQuery.data.is_verified ? <Badge variant="outline">Verified</Badge> : null}
                  </div>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-4 rounded-lg border border-border/60 bg-card/60 p-4">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Assigned Roles
                    </h3>
                  </div>

                  <div className="space-y-3">
                    {userDetailQuery.data.roles.length > 0 ? (
                      userDetailQuery.data.roles.map((role) => (
                        <div
                          key={role.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 p-3"
                        >
                          <div>
                            <p className="font-medium">{role.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {role.description || "No description provided."}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!canAssignRoles || removeRoleMutation.isPending}
                            onClick={() =>
                              removeRoleMutation.mutate({
                                user_id: userDetailQuery.data!.id,
                                role_id: role.id,
                              })
                            }
                          >
                            {canAssignRoles ? "Remove" : "Assigned"}
                          </Button>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">No roles assigned.</p>
                    )}
                  </div>

                  {canAssignRoles ? (
                    <div className="rounded-md border border-dashed border-border p-4">
                      <div className="space-y-3">
                        <p className="text-sm font-medium">Assign another role</p>
                        <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a role" />
                          </SelectTrigger>
                          <SelectContent>
                            {assignableRoles.map((role) => (
                              <SelectItem key={role.id} value={String(role.id)}>
                                {role.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          disabled={!selectedRoleId || assignRoleMutation.isPending}
                          onClick={() =>
                            assignRoleMutation.mutate({
                              user_id: userDetailQuery.data!.id,
                              role_id: Number(selectedRoleId),
                            })
                          }
                        >
                          <Shield className="mr-2 h-4 w-4" />
                          Assign Role
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="space-y-4 rounded-lg border border-border/60 bg-card/60 p-4">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Effective Permissions
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Computed union of all permissions granted by assigned roles.
                    </p>
                  </div>

                  <div className="flex max-h-96 flex-wrap gap-2 overflow-y-auto pr-1">
                    {userDetailQuery.data.effective_permissions.map((permission) => (
                      <Badge key={permission} variant="outline">
                        {permission}
                      </Badge>
                    ))}
                    {userDetailQuery.data.effective_permissions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No effective permissions.</p>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-8 text-sm text-muted-foreground">Unable to load auth user details.</div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setManagingUserId(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
