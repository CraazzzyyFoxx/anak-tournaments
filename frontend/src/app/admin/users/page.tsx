"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Plus, Pencil, Trash2, ArrowRightLeft, UserCog } from "lucide-react";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AuthUserSearchCombobox } from "@/components/admin/AuthUserSearchCombobox";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { PlayerProfileDialog } from "@/components/admin/PlayerProfileDialog";
import { UserMergeDialog } from "@/components/admin/UserMergeDialog";
import { SocialAccountList } from "@/components/social/SocialAccountList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import adminService from "@/services/admin.service";
import { rbacService } from "@/services/rbac.service";
import type { User } from "@/types/user.types";
import { usePermissions } from "@/hooks/usePermissions";
import { hasUnsavedChanges } from "@/lib/form-change";
import { notify } from "@/lib/notify";
import { useWorkspaceStore } from "@/stores/workspace.store";

export default function UsersAdminPage() {
  const queryClient = useQueryClient();
  const { canAccessPermission, hasPermission, isSuperuser } = usePermissions();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const formId = useId();
  const nameFieldId = `${formId}-name`;
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [mergeUser, setMergeUser] = useState<User | null>(null);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [createName, setCreateName] = useState("");
  // Optionally link the new player to an existing auth account on creation.
  const [linkAuthUserId, setLinkAuthUserId] = useState<number | null>(null);
  const [linkAuthUserLabel, setLinkAuthUserLabel] = useState("");
  const canLinkAuth = hasPermission("auth_user.update");
  // Cross-link to /admin/access/users (D9: the two Users pages stay separate
  // and cross-navigate). The identity payload does not carry the auth link, so
  // the link pre-fills the auth-user search with the player name (sans the
  // BattleTag discriminator) as a best effort — same pattern as the OAuth page.
  const canFindAuthAccount = hasPermission("auth_user.read");

  const resetCreateForm = () => {
    setCreateName("");
    setLinkAuthUserId(null);
    setLinkAuthUserLabel("");
  };
  // A player identity is platform-wide: creating, renaming or deleting one
  // reaches every workspace that plays with it, so those stay on the GLOBAL
  // grant — the same line `users_admin._gate` draws. A workspace-scoped
  // `user.read` (a workspace owner's `admin.*`) opens the page and the roster
  // list, not the writes; `hasPermission` is the global check, whereas
  // `canAccessPermission` also answers to a workspace grant.
  const canCreate = hasPermission("user.create");
  const canUpdate = hasPermission("user.update");
  const canDelete = hasPermission("user.delete");
  const canMerge = isSuperuser;
  // Identity (social account) full management is superuser-only; display
  // visibility can be toggled by anyone with read access.
  const canManageIdentity = isSuperuser;
  const canSetVisibility = canAccessPermission("user.read", workspaceId);
  const canOpenProfile = canUpdate || canDelete || canManageIdentity || canSetVisibility;
  const isCreateDirty =
    createDialogOpen &&
    hasUnsavedChanges(
      { name: createName, authUserId: linkAuthUserId },
      { name: "", authUserId: null }
    );

  const createMutation = useMutation({
    // Create the player, then (optionally) link it to an auth account. The link
    // is a second call; if it fails we still report the player as created and
    // surface a warning rather than throwing — re-submitting would otherwise
    // create a duplicate player. The admin can retry the link from Access Users.
    mutationFn: async (input: { name: string; authUserId: number | null }) => {
      const user = await adminService.createUser({ name: input.name });
      if (input.authUserId == null) {
        return { user, linkWarning: undefined as string | undefined };
      }
      try {
        await rbacService.assignLinkedPlayer(input.authUserId, {
          player_id: user.id,
          is_primary: true
        });
        return { user, linkWarning: undefined as string | undefined };
      } catch (error) {
        const detail = error instanceof Error ? error.message : "unknown error";
        return {
          user,
          linkWarning: `Player “${user.name}” created, but linking to the auth account failed: ${detail}. Link it from Access users.`
        };
      }
    },
    onSuccess: ({ linkWarning }) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: ["access-admin", "users"] });
      setCreateDialogOpen(false);
      resetCreateForm();
      if (linkWarning) notify.error(linkWarning);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setDeletingUser(null);
    }
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({ name: createName, authUserId: linkAuthUserId });
  };

  const columns: ColumnDef<User>[] = [
    {
      accessorKey: "id",
      header: "ID",
      size: 60,
      cell: ({ row }) => <span className="tabular-nums">{row.original.id}</span>
    },
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => {
        const user = row.original;
        const initials = user.name
          .split(/[#\s]+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((s) => s[0]?.toUpperCase())
          .join("");
        return (
          <div className="flex items-center gap-2.5">
            <Avatar className="h-7 w-7 text-xs">
              <AvatarImage src={user.avatar_url ?? undefined} alt={user.name} />
              <AvatarFallback className="bg-muted/60 text-muted-foreground font-medium">
                {initials || "?"}
              </AvatarFallback>
            </Avatar>
            <span className="font-medium truncate">{user.name}</span>
          </div>
        );
      }
    },
    {
      id: "identities",
      header: "Identities",
      cell: ({ row }) => {
        const user = row.original;
        if (!user.social_accounts?.length) {
          return <span className="text-xs italic text-muted-foreground">No identities linked</span>;
        }
        return <SocialAccountList accounts={user.social_accounts} linkify={false} />;
      }
    },
    {
      id: "actions",
      size: 50,
      cell: ({ row }) => {
        const user = row.original;
        if (!canOpenProfile && !canDelete && !canMerge && !canFindAuthAccount) {
          return null;
        }
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label={`Open actions for ${user.name}`} variant="ghost" size="icon">
                <MoreHorizontal aria-hidden className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="truncate">{user.name}</DropdownMenuLabel>
              {canOpenProfile && (
                <DropdownMenuItem onClick={() => setProfileUser(user)}>
                  <Pencil aria-hidden className="mr-2 h-4 w-4" />
                  Edit player identity
                </DropdownMenuItem>
              )}
              {canFindAuthAccount && (
                <DropdownMenuItem asChild>
                  <Link
                    href={`/admin/access/users?search=${encodeURIComponent(user.name.split("#")[0] || user.name)}`}
                  >
                    <UserCog aria-hidden className="mr-2 h-4 w-4" />
                    Go to Access users
                  </Link>
                </DropdownMenuItem>
              )}
              {canMerge && (
                <DropdownMenuItem onClick={() => setMergeUser(user)}>
                  <ArrowRightLeft aria-hidden className="mr-2 h-4 w-4" />
                  Merge into another identity
                </DropdownMenuItem>
              )}
              {(canOpenProfile || canFindAuthAccount || canMerge) && canDelete && (
                <DropdownMenuSeparator />
              )}
              {canDelete && (
                <DropdownMenuItem
                  onClick={() => setDeletingUser(user)}
                  className="text-destructive"
                >
                  <Trash2 aria-hidden className="mr-2 h-4 w-4" />
                  Delete player identity
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      }
    }
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Player identities"
        description="Manage tournament identity records and linked Discord, BattleTag, and Twitch handles."
        actions={
          canCreate ? (
            <Button
              onClick={() => {
                createMutation.reset();
                resetCreateForm();
                setCreateDialogOpen(true);
              }}
            >
              <Plus aria-hidden className="mr-2 h-4 w-4" />
              Create player identity
            </Button>
          ) : null
        }
      />

      <AdminDataTable
        queryKey={(page, search, pageSize, sortField, sortDir) => [
          "admin",
          "users",
          page,
          search,
          pageSize,
          sortField,
          sortDir
        ]}
        queryFn={(page, search, pageSize, sortField, sortDir) =>
          adminService.getUsers({
            page,
            search,
            per_page: pageSize,
            sort: sortField ?? undefined,
            order: sortDir
          })
        }
        columns={columns}
        searchPlaceholder="Search player identities…"
        emptyMessage={
          canCreate
            ? "No player identities yet. Use “Create player identity” to add the first one."
            : "No player identities in this workspace yet. They appear once players join its roster."
        }
        onRowClick={canOpenProfile ? (row) => setProfileUser(row.original) : undefined}
      />

      {/* Create player identity Dialog */}
      <EntityFormDialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreateDialogOpen(false);
            resetCreateForm();
          }
        }}
        title="Create player identity"
        description="Create a new player identity in the system."
        onSubmit={handleCreateSubmit}
        isSubmitting={createMutation.isPending}
        submittingLabel="Creating player identity…"
        errorMessage={
          createMutation.error instanceof Error
            ? `Check the player name and try again. (${createMutation.error.message})`
            : undefined
        }
        isDirty={isCreateDirty}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={nameFieldId}>Name *</Label>
            <Input
              id={nameFieldId}
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="Player name (e.g. Karnage#22778)"
              required
            />
          </div>
          {canLinkAuth && (
            <div className="space-y-2">
              <Label htmlFor="link-auth-account">Link to auth account (optional)</Label>
              <AuthUserSearchCombobox
                id="link-auth-account"
                value={linkAuthUserId ?? undefined}
                selectedLabel={linkAuthUserLabel || undefined}
                onSelect={(account) => {
                  setLinkAuthUserId(account?.id ?? null);
                  setLinkAuthUserLabel(account?.label ?? "");
                }}
              />
              <p className="text-xs text-muted-foreground">
                Attaches this player to an existing auth account (that account&rsquo;s profile and
                analytics will resolve to this player).
              </p>
            </div>
          )}
        </div>
      </EntityFormDialog>

      {/* Delete Confirmation */}
      {canDelete && deletingUser && (
        <DeleteConfirmDialog
          open={!!deletingUser}
          onOpenChange={(open) => !open && setDeletingUser(null)}
          onConfirm={() => deleteMutation.mutate(deletingUser.id)}
          isDeleting={deleteMutation.isPending}
          title="Delete player identity"
          description={`“${deletingUser.name}” and everything linked to it will be permanently removed. This cannot be undone.`}
          cascadeInfo={[
            "All Discord identities",
            "All BattleTag identities",
            "All Twitch identities",
            "All player records"
          ]}
        />
      )}

      {/* Unified Player Profile Dialog */}
      {profileUser && (
        <PlayerProfileDialog
          key={profileUser.id}
          user={profileUser}
          onClose={() => setProfileUser(null)}
          canEdit={canUpdate}
          canDelete={canDelete}
          canManageIdentity={canManageIdentity}
          canSetVisibility={canSetVisibility}
          workspaceId={workspaceId}
          canMerge={canMerge}
          onMergeRequested={(user) => setMergeUser(user)}
        />
      )}

      {mergeUser && (
        <UserMergeDialog
          key={mergeUser.id}
          sourceUser={mergeUser}
          open={!!mergeUser}
          onOpenChange={(open) => {
            if (!open) setMergeUser(null);
          }}
          onMerged={() => {
            setMergeUser(null);
            if (profileUser?.id === mergeUser.id) {
              setProfileUser(null);
            }
          }}
        />
      )}

    </div>
  );
}
