"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Pencil, Trash2, CheckCircle, XCircle } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Badge } from "@/components/ui/badge";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EditableAvatar } from "@/components/ui/editable-avatar";
import { notify } from "@/lib/notify";
import { usePermissions } from "@/hooks/usePermissions";
import { hasUnsavedChanges } from "@/lib/form-change";
import workspaceService from "@/services/workspace.service";
import { Workspace } from "@/types/workspace.types";
import { useWorkspaceStore } from "@/stores/workspace.store";

interface WorkspaceFormData {
  slug: string;
  name: string;
  description: string;
}

const emptyForm: WorkspaceFormData = {
  slug: "",
  name: "",
  description: ""
};

const ACCEPTED_IMAGE_TYPES = "image/webp,image/png,image/jpeg,image/gif";
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

export default function WorkspacesPage() {
  const { isSuperuser, isWorkspaceAdmin } = usePermissions();
  const router = useRouter();
  const queryClient = useQueryClient();
  const fetchWorkspaces = useWorkspaceStore((s) => s.fetchWorkspaces);

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<Workspace | null>(null);
  const [formData, setFormData] = useState<WorkspaceFormData>({ ...emptyForm });
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-workspaces"] });
    fetchWorkspaces();
  };

  const createMutation = useMutation({
    mutationFn: async (data: WorkspaceFormData) => {
      const ws = await workspaceService.create({
        slug: data.slug,
        name: data.name,
        description: data.description || undefined
      });
      if (iconFile) {
        await workspaceService.uploadIcon(ws.id, iconFile);
      }
      return ws;
    },
    onSuccess: () => {
      invalidate();
      setCreateOpen(false);
      setFormData({ ...emptyForm });
      setIconFile(null);
      setIconPreview(null);
      notify.success("Workspace created");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/v1/workspaces/${id}`, { method: "DELETE" }).then((r) => {
        if (!r.ok) throw new Error("Failed to delete");
      }),
    onSuccess: () => {
      invalidate();
      setDeleteOpen(false);
      notify.success("Workspace deleted");
    }
  });

  const handleCreate = () => {
    setFormData({ ...emptyForm });
    setIconFile(null);
    setIconPreview(null);
    setCreateOpen(true);
  };

  const handleIconSelect = (file: File) => {
    setIconFile(file);
    setIconPreview(URL.createObjectURL(file));
  };

  const handleDelete = (ws: Workspace) => {
    setSelected(ws);
    setDeleteOpen(true);
  };

  const isCreateDirty = createOpen && (hasUnsavedChanges(formData, emptyForm) || iconFile !== null);

  const columns: ColumnDef<Workspace>[] = [
    {
      accessorKey: "id",
      header: "ID",
      cell: ({ row }) => <div className="font-mono text-xs tabular-nums">{row.getValue("id")}</div>
    },
    {
      id: "icon",
      header: "Icon",
      cell: ({ row }) => {
        const ws = row.original;
        return ws.icon_url ? (
          <img src={ws.icon_url} alt="" aria-hidden className="h-8 w-8 rounded-md border object-cover" />
        ) : (
          <div className="h-8 w-8 rounded-md border bg-muted flex items-center justify-center text-muted-foreground text-xs font-medium">
            {ws.name.charAt(0).toUpperCase()}
          </div>
        );
      }
    },
    {
      accessorKey: "slug",
      header: "Slug",
      cell: ({ row }) => <code className="text-xs">{row.getValue("slug")}</code>
    },
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => <div className="font-medium">{row.getValue("name")}</div>
    },
    {
      accessorKey: "is_active",
      header: "Status",
      cell: ({ row }) =>
        row.getValue("is_active") ? (
          <StatusIcon icon={CheckCircle} label="Active" variant="success" />
        ) : (
          <StatusIcon icon={XCircle} label="Inactive" variant="muted" />
        )
    },
    {
      accessorKey: "is_hidden",
      header: "Visibility",
      cell: ({ row }) =>
        row.getValue("is_hidden") ? (
          <Badge variant="outline" className="text-muted-foreground">
            Hidden
          </Badge>
        ) : null
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const ws = row.original;
        const canManage = isSuperuser || isWorkspaceAdmin(ws.id);
        if (!canManage) return null;

        return (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push(`/admin/workspaces/${ws.id}`)}
              aria-label={`Edit ${ws.name}`}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            {isSuperuser ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleDelete(ws)}
                className="text-destructive"
                aria-label={`Delete ${ws.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        );
      }
    }
  ];

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Workspaces"
        description="Manage workspaces for isolated tournament environments"
        actions={
          isSuperuser ? (
            <Button onClick={handleCreate}>
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              Create workspace
            </Button>
          ) : null
        }
      />

      <AdminDataTable
        queryKey={(page, search, pageSize, sortField, sortDir) => [
          "admin-workspaces",
          isSuperuser,
          page,
          search,
          pageSize,
          sortField,
          sortDir
        ]}
        queryFn={async () => {
          const all = await workspaceService.getAll();
          // Non-superusers only see workspaces they admin
          const visible = isSuperuser ? all : all.filter((ws) => isWorkspaceAdmin(ws.id));
          return {
            results: visible,
            total: visible.length,
            page: 1,
            per_page: visible.length
          };
        }}
        columns={columns}
        searchPlaceholder="Search workspaces…"
        emptyMessage={
          isSuperuser
            ? "No workspaces yet. Use “Create workspace” to add the first one."
            : "No workspaces yet. The ones you administer will show up here."
        }
      />

      {/* Create Dialog */}
      <EntityFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create workspace"
        description="Create a new isolated workspace for tournaments"
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate(formData);
        }}
        isSubmitting={createMutation.isPending}
        submittingLabel="Creating workspace…"
        errorMessage={createMutation.isError ? createMutation.error.message : undefined}
        isDirty={isCreateDirty}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="slug">Slug *</Label>
            <Input
              id="slug"
              value={formData.slug}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "")
                })
              }
              placeholder="my-workspace"
              required
            />
            <p className="text-xs text-muted-foreground mt-1">
              URL-safe identifier (a-z, 0-9, -, _)
            </p>
          </div>
          <div>
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="My Workspace"
              required
            />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Optional description"
            />
          </div>
          <div>
            <p className="text-sm font-medium leading-none">Icon</p>
            <div className="mt-1.5">
              <EditableAvatar
                src={iconPreview}
                name={formData.name}
                size={64}
                shape="rounded"
                onSelectFile={handleIconSelect}
                onDelete={
                  iconPreview
                    ? () => {
                        setIconFile(null);
                        setIconPreview(null);
                      }
                    : undefined
                }
                accept={ACCEPTED_IMAGE_TYPES}
                maxSizeBytes={MAX_FILE_SIZE}
                onError={(message) => notify.error(message)}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">PNG, JPEG, WebP or GIF, max 2 MB</p>
          </div>
        </div>
      </EntityFormDialog>

      {/* Delete Dialog */}
      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => selected && deleteMutation.mutate(selected.id)}
        title="Delete workspace"
        description={`Deleting “${selected?.name}” permanently removes every tournament, team, player, match and member inside it. This cannot be undone.`}
        cascadeInfo={[
          "All tournaments in this workspace",
          "All teams, players, matches, and statistics",
          "All workspace members"
        ]}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}
