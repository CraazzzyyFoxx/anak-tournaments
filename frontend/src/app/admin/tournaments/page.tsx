"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Pencil, Trash2, CheckCircle, XCircle, Crown, Trophy } from "lucide-react";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { EntityFormDialog } from "@/components/admin/EntityFormDialog";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import tournamentService from "@/services/tournament.service";
import adminService from "@/services/admin.service";
import { Tournament } from "@/types/tournament.types";
import { TournamentCreateInput, TournamentUpdateInput } from "@/types/admin.types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Field, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissions } from "@/hooks/usePermissions";
import { hasUnsavedChanges } from "@/lib/form-change";
import { paginateResults, sortArray } from "@/lib/paginate-results";
import { useWorkspaceStore } from "@/stores/workspace.store";

function normalizeChallongeSlug(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    if (url.hostname.includes("challonge.com")) {
      const segments = url.pathname.split("/").filter(Boolean);
      return segments.at(-1) ?? trimmed;
    }
  } catch {
    // fall back to raw slug handling
  }

  return trimmed.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean).at(-1) ?? trimmed;
}

const emptyTournamentForm: Omit<TournamentCreateInput, "workspace_id"> = {
  name: "",
  description: "",
  is_league: false,
  start_date: "",
  end_date: "",
};

function getTournamentEditForm(tournament: Tournament): TournamentUpdateInput {
  return {
    name: tournament.name,
    description: tournament.description || "",
    is_finished: tournament.is_finished,
    start_date: new Date(tournament.start_date).toISOString().split("T")[0],
    end_date: new Date(tournament.end_date).toISOString().split("T")[0],
  };
}

export default function TournamentsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const canCreate = hasPermission("tournament.create");
  const canUpdate = hasPermission("tournament.update");
  const canDelete = hasPermission("tournament.delete");

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);
  const [createMode, setCreateMode] = useState<"manual" | "challonge">("manual");

  // Form state
  const [formData, setFormData] = useState<TournamentCreateInput | TournamentUpdateInput>({
    ...emptyTournamentForm,
  });
  const [challongeSlug, setChallongeSlug] = useState("");

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: TournamentCreateInput) => adminService.createTournament(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tournaments"] });
      setCreateDialogOpen(false);
      resetForm();
      toast({ title: "Tournament created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const createWithGroupsMutation = useMutation({
    mutationFn: (params: {
      number: number;
      challonge_slug: string;
      is_league: boolean;
      start_date: string;
      end_date: string;
    }) => adminService.createTournamentWithGroups(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tournaments"] });
      setCreateDialogOpen(false);
      resetForm();
      toast({ title: "Tournament created with groups from Challonge" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: TournamentUpdateInput }) =>
      adminService.updateTournament(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tournaments"] });
      setEditDialogOpen(false);
      setSelectedTournament(null);
      resetForm();
      toast({ title: "Tournament updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteTournament(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tournaments"] });
      setDeleteDialogOpen(false);
      setSelectedTournament(null);
      toast({ title: "Tournament deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const resetForm = () => {
    setFormData({ ...emptyTournamentForm });
    setChallongeSlug("");
    setCreateMode("manual");
  };

  const handleCreate = () => {
    createMutation.reset();
    createWithGroupsMutation.reset();
    setCreateDialogOpen(true);
    resetForm();
  };

  const handleEdit = (tournament: Tournament) => {
    updateMutation.reset();
    setSelectedTournament(tournament);
    setFormData(getTournamentEditForm(tournament));
    setEditDialogOpen(true);
  };

  const handleDelete = (tournament: Tournament) => {
    setSelectedTournament(tournament);
    setDeleteDialogOpen(true);
  };

  const handleSubmitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (createMode === "challonge") {
      const fd = formData as TournamentCreateInput;
      if (!fd.number || !challongeSlug.trim() || !fd.start_date || !fd.end_date) return;
      createWithGroupsMutation.mutate({
        number: fd.number,
        challonge_slug: normalizeChallongeSlug(challongeSlug),
        is_league: fd.is_league,
        start_date: fd.start_date,
        end_date: fd.end_date,
      });
    } else {
      if (!currentWorkspaceId) return;
      createMutation.mutate({
        ...formData,
        workspace_id: currentWorkspaceId,
      } as TournamentCreateInput);
    }
  };

  const handleSubmitUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedTournament) {
      updateMutation.mutate({
        id: selectedTournament.id,
        data: formData as TournamentUpdateInput
      });
    }
  };

  const handleConfirmDelete = () => {
    if (selectedTournament) {
      deleteMutation.mutate(selectedTournament.id);
    }
  };

  const editFormInitial = selectedTournament ? getTournamentEditForm(selectedTournament) : emptyTournamentForm;
  const isCreateDirty = createDialogOpen && (hasUnsavedChanges(formData, emptyTournamentForm) || challongeSlug !== "");
  const isEditDirty = editDialogOpen && hasUnsavedChanges(formData, editFormInitial);

  const activeCreateMutation = createMode === "challonge" ? createWithGroupsMutation : createMutation;
  const isCreateSubmitting = activeCreateMutation.isPending;
  const createErrorMessage = activeCreateMutation.isError ? activeCreateMutation.error.message : undefined;

  const columns: ColumnDef<Tournament>[] = [
    {
      accessorKey: "number",
      header: "#",
      cell: ({ row }) => <div className="font-medium">{row.getValue("number") || "—"}</div>
    },
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => <div className="font-medium">{row.getValue("name")}</div>
    },
    {
      accessorKey: "is_league",
      header: "Type",
      cell: ({ row }) =>
        row.getValue("is_league") ? (
          <StatusIcon icon={Crown} label="League" variant="info" />
        ) : (
          <StatusIcon icon={Trophy} label="Tournament" variant="muted" />
        )
    },
    {
      accessorKey: "is_finished",
      header: "Status",
      cell: ({ row }) =>
        row.getValue("is_finished") ? (
          <StatusIcon icon={CheckCircle} label="Finished" variant="muted" />
        ) : (
          <StatusIcon icon={XCircle} label="Active" variant="success" />
        )
    },
    {
      accessorKey: "start_date",
      header: "Start Date",
      cell: ({ row }) => new Date(row.getValue("start_date")).toLocaleDateString()
    },
    {
      accessorKey: "end_date",
      header: "End Date",
      cell: ({ row }) => new Date(row.getValue("end_date")).toLocaleDateString()
    },
    {
      id: "actions",
      cell: ({ row }) =>
        canUpdate || canDelete ? (
          <div className="flex items-center gap-2">
            {canUpdate ? (
              <Button aria-label={`Edit ${row.original.name}`} variant="ghost" size="icon" onClick={() => handleEdit(row.original)}>
                <Pencil className="h-4 w-4" />
              </Button>
            ) : null}
            {canDelete ? (
              <Button
                aria-label={`Delete ${row.original.name}`}
                variant="ghost"
                size="icon"
                onClick={() => handleDelete(row.original)}
                className="text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        ) : null
    }
  ];

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Tournaments"
        description="Manage tournaments and their groups"
        actions={
          canCreate ? (
            <Button onClick={handleCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Create Tournament
            </Button>
          ) : null
        }
      />

      <AdminDataTable
        queryKey={(page, search, pageSize, sortField, sortDir) => ["tournaments", page, search, pageSize, sortField, sortDir]}
        queryFn={(page, search, pageSize, sortField, sortDir) =>
          tournamentService.getAll(null).then((data) => {
            const filtered = search
              ? data.results.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
              : data.results;
            return { ...paginateResults(sortArray(filtered, sortField, sortDir), page, pageSize) };
          })
        }
        columns={columns}
        searchPlaceholder="Search tournaments..."
        emptyMessage="No tournaments found."
        onRowClick={(row) => router.push(`/admin/tournaments/${row.original.id}`)}
      />

      {/* Create Dialog */}
      <EntityFormDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        title="Create Tournament"
        description="Create a new tournament manually or import from Challonge"
        onSubmit={handleSubmitCreate}
        isSubmitting={isCreateSubmitting}
        submittingLabel="Creating tournament…"
        errorMessage={createErrorMessage}
        isDirty={isCreateDirty}
      >
        <Tabs
          value={createMode}
          onValueChange={(v) => {
            setCreateMode(v as "manual" | "challonge");
            createMutation.reset();
            createWithGroupsMutation.reset();
          }}
        >
          <TabsList className="w-full">
            <TabsTrigger value="manual" className="flex-1">Manual</TabsTrigger>
            <TabsTrigger value="challonge" className="flex-1">From Challonge</TabsTrigger>
          </TabsList>

          <TabsContent value="manual">
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              <div>
                <Label htmlFor="number">Number</Label>
                <Input
                  id="number"
                  type="number"
                  value={(formData as TournamentCreateInput).number || ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      number: e.target.value ? parseInt(e.target.value) : undefined
                    })
                  }
                />
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description ?? ""}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="is_league"
                  checked={(formData as TournamentCreateInput).is_league}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_league: checked as boolean })
                  }
                />
                <Label htmlFor="is_league" className="cursor-pointer">
                  Is League
                </Label>
              </div>

              <Field>
                <FieldLabel htmlFor="date_range">Date Range *</FieldLabel>
                <DateRangePicker
                  id="date_range"
                  startDate={formData.start_date}
                  endDate={formData.end_date}
                  onChange={(start, end) => setFormData({ ...formData, start_date: start, end_date: end })}
                />
              </Field>
            </div>
          </TabsContent>

          <TabsContent value="challonge">
            <div className="space-y-4">
              <div>
                <Label htmlFor="challonge_slug">Challonge URL or Slug *</Label>
                <Input
                  id="challonge_slug"
                  placeholder="e.g. my-tournament or https://challonge.com/my-tournament"
                  value={challongeSlug}
                  onChange={(e) => setChallongeSlug(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground mt-1">
                  The Challonge bracket must have group stages enabled (two-stage). All groups will be created automatically.
                </p>
              </div>

              <div>
                <Label htmlFor="challonge_number">Number *</Label>
                <Input
                  id="challonge_number"
                  type="number"
                  value={(formData as TournamentCreateInput).number || ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      number: e.target.value ? parseInt(e.target.value) : undefined
                    })
                  }
                  required
                />
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="challonge_is_league"
                  checked={(formData as TournamentCreateInput).is_league}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_league: checked as boolean })
                  }
                />
                <Label htmlFor="challonge_is_league" className="cursor-pointer">
                  Is League
                </Label>
              </div>

              <Field>
                <FieldLabel htmlFor="challonge_date_range">Date Range *</FieldLabel>
                <DateRangePicker
                  id="challonge_date_range"
                  startDate={formData.start_date}
                  endDate={formData.end_date}
                  onChange={(start, end) => setFormData({ ...formData, start_date: start, end_date: end })}
                />
              </Field>
            </div>
          </TabsContent>
        </Tabs>
      </EntityFormDialog>

      {/* Edit Dialog */}
      <EntityFormDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        title="Edit Tournament"
        description="Update tournament details"
        onSubmit={handleSubmitUpdate}
        isSubmitting={updateMutation.isPending}
        submittingLabel="Updating tournament…"
        errorMessage={updateMutation.isError ? updateMutation.error.message : undefined}
        isDirty={isEditDirty}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="edit-description">Description</Label>
            <Textarea
              id="edit-description"
              value={formData.description ?? ""}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="is_finished"
              checked={(formData as TournamentUpdateInput).is_finished}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, is_finished: checked as boolean })
              }
            />
            <Label htmlFor="is_finished" className="cursor-pointer">
              Is Finished
            </Label>
          </div>

          <Field>
            <FieldLabel htmlFor="edit-date_range">Date Range</FieldLabel>
            <DateRangePicker
              id="edit-date_range"
              startDate={formData.start_date}
              endDate={formData.end_date}
              onChange={(start, end) => setFormData({ ...formData, start_date: start, end_date: end })}
            />
          </Field>
        </div>
      </EntityFormDialog>

      {/* Delete Dialog */}
      {canDelete ? (
        <DeleteConfirmDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          onConfirm={handleConfirmDelete}
          title="Delete Tournament"
          description={`Are you sure you want to delete "${selectedTournament?.name}"? This action cannot be undone.`}
          cascadeInfo={[
            "All tournament groups",
            "All teams in this tournament",
            "All players in these teams",
            "All encounters in this tournament",
            "All standings data"
          ]}
          isDeleting={deleteMutation.isPending}
        />
      ) : null}
    </div>
  );
}
