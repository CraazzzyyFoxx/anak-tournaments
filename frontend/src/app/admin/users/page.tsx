"use client";

import { useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Plus, Pencil, Trash2, UserPlus } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import adminService from "@/services/admin.service";
import type { User, UserDiscord, UserBattleTag, UserTwitch } from "@/types/user.types";
import type { UserCreateInput, UserUpdateInput } from "@/types/admin.types";
import { usePermissions } from "@/hooks/usePermissions";
import { hasUnsavedChanges } from "@/lib/form-change";

interface IdentityManagementProps {
  user: User;
  onClose: () => void;
  canEditIdentity: boolean;
  canDeleteIdentity: boolean;
}

function IdentityManagement({
  user,
  onClose,
  canEditIdentity,
  canDeleteIdentity,
}: IdentityManagementProps) {
  const queryClient = useQueryClient();
  const [discordName, setDiscordName] = useState("");
  const [battleTag, setBattleTag] = useState("");
  const [twitchName, setTwitchName] = useState("");
  const [editingDiscord, setEditingDiscord] = useState<number | null>(null);
  const [editingBattleTag, setEditingBattleTag] = useState<number | null>(null);
  const [editingTwitch, setEditingTwitch] = useState<number | null>(null);

  const addDiscordMutation = useMutation({
    mutationFn: (name: string) => adminService.addDiscordIdentity(user.id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setDiscordName("");
    },
  });

  const addBattleTagMutation = useMutation({
    mutationFn: (battle_tag: string) => adminService.addBattleTagIdentity(user.id, { battle_tag }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setBattleTag("");
    },
  });

  const addTwitchMutation = useMutation({
    mutationFn: (name: string) => adminService.addTwitchIdentity(user.id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setTwitchName("");
    },
  });

  const updateDiscordMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      adminService.updateDiscordIdentity(user.id, id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setEditingDiscord(null);
    },
  });

  const updateBattleTagMutation = useMutation({
    mutationFn: ({ id, battle_tag }: { id: number; battle_tag: string }) =>
      adminService.updateBattleTagIdentity(user.id, id, { battle_tag }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setEditingBattleTag(null);
    },
  });

  const updateTwitchMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      adminService.updateTwitchIdentity(user.id, id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setEditingTwitch(null);
    },
  });

  const deleteDiscordMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteDiscordIdentity(user.id, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });

  const deleteBattleTagMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteBattleTagIdentity(user.id, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });

  const deleteTwitchMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteTwitchIdentity(user.id, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Identities - {user.name}</DialogTitle>
          <DialogDescription>
            Add, edit, or remove user identities (Discord, BattleTag, Twitch)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Discord Identities */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Discord</CardTitle>
              <CardDescription>Discord usernames</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {user.discord?.map((identity: UserDiscord) => (
                <div key={identity.id} className="flex items-center gap-2">
                  {editingDiscord === identity.id ? (
                    <>
                      <Input
                        defaultValue={identity.name}
                        onBlur={(e) => {
                          if (e.target.value && e.target.value !== identity.name) {
                            updateDiscordMutation.mutate({ id: identity.id, name: e.target.value });
                          } else {
                            setEditingDiscord(null);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && e.currentTarget.value) {
                            updateDiscordMutation.mutate({
                              id: identity.id,
                              name: e.currentTarget.value,
                            });
                          }
                          if (e.key === "Escape") {
                            setEditingDiscord(null);
                          }
                        }}
                        autoFocus
                      />
                    </>
                  ) : (
                    <>
                      <Badge variant="secondary" className="flex-1">
                        {identity.name}
                      </Badge>
                      {canEditIdentity ? (
                        <Button
                          aria-label={`Edit Discord identity ${identity.name}`}
                          size="icon"
                          variant="ghost"
                          onClick={() => setEditingDiscord(identity.id)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {canDeleteIdentity ? (
                        <Button
                          aria-label={`Delete Discord identity ${identity.name}`}
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteDiscordMutation.mutate(identity.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
              ))}
              {canEditIdentity ? (
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Add Discord username..."
                    value={discordName}
                    onChange={(e) => setDiscordName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && discordName) {
                        addDiscordMutation.mutate(discordName);
                      }
                    }}
                  />
                  <Button
                    onClick={() => discordName && addDiscordMutation.mutate(discordName)}
                    disabled={!discordName || addDiscordMutation.isPending}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* BattleTag Identities */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">BattleTag</CardTitle>
              <CardDescription>Battle.net tags (Name#1234)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {user.battle_tag?.map((identity: UserBattleTag) => (
                <div key={identity.id} className="flex items-center gap-2">
                  {editingBattleTag === identity.id ? (
                    <>
                      <Input
                        defaultValue={identity.battle_tag}
                        onBlur={(e) => {
                          if (e.target.value && e.target.value !== identity.battle_tag) {
                            updateBattleTagMutation.mutate({
                              id: identity.id,
                              battle_tag: e.target.value,
                            });
                          } else {
                            setEditingBattleTag(null);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && e.currentTarget.value) {
                            updateBattleTagMutation.mutate({
                              id: identity.id,
                              battle_tag: e.currentTarget.value,
                            });
                          }
                          if (e.key === "Escape") {
                            setEditingBattleTag(null);
                          }
                        }}
                        autoFocus
                      />
                    </>
                  ) : (
                    <>
                      <Badge variant="secondary" className="flex-1">
                        {identity.battle_tag}
                      </Badge>
                      {canEditIdentity ? (
                        <Button
                          aria-label={`Edit BattleTag identity ${identity.battle_tag}`}
                          size="icon"
                          variant="ghost"
                          onClick={() => setEditingBattleTag(identity.id)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {canDeleteIdentity ? (
                        <Button
                          aria-label={`Delete BattleTag identity ${identity.battle_tag}`}
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteBattleTagMutation.mutate(identity.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
              ))}
              {canEditIdentity ? (
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Add BattleTag (Name#1234)..."
                    value={battleTag}
                    onChange={(e) => setBattleTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && battleTag) {
                        addBattleTagMutation.mutate(battleTag);
                      }
                    }}
                  />
                  <Button
                    onClick={() => battleTag && addBattleTagMutation.mutate(battleTag)}
                    disabled={!battleTag || addBattleTagMutation.isPending}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Twitch Identities */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Twitch</CardTitle>
              <CardDescription>Twitch usernames</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {user.twitch?.map((identity: UserTwitch) => (
                <div key={identity.id} className="flex items-center gap-2">
                  {editingTwitch === identity.id ? (
                    <>
                      <Input
                        defaultValue={identity.name}
                        onBlur={(e) => {
                          if (e.target.value && e.target.value !== identity.name) {
                            updateTwitchMutation.mutate({ id: identity.id, name: e.target.value });
                          } else {
                            setEditingTwitch(null);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && e.currentTarget.value) {
                            updateTwitchMutation.mutate({
                              id: identity.id,
                              name: e.currentTarget.value,
                            });
                          }
                          if (e.key === "Escape") {
                            setEditingTwitch(null);
                          }
                        }}
                        autoFocus
                      />
                    </>
                  ) : (
                    <>
                      <Badge variant="secondary" className="flex-1">
                        {identity.name}
                      </Badge>
                      {canEditIdentity ? (
                        <Button
                          aria-label={`Edit Twitch identity ${identity.name}`}
                          size="icon"
                          variant="ghost"
                          onClick={() => setEditingTwitch(identity.id)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {canDeleteIdentity ? (
                        <Button
                          aria-label={`Delete Twitch identity ${identity.name}`}
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteTwitchMutation.mutate(identity.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
              ))}
              {canEditIdentity ? (
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Add Twitch username..."
                    value={twitchName}
                    onChange={(e) => setTwitchName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && twitchName) {
                        addTwitchMutation.mutate(twitchName);
                      }
                    }}
                  />
                  <Button
                    onClick={() => twitchName && addTwitchMutation.mutate(twitchName)}
                    disabled={!twitchName || addTwitchMutation.isPending}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersAdminPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [managingIdentities, setManagingIdentities] = useState<User | null>(null);
  const [formData, setFormData] = useState<UserCreateInput | UserUpdateInput>({ name: "" });
  const canCreate = hasPermission("user.create");
  const canUpdate = hasPermission("user.update");
  const canDelete = hasPermission("user.delete");
  const canManageIdentities = canUpdate || canDelete;
  const createFormInitial: UserCreateInput = { name: "" };
  const editFormInitial: UserUpdateInput = editingUser ? { name: editingUser.name } : createFormInitial;
  const isFormDirty = (createDialogOpen || !!editingUser) && hasUnsavedChanges(formData, editingUser ? editFormInitial : createFormInitial);

  const createMutation = useMutation({
    mutationFn: (data: UserCreateInput) => adminService.createUser(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setCreateDialogOpen(false);
      setFormData({ name: "" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UserUpdateInput }) =>
      adminService.updateUser(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setEditingUser(null);
      setFormData({ name: "" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setDeletingUser(null);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingUser) {
      updateMutation.mutate({ id: editingUser.id, data: formData as UserUpdateInput });
    } else {
      createMutation.mutate(formData as UserCreateInput);
    }
  };

  const columns: ColumnDef<User>[] = [
    {
      accessorKey: "id",
      header: "ID",
      size: 80,
    },
    {
      accessorKey: "name",
      header: "Name",
    },
    {
      id: "identities",
      header: "Identities",
      cell: ({ row }) => {
        const user = row.original;
        const identityCount =
          (user.discord?.length || 0) + (user.battle_tag?.length || 0) + (user.twitch?.length || 0);
        return (
          <div className="flex gap-1">
            {user.discord && user.discord.length > 0 && (
              <Badge variant="outline">{user.discord.length} Discord</Badge>
            )}
            {user.battle_tag && user.battle_tag.length > 0 && (
              <Badge variant="outline">{user.battle_tag.length} BattleTag</Badge>
            )}
            {user.twitch && user.twitch.length > 0 && (
              <Badge variant="outline">{user.twitch.length} Twitch</Badge>
            )}
            {identityCount === 0 && (
              <span className="text-sm text-muted-foreground">No identities</span>
            )}
          </div>
        );
      },
    },
    {
      id: "actions",
      size: 50,
      cell: ({ row }) => {
        const user = row.original;
        if (!canManageIdentities && !canUpdate && !canDelete) {
          return null;
        }
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label={`Open actions for ${user.name}`} variant="ghost" size="icon">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              {canManageIdentities ? (
                <DropdownMenuItem onClick={() => setManagingIdentities(user)}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Manage Identities
                </DropdownMenuItem>
              ) : null}
              {(canManageIdentities && (canUpdate || canDelete)) ? <DropdownMenuSeparator /> : null}
              {canUpdate ? (
                <DropdownMenuItem
                  onClick={() => {
                    updateMutation.reset();
                    setEditingUser(user);
                    setFormData({ name: user.name });
                  }}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
              ) : null}
              {canDelete ? (
                <DropdownMenuItem onClick={() => setDeletingUser(user)} className="text-destructive">
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

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Player Identities"
        description="Manage tournament identity records and linked Discord, BattleTag, and Twitch handles."
        actions={
          canCreate ? (
            <Button
              onClick={() => {
                createMutation.reset();
                updateMutation.reset();
                setFormData({ name: "" });
                setCreateDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Create User
            </Button>
          ) : null
        }
      />

      <AdminDataTable
        queryKey={(page, search) => ["admin", "users", page, search]}
        queryFn={(page, search) => adminService.getUsers({ page, search })}
        columns={columns}
        searchPlaceholder="Search users..."
        emptyMessage="No users found."
        onRowClick={canManageIdentities ? (row) => setManagingIdentities(row.original) : undefined}
      />

      {/* Create/Edit Dialog */}
      <EntityFormDialog
        open={createDialogOpen || !!editingUser}
        onOpenChange={(open) => {
          if (!open) {
            setCreateDialogOpen(false);
            setEditingUser(null);
            setFormData({ name: "" });
          }
        }}
        title={editingUser ? "Edit User" : "Create User"}
        description={
          editingUser ? "Update user information" : "Create a new user in the system"
        }
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        submittingLabel={editingUser ? "Updating player identity…" : "Creating player identity…"}
        errorMessage={
          (editingUser ? updateMutation.error : createMutation.error) instanceof Error
            ? (editingUser ? updateMutation.error : createMutation.error)?.message
            : undefined
        }
        isDirty={isFormDirty}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="User name"
              required
            />
          </div>
        </div>
      </EntityFormDialog>

      {/* Delete Confirmation */}
      {canDelete && deletingUser && (
        <DeleteConfirmDialog
          open={!!deletingUser}
          onOpenChange={(open) => !open && setDeletingUser(null)}
          onConfirm={() => deleteMutation.mutate(deletingUser.id)}
          isDeleting={deleteMutation.isPending}
          title={`Delete ${deletingUser.name}?`}
          cascadeInfo={[
            "All Discord identities",
            "All BattleTag identities",
            "All Twitch identities",
            "All player records",
          ]}
        />
      )}

      {/* Identity Management Dialog */}
      {managingIdentities && (
        <IdentityManagement
          user={managingIdentities}
          onClose={() => setManagingIdentities(null)}
          canEditIdentity={canUpdate}
          canDeleteIdentity={canDelete}
        />
      )}
    </div>
  );
}
