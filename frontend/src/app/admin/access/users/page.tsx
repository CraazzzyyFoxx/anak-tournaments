"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ColumnDef } from "@tanstack/react-table";
import {
  BadgeCheck,
  CheckCircle,
  Link2,
  Shield,
  ShieldAlert,
  Trash2,
  UserCog,
  XCircle
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ProviderBadge } from "@/components/admin/OAuthProviderBadge";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { EYEBROW_CLASS, TONE_CLASS } from "@/components/admin/tone";
import { UserDenyEditor } from "./UserDenyEditor";
import { UserSearchCombobox } from "@/components/admin/UserSearchCombobox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissions } from "@/hooks/usePermissions";
import { getSingleLinkedPlayer } from "@/lib/auth-profile-links";
import { notify } from "@/lib/notify";
import { rbacService } from "@/services/rbac.service";
import { useAuthProfileStore } from "@/stores/auth-profile.store";
import type { AuthAdminUser } from "@/types/rbac.types";
import type { MinimizedUser } from "@/types/user.types";

const PAGE_SIZE = 15;

export default function AccessAdminUsersPage() {
  const queryClient = useQueryClient();
  const { hasPermission, isSuperuser, canAccessPermission } = usePermissions();
  const currentUserId = useAuthProfileStore((s) => s.user?.id);
  const canAssignRoles = hasPermission("role.update") && hasPermission("role.read");
  const canManageLinkedPlayers = hasPermission("auth_user.update");
  // Cross-link to /admin/users (D9: the two Users pages stay separate and
  // cross-navigate); gated by the same permission that page requires.
  const canReadPlayerIdentities = canAccessPermission("user.read");

  const [managingUserId, setManagingUserId] = useState<number | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");
  const [selectedAnalyticsUserId, setSelectedAnalyticsUserId] = useState<number | null>(null);
  const [selectedAnalyticsUserName, setSelectedAnalyticsUserName] = useState("");

  const rolesQuery = useQuery({
    queryKey: ["access-admin", "roles", "all"],
    queryFn: () => rbacService.listRolesAll(),
    enabled: canAssignRoles
  });

  const userDetailQuery = useQuery({
    queryKey: ["access-admin", "users", managingUserId],
    queryFn: () => rbacService.getUser(managingUserId as number),
    enabled: managingUserId !== null
  });

  const oauthConnectionsQuery = useQuery({
    queryKey: ["access-admin", "users", managingUserId, "oauth-connections"],
    queryFn: () =>
      rbacService.listOAuthConnections({
        auth_user_id: managingUserId as number,
        per_page: -1
      }),
    enabled: managingUserId !== null
  });

  const assignRoleMutation = useMutation({
    mutationFn: (payload: { user_id: number; role_id: number }) => rbacService.assignRole(payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["access-admin", "users"] }),
        queryClient.invalidateQueries({ queryKey: ["access-admin", "roles"] }),
        queryClient.invalidateQueries({ queryKey: ["access-admin", "users", managingUserId] })
      ]);
      setSelectedRoleId("");
      notify.success("Role assigned");
    }
  });

  const removeRoleMutation = useMutation({
    mutationFn: (payload: { user_id: number; role_id: number }) => rbacService.removeRole(payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["access-admin", "users"] }),
        queryClient.invalidateQueries({ queryKey: ["access-admin", "roles"] }),
        queryClient.invalidateQueries({ queryKey: ["access-admin", "users", managingUserId] })
      ]);
      notify.success("Role removed");
    }
  });

  const assignLinkedPlayerMutation = useMutation({
    mutationFn: (payload: { userId: number; player_id: number; is_primary: boolean }) =>
      rbacService.assignLinkedPlayer(payload.userId, {
        player_id: payload.player_id,
        is_primary: payload.is_primary
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["access-admin", "users"] }),
        queryClient.invalidateQueries({ queryKey: ["access-admin", "users", managingUserId] })
      ]);
      setSelectedAnalyticsUserId(null);
      setSelectedAnalyticsUserName("");
      notify.success("Linked analytics account assigned");
    },
    onError: (error) => notify.apiError(error)
  });

  const removeLinkedPlayerMutation = useMutation({
    mutationFn: (payload: { userId: number; playerId: number }) =>
      rbacService.removeLinkedPlayer(payload.userId, payload.playerId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["access-admin", "users"] }),
        queryClient.invalidateQueries({ queryKey: ["access-admin", "users", managingUserId] })
      ]);
      notify.success("Linked analytics account removed");
    },
    onError: (error) => notify.apiError(error)
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId: number) => rbacService.deleteUser(userId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["access-admin", "users"] });
      setManagingUserId(null);
      notify.success("Account deleted");
    },
    onError: (error) => notify.apiError(error)
  });

  const columns: ColumnDef<AuthAdminUser>[] = [
    {
      accessorKey: "email",
      header: "Email"
    },
    {
      accessorKey: "username",
      header: "Username"
    },
    {
      id: "linkedPlayers",
      header: "Linked account",
      cell: ({ row }) => {
        const linkedPlayer = getSingleLinkedPlayer(row.original.linked_players);
        if (!linkedPlayer) {
          return <span className="text-sm text-muted-foreground">Not linked</span>;
        }
        if (!canReadPlayerIdentities) {
          return <Badge variant="default">{linkedPlayer.player_name}</Badge>;
        }

        return (
          <Link
            href={`/admin/users?search=${encodeURIComponent(linkedPlayer.player_name)}`}
            className="inline-flex"
            title="Open in Player identities"
            onClick={(e) => e.stopPropagation()}
          >
            <Badge variant="default" className="hover:underline">
              {linkedPlayer.player_name}
            </Badge>
          </Link>
        );
      }
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const user = row.original;
        return (
          <div className="flex flex-wrap gap-2">
            {user.is_active ? (
              <StatusIcon icon={CheckCircle} label="Active" variant="success" />
            ) : (
              <StatusIcon icon={XCircle} label="Inactive" variant="muted" />
            )}
            {user.is_verified ? (
              <StatusIcon icon={BadgeCheck} label="Verified" variant="info" />
            ) : null}
            {user.is_superuser ? (
              <StatusIcon icon={ShieldAlert} label="Superuser" variant="destructive" />
            ) : null}
          </div>
        );
      }
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
      }
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setManagingUserId(row.original.id)}>
            <UserCog aria-hidden className="mr-2 h-4 w-4" />
            {canAssignRoles ? "Manage access" : "View access"}
          </Button>
        </div>
      )
    }
  ];

  const assignableRoles = useMemo(() => {
    const currentRoleIds = new Set(userDetailQuery.data?.roles.map((role) => role.id) ?? []);
    return (rolesQuery.data ?? []).filter((role) => !currentRoleIds.has(role.id));
  }, [rolesQuery.data, userDetailQuery.data]);

  const linkedPlayer = getSingleLinkedPlayer(userDetailQuery.data?.linked_players);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Access users"
        description="Manage auth accounts, review assigned roles, and inspect effective permissions."
        meta={<Badge variant="secondary">RBAC</Badge>}
      />

      <AdminDataTable
        initialPageSize={PAGE_SIZE}
        pageSizeOptions={[10, 20, 50, 100]}
        queryKey={(page, search, pageSize, sortField, sortDir) => [
          "access-admin",
          "users",
          page,
          search,
          pageSize,
          sortField,
          sortDir
        ]}
        queryFn={(page, search, pageSize, sortField, sortDir) =>
          rbacService.listUsers({
            page,
            per_page: pageSize,
            sort: sortField ?? undefined,
            order: sortDir,
            search: search || undefined
          })
        }
        columns={columns}
        searchPlaceholder="Search auth users…"
        emptyMessage="No auth accounts match this search. Clear the search box to see every account."
        onRowDoubleClick={(row) => setManagingUserId(row.original.id)}
      />

      <Dialog
        open={managingUserId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setManagingUserId(null);
            setSelectedRoleId("");
            setSelectedAnalyticsUserId(null);
            setSelectedAnalyticsUserName("");
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Manage access</DialogTitle>
            <DialogDescription>
              {canAssignRoles
                ? "Assign roles, manage linked analytics accounts, and review effective permissions for this auth account."
                : "Review linked analytics accounts, assigned roles, and effective permissions for this auth account."}
            </DialogDescription>
          </DialogHeader>

          {userDetailQuery.isLoading ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : userDetailQuery.data ? (
            <div className="space-y-6">
              <div className="rounded-lg border border-border/60 bg-card/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-lg font-semibold">{userDetailQuery.data.email}</p>
                    <p className="text-sm text-muted-foreground">
                      @{userDetailQuery.data.username}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {userDetailQuery.data.is_superuser ? (
                      <StatusIcon icon={ShieldAlert} label="Superuser" variant="destructive" />
                    ) : null}
                    {userDetailQuery.data.is_active ? (
                      <StatusIcon icon={CheckCircle} label="Active" variant="success" />
                    ) : (
                      <StatusIcon icon={XCircle} label="Inactive" variant="muted" />
                    )}
                    {userDetailQuery.data.is_verified ? (
                      <StatusIcon icon={BadgeCheck} label="Verified" variant="info" />
                    ) : null}
                  </div>
                </div>
              </div>

              <Tabs key={userDetailQuery.data.id} defaultValue="roles" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="roles">Roles</TabsTrigger>
                  <TabsTrigger value="player">Player</TabsTrigger>
                  <TabsTrigger value="oauth">OAuth</TabsTrigger>
                  <TabsTrigger value="permissions">Permissions</TabsTrigger>
                </TabsList>

                <TabsContent value="roles" className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
                  <div className="space-y-4 rounded-lg border border-border/60 bg-card/60 p-4">
                    <h3 className={EYEBROW_CLASS}>Assigned roles</h3>

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
                            {canAssignRoles ? (
                              <Button
                                variant="outline"
                                size="sm"
                                aria-label={`Remove role ${role.name} from this account`}
                                disabled={removeRoleMutation.isPending}
                                onClick={() =>
                                  removeRoleMutation.mutate({
                                    user_id: userDetailQuery.data!.id,
                                    role_id: role.id
                                  })
                                }
                              >
                                Remove role
                              </Button>
                            ) : null}
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No roles assigned. This account only has the permissions every signed-in
                          user gets.
                        </p>
                      )}
                    </div>

                    {canAssignRoles ? (
                      <div className="space-y-3 rounded-md border border-dashed border-border p-4">
                        <Label htmlFor="assign-role">Assign another role</Label>
                        <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
                          <SelectTrigger id="assign-role">
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
                          disabled={assignRoleMutation.isPending}
                          onClick={() => {
                            if (!selectedRoleId) {
                              notify.error("Pick a role first.", {
                                description: "Choose a role from the list, then assign it."
                              });
                              return;
                            }
                            assignRoleMutation.mutate({
                              user_id: userDetailQuery.data!.id,
                              role_id: Number(selectedRoleId)
                            });
                          }}
                        >
                          <Shield aria-hidden className="mr-2 h-4 w-4" />
                          Assign role
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </TabsContent>

                <TabsContent value="player" className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
                  <div className="space-y-4 rounded-lg border border-border/60 bg-card/60 p-4">
                    <div>
                      <h3 className={EYEBROW_CLASS}>Linked player account</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        The `players.user` record owned by this auth account (at most one).
                      </p>
                    </div>

                    <div className="space-y-3">
                      {linkedPlayer ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 p-3">
                          <div>
                            <p className="font-medium">{linkedPlayer.player_name}</p>
                            <p className="text-sm tabular-nums text-muted-foreground">
                              Player ID: {linkedPlayer.player_id}
                            </p>
                            {canReadPlayerIdentities ? (
                              <Link
                                href={`/admin/users?search=${encodeURIComponent(linkedPlayer.player_name)}`}
                                className="mt-1 inline-flex items-center gap-1 text-sm text-primary hover:underline"
                              >
                                <Link2 aria-hidden className="h-3.5 w-3.5" />
                                Open in Player identities
                              </Link>
                            ) : null}
                          </div>
                          {canManageLinkedPlayers ? (
                            <Button
                              variant="outline"
                              size="sm"
                              aria-label={`Unlink player ${linkedPlayer.player_name} from this account`}
                              disabled={removeLinkedPlayerMutation.isPending}
                              onClick={() =>
                                removeLinkedPlayerMutation.mutate({
                                  userId: userDetailQuery.data!.id,
                                  playerId: linkedPlayer.player_id
                                })
                              }
                            >
                              <Trash2 aria-hidden className="mr-2 h-4 w-4" />
                              Unlink player
                            </Button>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No linked player account
                          {canManageLinkedPlayers
                            ? ". Assign one below to connect this login to its tournament history."
                            : "."}
                        </p>
                      )}
                    </div>

                    {canManageLinkedPlayers && !linkedPlayer ? (
                      <div className="space-y-3 rounded-md border border-dashed border-border p-4">
                        <Label htmlFor="assign-analytics-account">Assign analytics account</Label>
                        <UserSearchCombobox
                          id="assign-analytics-account"
                          value={selectedAnalyticsUserId ?? undefined}
                          selectedName={selectedAnalyticsUserName || undefined}
                          placeholder="Select analytics account"
                          searchPlaceholder="Search analytics account…"
                          onSelect={(user: MinimizedUser | undefined) => {
                            setSelectedAnalyticsUserId(user?.id ?? null);
                            setSelectedAnalyticsUserName(user?.name ?? "");
                          }}
                        />
                        <Button
                          disabled={assignLinkedPlayerMutation.isPending}
                          onClick={() => {
                            if (selectedAnalyticsUserId == null) {
                              notify.error("Pick an analytics account first.", {
                                description:
                                  "Search for the player this login belongs to, then assign it."
                              });
                              return;
                            }
                            assignLinkedPlayerMutation.mutate({
                              userId: userDetailQuery.data!.id,
                              player_id: selectedAnalyticsUserId,
                              is_primary: true
                            });
                          }}
                        >
                          <Link2 aria-hidden className="mr-2 h-4 w-4" />
                          Assign account
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </TabsContent>

                <TabsContent value="oauth" className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
                  <div className="space-y-4 rounded-lg border border-border/60 bg-card/60 p-4">
                    <div>
                      <h3 className={EYEBROW_CLASS}>OAuth connections</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Provider accounts linked to this auth account.
                      </p>
                    </div>

                    <div className="space-y-3">
                      {oauthConnectionsQuery.isLoading ? (
                        <Skeleton className="h-16 w-full" />
                      ) : oauthConnectionsQuery.data?.results.length ? (
                        oauthConnectionsQuery.data.results.map((conn) => {
                          const expired = conn.token_expires_at
                            ? new Date(conn.token_expires_at) < new Date()
                            : false;
                          return (
                            <div
                              key={conn.id}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 p-3"
                            >
                              <div className="min-w-0 space-y-1">
                                <ProviderBadge provider={conn.provider} />
                                <p className="truncate text-sm font-medium">
                                  {conn.display_name ?? conn.username}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {conn.username}
                                  {conn.email ? ` · ${conn.email}` : ""}
                                </p>
                              </div>
                              {conn.token_expires_at ? (
                                <Badge
                                  variant="outline"
                                  className={TONE_CLASS[expired ? "danger" : "success"]}
                                >
                                  {expired ? "Expired" : "Active"}
                                </Badge>
                              ) : null}
                            </div>
                          );
                        })
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No OAuth connections. This account signs in with its email and password
                          only.
                        </p>
                      )}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent
                  value="permissions"
                  className="max-h-[60vh] space-y-4 overflow-y-auto pr-1"
                >
                  <UserDenyEditor userId={userDetailQuery.data.id} canEdit={canAssignRoles} />

                  <div className="space-y-4 rounded-lg border border-border/60 bg-card/60 p-4">
                    <div>
                      <h3 className={EYEBROW_CLASS}>Effective permissions</h3>
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
                        <p className="text-sm text-muted-foreground">
                          No effective permissions. Assign a role on the Roles tab to grant access.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          ) : (
            <div className="py-8 text-sm text-muted-foreground">
              Could not load this auth account. Close the dialog and reopen it — the account may
              have just been deleted.
            </div>
          )}

          <DialogFooter className="sm:justify-between">
            {isSuperuser && userDetailQuery.data && userDetailQuery.data.id !== currentUserId ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={deleteUserMutation.isPending}>
                    <Trash2 aria-hidden className="mr-2 h-4 w-4" />
                    Delete account
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete auth account</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently deletes the auth account for{" "}
                      <span className="font-medium text-foreground">
                        {userDetailQuery.data.email}
                      </span>
                      , including its roles, permission denies, OAuth connections, API keys, and
                      active sessions, so they are signed out of every device immediately. The
                      linked player profile and tournament history are preserved (only unlinked).
                      This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => deleteUserMutation.mutate(userDetailQuery.data!.id)}
                    >
                      Delete account
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <span />
            )}
            <Button variant="ghost" onClick={() => setManagingUserId(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
