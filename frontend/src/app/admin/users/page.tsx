"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Plus, Pencil, Trash2, Upload, ArrowRightLeft, UserCog } from "lucide-react";

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import adminService from "@/services/admin.service";
import { rbacService } from "@/services/rbac.service";
import type { User } from "@/types/user.types";
import type { CsvUserImportParams } from "@/types/admin.types";
import { usePermissions } from "@/hooks/usePermissions";
import { hasUnsavedChanges } from "@/lib/form-change";
import { notify } from "@/lib/notify";
import { useWorkspaceStore } from "@/stores/workspace.store";

const defaultImportParams: CsvUserImportParams = {
  battle_tag_row: 1,
  discord_row: 2,
  twitch_row: 3,
  smurf_row: 4,
  start_row: 1,
  delimiter: ",",
  sheet_url: ""
};

interface ColumnFieldProps {
  id: string;
  label: string;
  value: number | null;
  /** `null` means the column is absent from the sheet and will not be imported. */
  onChange: (value: number | null) => void;
  /** Marks the field with `*`; a required column cannot be left out. */
  required?: boolean;
  min?: number;
  hint?: string;
}

/**
 * One column index of the CSV mapping. A compact number field rather than a
 * card-with-stepper: an empty value is how an optional column is skipped, so the
 * on/off switch and the +/- pair are both redundant.
 */
function ColumnField({ id, label, value, onChange, required, min = 1, hint }: ColumnFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
        {required ? " *" : ""}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        value={value ?? ""}
        placeholder={required ? undefined : "Skip"}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") {
            onChange(null);
            return;
          }
          const parsed = Number.parseInt(raw, 10);
          onChange(Number.isNaN(parsed) ? null : Math.max(min, parsed));
        }}
        className="h-9 tabular-nums"
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

interface CsvImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function CsvImportDialog({ open, onOpenChange }: CsvImportDialogProps) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [tab, setTab] = useState<string>("file");
  const [file, setFile] = useState<File | null>(null);
  const [params, setParams] = useState<CsvUserImportParams>({ ...defaultImportParams });
  const [validationError, setValidationError] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: () => {
      const submitParams = { ...params };
      if (tab === "file") {
        delete submitParams.sheet_url;
      }
      return adminService.bulkCreateUsersFromCsv(
        submitParams,
        tab === "file" ? (file ?? undefined) : undefined
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      onOpenChange(false);
      setFile(null);
      setParams({ ...defaultImportParams });
      setValidationError(null);
    }
  });

  // Validate on submit rather than disabling the button, so the reason a click
  // does nothing is always stated instead of implied.
  const handleImport = () => {
    if (tab === "file" && !file) {
      setValidationError("Choose a CSV file to import.");
      return;
    }
    if (tab === "sheet" && !params.sheet_url) {
      setValidationError("Paste a Google Sheets link to import from.");
      return;
    }
    setValidationError(null);
    importMutation.mutate();
  };

  const errorMessage =
    validationError ??
    (importMutation.error instanceof Error
      ? `Could not import the file. ${importMutation.error.message}`
      : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import player identities from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file or provide a Google Sheets link to bulk-create player identities.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="file">CSV file</TabsTrigger>
            <TabsTrigger value="sheet">Google Sheets</TabsTrigger>
          </TabsList>

          <TabsContent value="file" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-file`}>CSV file *</Label>
              <Input
                id={`${fieldId}-file`}
                type="file"
                accept=".csv,.txt"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </TabsContent>

          <TabsContent value="sheet" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-sheet-url`}>Google Sheets URL *</Label>
              <Input
                id={`${fieldId}-sheet-url`}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                value={params.sheet_url ?? ""}
                onChange={(e) => setParams({ ...params, sheet_url: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Sheet must be publicly accessible (or shared via link).
              </p>
            </div>
          </TabsContent>
        </Tabs>

        <div className="space-y-3 pt-2">
          <p className="text-sm font-medium">Column mapping</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ColumnField
              id={`${fieldId}-battle-tag-row`}
              label="BattleTag"
              value={params.battle_tag_row}
              onChange={(v) => setParams({ ...params, battle_tag_row: v ?? 1 })}
              required
            />
            <ColumnField
              id={`${fieldId}-discord-row`}
              label="Discord"
              value={params.discord_row}
              onChange={(v) => setParams({ ...params, discord_row: v })}
            />
            <ColumnField
              id={`${fieldId}-twitch-row`}
              label="Twitch"
              value={params.twitch_row}
              onChange={(v) => setParams({ ...params, twitch_row: v })}
            />
            <ColumnField
              id={`${fieldId}-smurf-row`}
              label="Smurf"
              value={params.smurf_row}
              onChange={(v) => setParams({ ...params, smurf_row: v })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Column numbers start at 1. Leave an optional column empty to skip it.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <ColumnField
            id={`${fieldId}-start-row`}
            label="Start row"
            value={params.start_row ?? 0}
            onChange={(v) => setParams({ ...params, start_row: v ?? 0 })}
            required
            min={0}
            hint="Header rows to skip (0 = none)"
          />
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-delimiter`} className="text-xs">
              Delimiter *
            </Label>
            <Input
              id={`${fieldId}-delimiter`}
              value={params.delimiter ?? ","}
              onChange={(e) => setParams({ ...params, delimiter: e.target.value })}
              className="h-9"
            />
          </div>
        </div>

        {errorMessage && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={importMutation.isPending}>
            {importMutation.isPending ? "Importing…" : "Import identities"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersAdminPage() {
  const queryClient = useQueryClient();
  const { canAccessPermission, hasPermission, isSuperuser } = usePermissions();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const formId = useId();
  const nameFieldId = `${formId}-name`;
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
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
  const canCreate = canAccessPermission("user.create", workspaceId);
  const canUpdate = canAccessPermission("user.update", workspaceId);
  const canDelete = canAccessPermission("user.delete", workspaceId);
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
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
                <Upload aria-hidden className="mr-2 h-4 w-4" />
                Import from CSV
              </Button>
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
            </div>
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
        emptyMessage="No player identities yet. Use “Create player identity” to add the first one."
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

      {/* CSV Import Dialog */}
      <CsvImportDialog open={importDialogOpen} onOpenChange={setImportDialogOpen} />
    </div>
  );
}
